/**
 * Applier authorization pass (minimal).
 *
 * A plan is run by ONE role, the applier. A superuser may run every statement.
 * A non-superuser (Supabase `postgres`: CREATEROLE, not superuser) may change
 * an object only with its owner's privileges, and may hand it to a new owner
 * only if it can SET ROLE to that owner and the owner has CREATE on the
 * schema. This pass writes what a person would write by hand:
 *
 *     GRANT app_owner TO postgres;            -- borrow the owner role
 *     GRANT CREATE ON SCHEMA app TO app_owner;
 *     ALTER FUNCTION app.f() OWNER TO app_owner;
 *     REVOKE CREATE ON SCHEMA app FROM app_owner;
 *     REVOKE app_owner FROM postgres;         -- give it back
 *
 *  1. Borrow: every owner role a statement needs and the applier does not
 *     have, but can grant itself, is granted to it once at the start (after
 *     the role exists) and given back once at the end, exactly as it was.
 *  2. Lend: a new owner without CREATE on the schema gets it for the run of
 *     owner changes that needs it.
 *  3. Order: a schema GRANT moves earlier and a schema REVOKE later, so no
 *     role loses a schema privilege while the plan still works in that schema.
 *  4. Refuse (typed blockers, before anything runs): an owner the applier can
 *     neither act as nor borrow; and a borrowed role that holds grant options
 *     or ADMIN, because Postgres could then record it as the grantor of the
 *     plan's GRANT / REVOKE statements.
 *
 * It runs on the final ordered list, only for a known non-superuser
 * capability, and reads ownership, ACLs and memberships from the RAW fact
 * bases (a grant the policy filters out still exists in the database).
 * Declared limits: tests/owner-lab/DESIGN-min.md.
 */
import {
  APPLIER_MEMBERSHIP_LEFT,
  type Diagnostic,
} from "../../core/diagnostic.ts";
import type { FactBase } from "../../core/fact.ts";
import {
  encodeId,
  isSatelliteId,
  type StableId,
} from "../../core/stable-id.ts";
import {
  isReservedMembership,
  type ApplierCapability,
  type PlanBlocker,
} from "../../policy/capability.ts";
import type { Action } from "../plan.ts";
import { qid } from "../render.ts";
import { ruleFlag } from "../rule-flags.ts";
import { renderGrantSql } from "../rules/helpers.ts";
import { membershipGrantSql } from "../rules/roles.ts";

/** PoC measurement knob: `union` is the pass; `nowrap` switches lending off,
 *  `nomoves` the schema ACL ordering, so the owner-lab can count the
 *  scenarios that need each. */
export type OwnerMode = "union" | "nowrap" | "nomoves";

export interface AuthorizationInput {
  capability: ApplierCapability;
  /** raw (unfiltered) fact bases */
  source: FactBase;
  desired: FactBase;
  mode: OwnerMode;
}

export interface AuthorizationResult {
  actions: Action[];
  blockers: PlanBlocker[];
  /** set when the plan grants roles to its applier: only that role may run it */
  boundApplier?: string;
  /** the applier's own memberships the plan leaves as found */
  notices: Diagnostic[];
}

type MembershipId = Extract<StableId, { kind: "membership" }>;

const MAX_ANCESTOR_HOPS = 8;

function ownerIn(fb: FactBase, id: StableId): string | undefined {
  for (const e of fb.outgoingEdges(id)) {
    if (e.kind === "owner" && e.to.kind === "role") return e.to.name;
  }
  return undefined;
}

const ownable = (id: StableId): boolean =>
  ruleFlag(id.kind, "ownerAlterPrefix") !== undefined;

const satelliteTarget = (id: StableId): StableId | undefined =>
  isSatelliteId(id) ? (id as { target: StableId }).target : undefined;

/** What a moved statement may not cross: every id an action's ordering
 *  edges carry, its subject, and the ids its change names, plus the roles
 *  and targets inside them. */
function namedKeys(a: Action): Set<string> {
  const ids: StableId[] = [
    a.subject,
    ...a.produces,
    ...a.consumes,
    ...a.destroys,
    ...a.releases,
  ];
  if (a.change?.kind === "rename") ids.push(a.change.from);
  if (a.change?.kind === "owner") ids.push({ kind: "role", name: a.change.to });
  const keys = new Set<string>();
  for (const id of ids) {
    keys.add(encodeId(id));
    const target = satelliteTarget(id);
    if (target !== undefined) keys.add(encodeId(target));
    if (id.kind === "acl")
      keys.add(encodeId({ kind: "role", name: id.grantee }));
  }
  return keys;
}

/** What an action writes: its subject (an owner change also rewrites the
 *  object's ACL), a rename's old id, every id it produces or destroys. */
function writtenKeys(a: Action): Set<string> {
  const keys = new Set([a.subject, ...a.produces, ...a.destroys].map(encodeId));
  if (a.change?.kind === "rename") keys.add(encodeId(a.change.from));
  return keys;
}

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  for (const k of a) if (b.has(k)) return true;
  return false;
};

/** Remove actions; a segment boundary a removed action opened moves to the
 *  next one that stays. */
function without(
  actions: readonly Action[],
  drop: (a: Action) => boolean,
): Action[] {
  const out: Action[] = [];
  let carry = false;
  for (const a of actions) {
    if (drop(a)) {
      carry ||= a.newSegmentBefore;
      continue;
    }
    out.push(
      carry && !a.newSegmentBefore ? { ...a, newSegmentBefore: true } : a,
    );
    carry = false;
  }
  return out;
}

function synthetic(
  sql: string,
  subject: StableId,
  attribute: string,
  consumes: StableId[],
): Action {
  return {
    sql,
    verb: "alter",
    subject,
    change: { kind: "attribute", name: attribute },
    produces: [],
    consumes,
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
  };
}

export function authorizeForApplier(
  input: readonly Action[],
  ctx: AuthorizationInput,
): AuthorizationResult {
  const { capability: cap, source, desired } = ctx;
  const applier = cap.role;
  const modern = cap.pgMajor !== undefined && cap.pgMajor >= 16;
  const views = [source, desired];

  const inheritedSet = new Set(cap.inheritedRoles ?? cap.memberOf);
  const settableSet = new Set(cap.settableRoles ?? cap.memberOf);

  const roleSubject = (a: Action): string | undefined =>
    a.subject.kind === "role" ? a.subject.name : undefined;
  const createdByPlan = new Set<string>();
  for (const a of input) {
    const r = roleSubject(a);
    if (r !== undefined && a.verb === "create") createdByPlan.add(r);
  }

  // membership graph over BOTH states (member → roles)
  const rolesOfMember = new Map<string, Set<string>>();
  for (const fb of views) {
    for (const fact of fb.facts()) {
      if (fact.id.kind !== "membership") continue;
      const set = rolesOfMember.get(fact.id.member) ?? new Set<string>();
      set.add(fact.id.role);
      rolesOfMember.set(fact.id.member, set);
    }
  }
  /** `r` and every role it is a member of, transitively, in either state */
  const upward = (r: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [r];
    while (queue.length > 0) {
      const x = queue.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const up of rolesOfMember.get(x) ?? []) queue.push(up);
    }
    return seen;
  };

  /** PG16+: whether the applier may grant `r` (to itself) */
  const canAdmin = (r: string): boolean =>
    createdByPlan.has(r) || (cap.adminOf ?? []).includes(r);
  /** whether the applier can grant `r` to itself */
  const borrowable = (r: string): { ok: boolean; reason: string } => {
    const no = (reason: string) => ({ ok: false, reason });
    if (r.startsWith("pg_")) return no("built-in role");
    if (r === "PUBLIC") return no("PUBLIC is not a role");
    if (isReservedMembership(cap, r))
      return no("membership is reserved by supautils");
    const roleFact =
      desired.get({ kind: "role", name: r }) ??
      source.get({ kind: "role", name: r });
    if (roleFact?.payload["superuser"] === true)
      return no("role is a superuser");
    if (cap.pgMajor === undefined)
      return no("capability has no server version (re-probe the applier)");
    // Postgres refuses a membership loop
    if (upward(r).has(applier)) return no("it is a member of the applier");
    if (modern)
      return canAdmin(r)
        ? { ok: true, reason: "" }
        : no("the applier holds no direct ADMIN on it");
    if (cap.createRole !== true) return no("applier lacks CREATEROLE");
    if (cap.inherit !== true) return no("NOINHERIT applier on PG<=15");
    if (roleFact === undefined) return no("role is in neither state");
    return { ok: true, reason: "" };
  };

  const blockerMap = new Map<string, PlanBlocker>();
  const block = (
    code: PlanBlocker["code"],
    role: string,
    reason: string,
    object: StableId,
  ): void => {
    const key = `${code}\x00${role}\x00${reason}`;
    const b = blockerMap.get(key) ?? { code, role, reason, objects: [] };
    const enc = encodeId(object);
    if (!b.objects.includes(enc)) b.objects.push(enc);
    blockerMap.set(key, b);
  };

  /** the applier's use of the role in `fb`: INHERIT and SET (PG <= 15 has
   *  neither key, so a membership is full use) */
  const useIn = (fb: FactBase, id: StableId): "full" | "partial" | "none" => {
    const p = fb.get(id)?.payload;
    if (p === undefined) return "none";
    const held = [p["inherit"], p["set"]].filter((x) => x !== false).length;
    return held === 2 ? "full" : held === 1 ? "partial" : "none";
  };
  const membershipOfApplier = (a: Action): string | undefined =>
    a.subject.kind === "membership" && a.subject.member === applier
      ? a.subject.role
      : undefined;
  // PG16+: the row the applier granted itself; a GRANT on it changes only the
  // options it names
  const ownRow = (r: string) =>
    modern ? (cap.selfGrants ?? []).find((g) => g.role === r) : undefined;
  const withOptions = (r: string, inherit: boolean, set: boolean) =>
    `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT ${inherit ? "TRUE" : "FALSE"}, SET ${set ? "TRUE" : "FALSE"}`;
  // PG16+: the plan moves the applier's own membership only between full use
  // and none. GRANT / REVOKE change only the executing role's row, and the
  // borrow below rewrites that row around the plan, so a partial row, or use
  // through another grantor's row, is left as found.
  const leftAsFound = (a: Action): string | undefined => {
    const r = membershipOfApplier(a);
    if (!modern || r === undefined) return undefined;
    const from = useIn(source, a.subject);
    const to = useIn(desired, a.subject);
    if (from === "partial" || to === "partial")
      return "only one of INHERIT and SET is held, before or after the plan";
    if (!canAdmin(r)) return "the applier holds no ADMIN on it directly";
    const own = ownRow(r);
    if (
      from === "full" &&
      to === "none" &&
      (!(own?.inherit && own.set) || (cap.usedViaOthers ?? []).includes(r))
    )
      return "its use comes from a row another role granted";
    // REVOKE ADMIN OPTION reaches only its own row, never the ADMIN row
    // CREATE ROLE records for the creator
    if (
      from === to &&
      source.get(a.subject)?.payload["admin"] === true &&
      desired.get(a.subject)?.payload["admin"] !== true &&
      own?.admin !== true
    )
      return "its ADMIN comes from a row another role granted";
    return undefined;
  };
  // the ADMIN-only row CREATE ROLE gives the creator is the row a superuser's
  // `GRANT … WITH ADMIN OPTION` records, and Postgres refuses to grant it back
  // to its own grantor (0LP01): the create keeps only the use, or is dropped
  const ownAdmin = (a: Action): boolean =>
    modern &&
    a.verb === "create" &&
    membershipOfApplier(a) !== undefined &&
    desired.get(a.subject)?.payload["admin"] === true;
  const notices: Diagnostic[] = [];
  const planned = without(input, (a) => {
    const reason = leftAsFound(a);
    if (reason !== undefined)
      notices.push({
        code: APPLIER_MEMBERSHIP_LEFT,
        severity: "warning",
        subject: a.subject,
        message: `The applier's membership in "${membershipOfApplier(a)}" is left as found: ${reason}.`,
      });
    return (
      reason !== undefined ||
      (ownAdmin(a) && useIn(desired, a.subject) !== "full")
    );
  }).map((a) => {
    const r = membershipOfApplier(a);
    if (r === undefined || a.verb !== "create") return a;
    if (ownRow(r) !== undefined && useIn(desired, a.subject) === "full")
      return { ...a, sql: withOptions(r, true, true) };
    if (!ownAdmin(a)) return a;
    const payload = { ...desired.get(a.subject)?.payload, admin: false };
    return {
      ...a,
      sql: membershipGrantSql(r, applier, payload, cap.inherit !== false),
    };
  });
  const rewritten = planned.some(ownAdmin);

  // ── 3. order: schema GRANT earlier, schema REVOKE later ─────────────────
  // The base plan may revoke a role's schema privileges first and grant the
  // new ones last; a superuser does not notice, anyone else is locked out of
  // the schema in between. Holding a schema privilege longer can only let a
  // crossed statement succeed, so the move is safe as long as it does not
  // cross a statement that writes something it names.
  if (ctx.mode !== "nomoves") {
    type Direction = "earlier" | "later" | undefined;
    // Only schema privileges the plan itself can depend on are moved: those
    // of the applier, of PUBLIC, of a role that owns something in either
    // state, and of the roles these are members of. A grant to any other
    // role (a runtime role that owns nothing) stays where the plan put it.
    let reliedOn: Set<string> | undefined;
    const isReliedOn = (grantee: string): boolean => {
      if (reliedOn === undefined) {
        reliedOn = new Set(["PUBLIC", ...upward(applier)]);
        for (const fb of views) {
          for (const fact of fb.facts()) {
            const o = ownerIn(fb, fact.id);
            if (o !== undefined && !reliedOn.has(o))
              for (const u of upward(o)) reliedOn.add(u);
          }
        }
      }
      return reliedOn.has(grantee);
    };
    const directionOf = (a: Action): Direction => {
      const s = a.subject;
      if (s.kind !== "acl" || s.target.kind !== "schema") return undefined;
      if (s.column !== undefined) return undefined;
      // a GRANT merged over several grantees lists them all in `produces`
      const grantees = [s, ...a.produces].flatMap((id) =>
        "grantee" in id ? [id.grantee] : [],
      );
      if (!grantees.some(isReliedOn)) return undefined;
      if (a.verb === "drop") return "later";
      const grants = (fb: FactBase) => {
        const p = fb.get(s)?.payload;
        return new Set([
          ...((p?.["privileges"] as string[] | undefined) ?? []),
          ...((p?.["grantable"] as string[] | undefined) ?? []).map(
            (g) => `${g}*`,
          ),
        ]);
      };
      const from = grants(source);
      const to = grants(desired);
      const widen = [...to].some((g) => !from.has(g));
      const narrow = [...from].some((g) => !to.has(g));
      if (widen === narrow) return undefined;
      return widen ? "earlier" : "later";
    };
    const aclTarget = (a: Action): string | undefined =>
      a.subject.kind === "acl" ? encodeId(a.subject.target) : undefined;
    /** whether `moved` may not pass `other`: two grants on one schema do
     *  not commute (the first can change who is recorded as grantor of the
     *  second) */
    const blocks = (
      moved: Action,
      other: Action,
      direction: Direction,
    ): boolean =>
      other.transactionality !== "transactional" ||
      // A role or membership statement can change who may make the grant:
      // never move to before that authority is given, nor to after it is
      // taken away. (Moving a GRANT to before a DROP ROLE, or a REVOKE to
      // after a CREATE ROLE, only keeps authority the statement had.)
      (("member" in other.subject || roleSubject(other) !== undefined) &&
        other.verb !== (direction === "earlier" ? "drop" : "create")) ||
      aclTarget(other) === aclTarget(moved) ||
      intersects(writtenKeys(other), namedKeys(moved)) ||
      intersects(writtenKeys(moved), namedKeys(other));
    const movable = (a: Action) =>
      a.transactionality === "transactional" && !a.newSegmentBefore;
    const earlier = planned.filter(
      (a) => movable(a) && directionOf(a) === "earlier",
    );
    const later = planned.filter(
      (a) => movable(a) && directionOf(a) === "later",
    );
    for (const a of earlier) {
      const from = planned.indexOf(a);
      let to = from;
      // an action that opens a segment is the first of its transaction
      while (
        to > 0 &&
        !(planned[to - 1] as Action).newSegmentBefore &&
        !blocks(a, planned[to - 1] as Action, "earlier")
      )
        to--;
      if (to < from) {
        planned.splice(from, 1);
        planned.splice(to, 0, a);
      }
    }
    for (const a of [...later].reverse()) {
      const from = planned.indexOf(a);
      let to = from;
      while (
        to + 1 < planned.length &&
        !(planned[to + 1] as Action).newSegmentBefore &&
        !blocks(a, planned[to + 1] as Action, "later")
      )
        to++;
      if (to > from) {
        planned.splice(from, 1);
        planned.splice(to, 0, a);
      }
    }
  }

  // ── the plan's own changes to the applier's memberships ────────────────
  /** whether the statement gives the applier use of the role or takes it
   *  away (PG16+: full use or none; an ADMIN-only change does neither) */
  const effect = (a: Action): "grant" | "revoke" | undefined => {
    const to = useIn(desired, a.subject);
    if (useIn(source, a.subject) === to) return undefined;
    return to === "full" ? "grant" : "revoke";
  };
  const planGrants = new Set<string>();
  const planRevokes = new Set<string>();
  for (const a of planned) {
    const r = membershipOfApplier(a);
    if (r === undefined) continue;
    if (effect(a) === "grant") planGrants.add(r);
    if (effect(a) === "revoke") planRevokes.add(r);
  }
  // a role the applier has only through a membership the plan revokes is not
  // something a statement can rely on
  const losing = new Set<string>();
  for (const r of planRevokes) for (const u of upward(r)) losing.add(u);
  const has = (r: string) =>
    r === applier || (inheritedSet.has(r) && !losing.has(r));
  const canSetNow = (r: string) =>
    r === applier || (settableSet.has(r) && !losing.has(r));

  // ── owner tracking (a walk over the list in order) ──────────────────────
  const ownerChanged = new Set<string>();
  for (const a of planned) {
    if (a.change?.kind === "owner") ownerChanged.add(encodeId(a.subject));
  }
  // objects whose owner an owner change of another object carries (a
  // sequence linked to the same table follows it), keyed by the carrier
  const followers = new Map<string, StableId[]>();
  for (const fact of desired.facts()) {
    const carrier = ruleFlag(fact.id.kind, "ownerCarrier")?.(
      fact,
      source.get(fact.id),
    );
    if (carrier === undefined) continue;
    const key = encodeId(carrier);
    followers.set(key, [...(followers.get(key) ?? []), fact.id]);
  }
  const parentOf = (id: StableId): StableId | undefined =>
    source.get(id)?.parent ?? desired.get(id)?.parent ?? satelliteTarget(id);
  /** nearest ancestor (or self) that can have an owner */
  const rootOf = (id: StableId): StableId | undefined => {
    let cur: StableId | undefined = id;
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS && cur !== undefined; hop++) {
      if (ownable(cur)) return cur;
      cur = parentOf(cur);
    }
    return undefined;
  };

  const tracker = () => {
    const owners = new Map<string, string | undefined>();
    // new schema name → the name the source knows its objects under
    const schemaWas = new Map<string, string>();
    const ownerNow = (id: StableId): string | undefined => {
      const key = encodeId(id);
      if (!owners.has(key)) {
        const was = schemaWas.get((id as { schema?: string }).schema ?? "");
        let o = ownerIn(
          source,
          was === undefined ? id : ({ ...id, schema: was } as StableId),
        );
        if (o === undefined && id.kind === "schema" && source.has(id)) {
          // `public` → pg_database_owner has no owner edge (not a fact); an
          // edge a profile pruned to the default owner is the applier
          const raw = source.get(id)?.payload["_owner"];
          o = typeof raw === "string" ? raw : applier;
        }
        owners.set(key, o);
      }
      return owners.get(key);
    };
    const step = (a: Action): void => {
      const s = a.subject;
      const key = encodeId(s);
      if (a.change?.kind === "owner") {
        owners.set(key, a.change.to);
        for (const f of followers.get(key) ?? [])
          owners.set(encodeId(f), a.change.to);
      } else if (a.change?.kind === "rename" && ownable(s)) {
        owners.set(key, ownerNow(a.change.from));
        if (s.kind === "schema" && "name" in a.change.from)
          schemaWas.set(s.name, a.change.from.name);
        // the old name is free: an object created under it is a new object
        owners.set(encodeId(a.change.from), undefined);
      } else if (a.verb === "create" && ownable(s)) {
        // created as the applier; with no owner change of its own the create
        // itself set the desired owner (CREATE SCHEMA … AUTHORIZATION)
        if (ownerNow(s) === undefined)
          owners.set(
            key,
            ownerChanged.has(key) ? applier : (ownerIn(desired, s) ?? applier),
          );
      } else if (a.verb === "drop" && ownable(s)) {
        owners.set(key, undefined);
      }
    };
    return { ownerNow, step };
  };

  const schemaAcl = (schema: string, grantee: string): StableId => ({
    kind: "acl",
    target: { kind: "schema", name: schema },
    grantee,
  });
  const holds = (
    fb: FactBase,
    schema: string,
    grantee: string,
    privilege: string,
  ): boolean =>
    (
      (fb.get(schemaAcl(schema, grantee))?.payload["privileges"] as
        | string[]
        | undefined) ?? []
    ).includes(privilege);

  /** the applier, or a role it keeps, holds CREATE WITH GRANT OPTION on the
   *  schema: it can lend CREATE without the schema owner */
  const canLendItself = (schema: string): boolean =>
    [applier, ...inheritedSet].some(
      (h) =>
        (h === applier || !losing.has(h)) &&
        (
          (source.get(schemaAcl(schema, h))?.payload["grantable"] as
            | string[]
            | undefined) ?? []
        ).includes("CREATE"),
    );

  // schema ACL items the plan itself writes (a GRANT merged over several
  // grantees names the first as its subject and lists all in `produces`)
  const plannedAcl = new Set<string>();
  for (const a of planned) {
    if (a.subject.kind !== "acl") continue;
    plannedAcl.add(encodeId(a.subject));
    for (const id of a.produces) {
      if (id.kind === "acl") plannedAcl.add(encodeId(id));
    }
  }
  /** Decided from the two states, never from a simulated ACL: `nothing`
   *  when the role (or PUBLIC) holds CREATE before the plan and the plan does
   *  not take it away; `keep` when the plan itself grants it (its own
   *  statement completes the item); else `lend` and take back. */
  const lendKind = (schema: string, r: string): "nothing" | "keep" | "lend" => {
    const isPlanned = (g: string) =>
      plannedAcl.has(encodeId(schemaAcl(schema, g)));
    const throughout = (g: string) =>
      holds(source, schema, g, "CREATE") &&
      (!isPlanned(g) || holds(desired, schema, g, "CREATE"));
    // Only what the role holds itself (or PUBLIC): CREATE reached through a
    // group counts for Postgres only when that membership is inherited, which
    // the facts do not say. Lending it anyway costs one GRANT / REVOKE pair.
    if ([r, "PUBLIC"].some(throughout)) return "nothing";
    return isPlanned(r) && holds(desired, schema, r, "CREATE")
      ? "keep"
      : "lend";
  };

  /** per object: the roles holding a grant option on it, in either state,
   *  with the privileges they can grant */
  const optionHolders = new Map<string, Map<string, Set<string>>>();
  for (const fb of views) {
    for (const fact of fb.facts()) {
      if (fact.id.kind !== "acl") continue;
      const options = (fact.payload["grantable"] as string[] | undefined) ?? [];
      if (options.length === 0) continue;
      const key = encodeId(rootOf(fact.id.target) ?? fact.id.target);
      const holders = optionHolders.get(key) ?? new Map<string, Set<string>>();
      const held = holders.get(fact.id.grantee) ?? new Set<string>();
      for (const o of options) held.add(o);
      optionHolders.set(key, holders.set(fact.id.grantee, held));
    }
  }
  const holdersOf = (target: StableId): Map<string, Set<string>> =>
    optionHolders.get(encodeId(rootOf(target) ?? target)) ?? new Map();
  /** what a GRANT / REVOKE on this ACL item grants or, when it leaves the
   *  item empty, takes away */
  const asked = (id: StableId): string[] => {
    const privileges = (fb: FactBase) =>
      (fb.get(id)?.payload["privileges"] as string[] | undefined) ?? [];
    return privileges(desired).length > 0
      ? privileges(desired)
      : privileges(source);
  };
  const covers = (held: ReadonlySet<string>, id: StableId): boolean =>
    asked(id).length > 0 && asked(id).every((x) => held.has(x));

  /** Roles whose privileges an action uses (`touched`), and of those the
   *  ones the applier cannot rely on having (`missing`). */
  const needsOf = (
    a: Action,
    ownerNow: (id: StableId) => string | undefined,
  ): { touched: Set<string>; missing: Set<string> } => {
    const touched = new Set<string>();
    const missing = new Set<string>();
    const add = (r: string | undefined) => {
      if (r !== undefined) touched.add(r);
    };
    // a default privilege belongs to a role (defaclrole)
    if (a.subject.kind === "defaultPrivilege") add(a.subject.role);
    const root = rootOf(a.subject);
    // a GRANT / REVOKE the applier can already make runs as it does today,
    // without the owner. Judged narrowly: before the plan, on exactly this
    // ACL item's object (or column), the applier or a role it has holds the
    // grant option for every privilege the item has on either side.
    const grantsAlready =
      a.subject.kind === "acl" &&
      [a.subject, ...a.produces].every((id) => {
        if (id.kind !== "acl") return false;
        const item = [source, desired].flatMap(
          (fb) =>
            (fb.get(id)?.payload["privileges"] as string[] | undefined) ?? [],
        );
        return (
          item.length > 0 &&
          [applier, ...inheritedSet].some((h) => {
            // not the grantee itself (its own option cannot take away what
            // the owner granted it), nor a role the plan revokes on the way
            if (h === id.grantee || !has(h)) return false;
            const held = source.get({ ...id, grantee: h })?.payload[
              "grantable"
            ];
            return item.every((x) =>
              ((held as string[] | undefined) ?? []).includes(x),
            );
          })
        );
      });
    if (root !== undefined && !grantsAlready) {
      // a rename runs while the object still has its old name
      const named = a.change?.kind === "rename" ? a.change.from : undefined;
      const owner = ownerNow(
        named === undefined ? root : (rootOf(named) ?? root),
      );
      add(owner);
      const reach = (g: string) => has(g) || borrowable(g).ok;
      // the schema the root lives in: creating in it needs CREATE there, and
      // so does a rename. Nothing else does (a drop needs the object's
      // owner, borrowed above), nor is it needed when the applier may
      // already create there.
      const parent = parentOf(root);
      const container = parent === undefined ? undefined : rootOf(parent);
      const usesSchema =
        satelliteTarget(a.subject) === undefined &&
        (a.verb === "create" || a.change?.kind === "rename");
      const schemaName =
        container?.kind === "schema" ? container.name : undefined;
      if (container !== undefined && usesSchema) {
        const mayCreate =
          schemaName !== undefined &&
          [applier, "PUBLIC", ...inheritedSet].some((g) =>
            holds(source, schemaName, g, "CREATE"),
          );
        if (!mayCreate) add(ownerNow(container));
      } else if (
        container !== undefined &&
        a.verb === "drop" &&
        satelliteTarget(a.subject) === undefined &&
        owner !== undefined &&
        !reach(owner)
      ) {
        // the owner of a schema may drop anything in it: the way in when the
        // object's own owner is out of reach
        add(ownerNow(container));
      } else if (container !== undefined && schemaName !== undefined) {
        // Naming the object needs USAGE on its schema. When neither the
        // applier, PUBLIC, a role it has, nor the object's own owner (about
        // to be borrowed) has it, the schema's owner is borrowed too, if
        // it can be: this never turns a plan into a refusal.
        const so = ownerNow(container);
        const reaches = [
          applier,
          "PUBLIC",
          ...inheritedSet,
          ...[...touched].filter(reach),
        ].some((g) => g === so || holds(source, schemaName, g, "USAGE"));
        if (!reaches && so !== undefined && borrowable(so).ok) add(so);
      }
      // what the object references (a foreign key's table, a trigger's
      // function) and its inheritance children matter when the object itself
      // is created or altered (dropping a column cascades to the children),
      // not for a GRANT or a comment on it, nor to drop the object itself
      const onObject =
        satelliteTarget(a.subject) === undefined &&
        !(a.verb === "drop" && encodeId(a.subject) === encodeId(root));
      for (const fb of onObject ? views : []) {
        for (const e of fb.outgoingEdges(root)) {
          if (e.kind !== "depends") continue;
          const target = rootOf(e.to);
          // an object's schema is handled above, not as a dependency
          if (target !== undefined && target.kind !== "schema")
            add(ownerNow(target));
        }
        // inheritance / partition children: dependents of the same kind
        for (const e of fb.incomingEdges(root)) {
          if (e.kind === "depends" && e.from.kind === root.kind)
            add(ownerNow(e.from));
        }
      }
    }
    if (a.change?.kind === "owner") {
      const r = a.change.to;
      // lending CREATE to the new owner is done with the schema owner's
      // privileges
      const schema =
        a.subject.kind === "schema" ? undefined : parentOf(a.subject);
      if (
        schema?.kind === "schema" &&
        lendKind(schema.name, r) !== "nothing" &&
        !canLendItself(schema.name)
      )
        add(ownerNow(schema));
      for (const t of touched) if (!has(t)) missing.add(t);
      touched.add(r);
      if (!canSetNow(r)) missing.add(r);
    } else {
      for (const t of touched) if (!has(t)) missing.add(t);
    }
    return { touched, missing };
  };

  // ── 1. borrow ───────────────────────────────────────────────────────────
  const selfId = (r: string): MembershipId => ({
    kind: "membership",
    role: r,
    member: applier,
  });
  const touched = new Set<string>();
  const missing = new Set<string>();
  const neededBy = new Map<Action, Set<string>>();
  {
    const walk = tracker();
    for (const a of planned) {
      const needs = needsOf(a, walk.ownerNow);
      neededBy.set(a, needs.touched);
      for (const r of needs.touched) touched.add(r);
      for (const r of needs.missing) missing.add(r);
      walk.step(a);
    }
  }
  const toBorrow = [...missing].filter((r) => borrowable(r).ok);
  // a role the plan revokes from the applier, through which a statement
  // reaches a role it uses, is kept until the end as well
  for (const r of planRevokes) {
    if (borrowable(r).ok && intersects(upward(r), touched)) toBorrow.push(r);
  }
  const borrowed = new Set(toBorrow.sort());
  // roles the applier inherits through a borrowed role
  const viaBorrowed = new Set<string>();
  for (const r of borrowed) for (const u of upward(r)) viaBorrowed.add(u);
  const canSet = (r: string) =>
    r === applier || settableSet.has(r) || viaBorrowed.has(r);
  const canInherit = (r: string) =>
    r === applier || inheritedSet.has(r) || viaBorrowed.has(r);

  // The statements a person would write. PG16+ records the applier as the
  // grantor of both (it holds ADMIN directly, or it could not borrow), so
  // the REVOKE removes exactly the row the GRANT made. INHERIT / SET are
  // spelled out only when the defaults would not give them.
  // the applier already has full use: the borrow writes no statement
  const holdsFully = (r: string) => inheritedSet.has(r) && settableSet.has(r);
  const borrowSql = (r: string) =>
    ownRow(r) !== undefined
      ? withOptions(r, true, true)
      : modern && cap.inherit !== true
        ? `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT TRUE`
        : `GRANT ${qid(r)} TO ${qid(applier)}`;
  // the plan's own REVOKE of a borrowed role from the applier would give the
  // role back too early: it moves to the end. Its own GRANT of that role,
  // when it does what the borrow statement does and that statement is
  // written, is the borrow.
  const list = without(planned, (a) => {
    const r = membershipOfApplier(a);
    if (r === undefined || !borrowed.has(r)) return false;
    if (effect(a) === "revoke") return true;
    return (
      effect(a) === "grant" &&
      (modern || a.sql === borrowSql(r)) &&
      !holdsFully(r)
    );
  });

  // ── 4. refuse: the borrow must not change the grantor ───────────────────
  // Postgres records as grantor of a GRANT / REVOKE the executing role when
  // it owns the object; otherwise the first role, among the executing role
  // and those it inherits, that holds every grant option asked for in that
  // object's ACL (its owner holds them all) or, for a role, ADMIN. Borrowing
  // adds candidates: the borrowed owner, and whatever the borrowed roles
  // hold. When that can change who is recorded, compared with a superuser
  // (always the owner) or with the same plan without the borrow, the plan is
  // refused: rare, and silent otherwise.
  const newlyInherited = [...viaBorrowed].filter(
    (r) => r !== applier && !inheritedSet.has(r),
  );
  const fresh = new Set(newlyInherited);
  if (newlyInherited.length > 0) {
    const membershipActions = list.filter(
      (a) =>
        modern && a.subject.kind === "membership" && !canAdmin(a.subject.role),
    );
    for (const fb of views) {
      for (const fact of fb.facts()) {
        if (
          fact.id.kind === "membership" &&
          fresh.has(fact.id.member) &&
          fact.payload["admin"] === true
        ) {
          const g = fact.id.role;
          for (const a of membershipActions) {
            if ((a.subject as MembershipId).role !== g) continue;
            block(
              "capability_membership_grantor",
              fact.id.member,
              `holds ADMIN on "${g}" and the applier holds none directly; while the plan borrows it Postgres would record it as the grantor`,
              a.subject,
            );
          }
        }
      }
    }
  }

  // Roles borrowed only around the statements that need them, with the
  // statements during which they must not be held. A role that holds a grant
  // option on an object the plan grants or revokes on changes who Postgres
  // records as grantor only while the applier holds it: when that statement
  // does not need the role, not holding it then is enough, and nothing has
  // to be refused. Kept to plain cases: a role borrowed for itself, that is
  // a member of nothing, and that the plan does not create, drop or grant.
  const narrow = new Map<string, Set<Action>>();
  const narrowable = (h: string): boolean =>
    !createdByPlan.has(h) &&
    !planGrants.has(h) &&
    !planRevokes.has(h) &&
    !inheritedSet.has(h) &&
    !settableSet.has(h) &&
    // PG16+: the creator's ADMIN-only row is not a use of the role
    (modern ? ownRow(h) === undefined : !source.has(selfId(h))) &&
    upward(h).size === 1 &&
    ![...borrowed].some((r) => r !== h && upward(r).has(h)) &&
    !list.some((a) => roleSubject(a) === h);

  // ── 2. lend schema CREATE to a new owner; owner-change blockers ────────
  const before = new Map<Action, Action[]>();
  const after = new Map<Action, Action[]>();
  // one GRANT before the first owner change of a run, one REVOKE after the
  // last; a run ends at a commit and at a statement on the schema itself
  type Lend = { first: Action; last: Action; schema: string; role: string };
  const open = new Map<string, Lend>();
  const lends: Lend[] = [];
  const endRuns = (schema?: string): void => {
    for (const [key, lend] of open) {
      if (schema !== undefined && lend.schema !== schema) continue;
      lends.push(lend);
      open.delete(key);
    }
  };

  const renamedSchemas = new Set<string>();
  for (const a of list) {
    if (a.subject.kind === "schema" && a.change?.kind === "rename")
      renamedSchemas
        .add(a.subject.name)
        .add((a.change.from as { name: string }).name);
  }
  const walk = tracker();
  for (const a of list) {
    if (a.newSegmentBefore || a.transactionality !== "transactional") endRuns();
    if (a.subject.kind === "schema") endRuns(a.subject.name);

    // a GRANT merged over several grantees is on one object: its subject
    if (a.subject.kind === "acl") {
      const id = a.subject;
      const o = walk.ownerNow(rootOf(id.target) ?? id.target);
      const asOwner = o !== undefined && canInherit(o);
      // as the owner itself the applier is always the grantor
      for (const [h, held] of o === applier ? [] : holdersOf(id.target)) {
        if (h === o) continue;
        const hazard = fresh.has(h)
          ? // a borrowed holder: beside the owner it must hold every option
            !asOwner || covers(held, id)
          : // a holder the applier already had, now beside a borrowed owner
            (h === applier || inheritedSet.has(h)) &&
            o !== undefined &&
            fresh.has(o) &&
            covers(held, id);
        if (!hazard) continue;
        // a borrowed role this statement does not need is not held while
        // it runs: its borrow is cut into the stretches that need it
        if (
          fresh.has(h) &&
          asOwner &&
          borrowed.has(h) &&
          neededBy.get(a)?.has(h) !== true &&
          narrowable(h)
        ) {
          narrow.set(h, (narrow.get(h) ?? new Set<Action>()).add(a));
          continue;
        }
        block(
          "capability_acl_grantor",
          h,
          `holds a grant option on an object the plan grants or revokes on; with the roles the plan must borrow, Postgres could record a different grantor than the object's owner${o === undefined ? "" : ` "${o}"`}. Take the grant option away from "${h}", or apply as a superuser`,
          id.target,
        );
      }
    }

    if (a.change?.kind === "owner") {
      const newOwner = a.change.to;
      if (!canSet(newOwner)) {
        block(
          "capability_owner",
          newOwner,
          `new owner: the applier cannot SET ROLE to it and cannot grant it to itself (${borrowable(newOwner).reason})`,
          a.subject,
        );
      }
      const cur = walk.ownerNow(a.subject);
      if (cur !== undefined && !canInherit(cur)) {
        block(
          "capability_owner",
          cur,
          `current owner: the applier does not have its privileges and cannot grant it to itself (${borrowable(cur).reason})`,
          a.subject,
        );
      }
      // the new owner needs CREATE on the object's schema (a superuser's
      // ALTER … OWNER TO skips that check)
      const schema =
        a.subject.kind === "schema" ? undefined : parentOf(a.subject);
      if (schema?.kind === "schema" && ctx.mode !== "nowrap") {
        const so = walk.ownerNow(schema);
        if (
          so !== undefined &&
          so !== newOwner &&
          newOwner !== applier &&
          (canInherit(so) || canLendItself(schema.name)) &&
          !renamedSchemas.has(schema.name) &&
          lendKind(schema.name, newOwner) !== "nothing"
        ) {
          const key = `${schema.name}\x00${newOwner}`;
          const run = open.get(key);
          if (run === undefined)
            open.set(key, {
              first: a,
              last: a,
              schema: schema.name,
              role: newOwner,
            });
          else run.last = a;
        }
      }
    }
    if (a.transactionality !== "transactional") endRuns();
    walk.step(a);
  }
  endRuns();
  for (const lend of lends) {
    const schema: StableId = { kind: "schema", name: lend.schema };
    const aclId = schemaAcl(lend.schema, lend.role);
    const aclKey = encodeId(aclId);
    const writes = (a: Action) =>
      a.subject.kind === "acl" &&
      (encodeId(a.subject) === aclKey ||
        a.produces.some((id) => encodeId(id) === aclKey));
    // the plan's own grant already ran: nothing to lend
    if (
      lendKind(lend.schema, lend.role) === "keep" &&
      !list.slice(list.indexOf(lend.first)).some(writes)
    )
      continue;
    const consumes: StableId[] = [schema, { kind: "role", name: lend.role }];
    before.set(lend.first, [
      synthetic(
        renderGrantSql(schema, ["CREATE"], [lend.role]),
        aclId,
        "privileges",
        consumes,
      ),
      ...(before.get(lend.first) ?? []),
    ]);
    if (lendKind(lend.schema, lend.role) === "lend") {
      after.set(lend.last, [
        ...(after.get(lend.last) ?? []),
        synthetic(
          `REVOKE CREATE ON SCHEMA ${qid(lend.schema)} FROM ${qid(lend.role)}`,
          aclId,
          "privileges",
          consumes,
        ),
      ]);
    }
  }

  // ── assemble: borrow after the role exists, give back at the end ───────
  const membershipStatement = (r: string, sql: string): Action =>
    synthetic(sql, selfId(r), "borrow", [
      { kind: "role", name: r },
      { kind: "role", name: applier },
    ]);
  const head: Action[] = [];
  const tail: Action[] = [];
  for (const r of borrowed) {
    const avoid = narrow.get(r);
    if (avoid !== undefined) {
      let first: Action | undefined;
      let last: Action | undefined;
      const flush = (): void => {
        if (first !== undefined && last !== undefined) {
          before.set(first, [
            membershipStatement(r, borrowSql(r)),
            ...(before.get(first) ?? []),
          ]);
          after.set(last, [
            ...(after.get(last) ?? []),
            membershipStatement(r, `REVOKE ${qid(r)} FROM ${qid(applier)}`),
          ]);
        }
        first = undefined;
        last = undefined;
      };
      for (const a of list) {
        if (avoid.has(a) || a.newSegmentBefore) flush();
        if (neededBy.get(a)?.has(r) === true) {
          first ??= a;
          last = a;
        }
      }
      flush();
      continue;
    }
    const openAction = membershipStatement(r, borrowSql(r));
    const createdAt = list.find(
      (a) => a.verb === "create" && roleSubject(a) === r,
    );
    // nothing to grant when the applier already has full use of the role and
    // only the plan's REVOKE is postponed
    if (holdsFully(r)) {
      // no statement
    } else if (createdAt === undefined) head.push(openAction);
    else after.set(createdAt, [openAction, ...(after.get(createdAt) ?? [])]);
    // a role the plan drops takes the membership with it; one the plan
    // grants to the applier stays granted
    if (list.some((a) => a.verb === "drop" && roleSubject(a) === r)) continue;
    if (planRevokes.has(r)) {
      for (const a of planned)
        if (membershipOfApplier(a) === r && effect(a) === "revoke")
          tail.push({ ...a, newSegmentBefore: false });
      continue;
    }
    if (planGrants.has(r)) continue;
    // PG16+: the row the applier had granted itself goes back as it was
    const was = ownRow(r);
    if (was !== undefined)
      tail.push(membershipStatement(r, withOptions(r, was.inherit, was.set)));
    else if (modern || !source.has(selfId(r)))
      tail.push(
        membershipStatement(r, `REVOKE ${qid(r)} FROM ${qid(applier)}`),
      );
  }

  const out = (a: Action, newSegmentBefore: boolean): Action =>
    newSegmentBefore === a.newSegmentBefore ? a : { ...a, newSegmentBefore };
  const actions: Action[] = [...head];
  for (const a of list) {
    const pre = before.get(a) ?? [];
    // statements put before `a` run in `a`'s transaction: the segment
    // boundary `a` opens moves to the first of them
    pre.forEach((x, i) =>
      actions.push(out(x, i === 0 ? a.newSegmentBefore : false)),
    );
    actions.push(out(a, pre.length > 0 ? false : a.newSegmentBefore));
    for (const x of after.get(a) ?? []) actions.push(x);
  }
  actions.push(...tail);

  const bound = borrowed.size > 0 || lends.length > 0 || rewritten;
  return {
    actions,
    blockers: [...blockerMap.values()],
    ...(bound ? { boundApplier: applier } : {}),
    notices,
  };
}
