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
    if (modern) {
      if ((cap.adminOf ?? []).includes(r) || createdByPlan.has(r))
        return { ok: true, reason: "" };
      return no("the applier holds no direct ADMIN on it");
    }
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

  // PG16+: the applier's ADMIN row on a role it created (or already holds
  // ADMIN on directly) is the row a superuser's `GRANT … WITH ADMIN OPTION`
  // records, and Postgres refuses to grant it back to its own grantor
  // (0LP01): that create is dropped.
  const planned = without(
    input,
    (a) =>
      modern &&
      a.verb === "create" &&
      a.subject.kind === "membership" &&
      a.subject.member === applier &&
      desired.get(a.subject)?.payload["admin"] === true &&
      (createdByPlan.has(a.subject.role) ||
        (cap.adminOf ?? []).includes(a.subject.role)),
  );

  // ── 3. order: schema GRANT earlier, schema REVOKE later ─────────────────
  // The base plan may revoke a role's schema privileges first and grant the
  // new ones last; a superuser does not notice, anyone else is locked out of
  // the schema in between. Holding a schema privilege longer can only let a
  // crossed statement succeed, so the move is safe as long as it does not
  // cross a statement that writes something it names.
  if (ctx.mode !== "nomoves") {
    type Direction = "earlier" | "later" | undefined;
    const directionOf = (a: Action): Direction => {
      const s = a.subject;
      if (s.kind !== "acl" || s.target.kind !== "schema") return undefined;
      if (s.column !== undefined) return undefined;
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
    const blocks = (moved: Action, other: Action): boolean =>
      other.transactionality !== "transactional" ||
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
        !blocks(a, planned[to - 1] as Action)
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
        !blocks(a, planned[to + 1] as Action)
      )
        to++;
      if (to > from) {
        planned.splice(from, 1);
        planned.splice(to, 0, a);
      }
    }
  }

  // ── the plan's own changes to the applier's memberships ────────────────
  const membershipOfApplier = (a: Action): string | undefined =>
    a.subject.kind === "membership" && a.subject.member === applier
      ? a.subject.role
      : undefined;
  const planGrants = new Set<string>();
  const planRevokes = new Set<string>();
  for (const a of planned) {
    const r = membershipOfApplier(a);
    if (r === undefined) continue;
    if (a.verb === "create") planGrants.add(r);
    if (a.verb === "drop") planRevokes.add(r);
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
    const ownerNow = (id: StableId): string | undefined => {
      const key = encodeId(id);
      if (!owners.has(key)) {
        let o = ownerIn(source, id);
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
    // itself, PUBLIC, or a role it is a member of
    if ([...upward(r), "PUBLIC"].some(throughout)) return "nothing";
    return isPlanned(r) && holds(desired, schema, r, "CREATE")
      ? "keep"
      : "lend";
  };

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
    if (root !== undefined) {
      add(ownerNow(root));
      // the schema the root lives in: its owner may create in it and drop
      // from it (a rename needs CREATE too). Not needed for any other
      // statement (a GRANT, a comment, an ALTER), nor when the applier may
      // already create there.
      const parent = parentOf(root);
      const container = parent === undefined ? undefined : rootOf(parent);
      const usesSchema =
        satelliteTarget(a.subject) === undefined &&
        (a.verb === "create" ||
          a.verb === "drop" ||
          a.change?.kind === "rename");
      if (container !== undefined && usesSchema) {
        const schemaName =
          container.kind === "schema" ? container.name : undefined;
        const mayCreate =
          schemaName !== undefined &&
          [applier, "PUBLIC", ...inheritedSet].some((g) =>
            holds(source, schemaName, g, "CREATE"),
          );
        if (!mayCreate) add(ownerNow(container));
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
      if (schema?.kind === "schema" && lendKind(schema.name, r) !== "nothing")
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
  {
    const walk = tracker();
    for (const a of planned) {
      const needs = needsOf(a, walk.ownerNow);
      for (const r of needs.touched) touched.add(r);
      for (const r of needs.missing) missing.add(r);
      walk.step(a);
    }
  }
  const toBorrow = [...missing].filter((r) => borrowable(r).ok);
  // PG16+: how the desired database shows the applier holding `r`, through
  // any grantor (advisory extract fields; the diff does not see them)
  const desiredUse = (
    r: string,
  ): { inherit: boolean; set: boolean } | undefined => {
    const p = modern ? desired.get(selfId(r))?.payload : undefined;
    return p?.["_inherit"] === undefined
      ? undefined
      : { inherit: p["_inherit"] === true, set: p["_set"] === true };
  };
  const keeps = (r: string): boolean =>
    desiredUse(r)?.inherit === true || desiredUse(r)?.set === true;
  // a role the plan creates and the desired database shows the applier
  // holding in full: CREATE ROLE gives its creator ADMIN only, the GRANT is
  // the rest
  for (const r of createdByPlan) {
    const want = desiredUse(r);
    if (want?.inherit === true && want.set && borrowable(r).ok)
      toBorrow.push(r);
  }
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
  const ownRow = (r: string) =>
    modern ? (cap.selfGrants ?? []).find((g) => g.role === r) : undefined;
  const withOptions = (r: string, inherit: boolean, set: boolean) =>
    `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT ${inherit ? "TRUE" : "FALSE"}, SET ${set ? "TRUE" : "FALSE"}`;
  const borrowSql = (r: string) =>
    ownRow(r) !== undefined
      ? withOptions(r, true, true)
      : modern && cap.inherit !== true
        ? `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT TRUE`
        : `GRANT ${qid(r)} TO ${qid(applier)}`;
  // the plan's own REVOKE of a borrowed role from the applier would give the
  // role back too early: the closing REVOKE replaces it. Its own GRANT of
  // that role, when it is the very statement the borrow writes, is the borrow.
  const list = without(planned, (a) => {
    const r = membershipOfApplier(a);
    if (r === undefined || !borrowed.has(r)) return false;
    return a.verb === "drop" || (a.verb === "create" && a.sql === borrowSql(r));
  });

  // ── 4. refuse: an ambiguous grantor ─────────────────────────────────────
  // Postgres records as grantor of a GRANT / REVOKE the executing role when
  // it owns the object; otherwise the first role, among the executing role
  // and those it inherits, that holds the grant options on that object (its
  // owner holds them all) or, for a role, ADMIN. A superuser always records
  // the owner. So a statement is attributed as under a superuser unless a
  // role the applier acts through, other than the owner, also holds a grant
  // option on that very object. That is rare and silent, so it is refused.
  const newlyInherited = [...viaBorrowed].filter(
    (r) => r !== applier && !inheritedSet.has(r),
  );
  const fresh = new Set(newlyInherited);
  /** per object: the roles holding a grant option on it, in either state */
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
  if (newlyInherited.length > 0) {
    const membershipActions = list.filter(
      (a) =>
        modern &&
        a.subject.kind === "membership" &&
        !(
          (cap.adminOf ?? []).includes(a.subject.role) ||
          createdByPlan.has(a.subject.role)
        ),
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
      const root = rootOf(id.target) ?? id.target;
      const o = walk.ownerNow(root);
      // what the statement grants or, for a REVOKE of everything, takes away
      const privileges = (fb: FactBase) =>
        (fb.get(id)?.payload["privileges"] as string[] | undefined) ?? [];
      const asked =
        privileges(desired).length > 0
          ? privileges(desired)
          : privileges(source);
      const asOwner = o !== undefined && canInherit(o);
      // as the owner itself the applier is always the grantor
      for (const [h, held] of o === applier
        ? []
        : (optionHolders.get(encodeId(root)) ?? [])) {
        if (h === o) continue;
        // beside the owner, who holds every option, only a role holding all
        // the options asked for can be picked instead
        const hazard = asOwner
          ? (h === applier || inheritedSet.has(h) || fresh.has(h)) &&
            asked.every((x) => held.has(x))
          : fresh.has(h);
        if (!hazard) continue;
        block(
          "capability_acl_grantor",
          h,
          asOwner
            ? `holds a grant option on an object owned by "${o}", whose privileges the applier also has while the plan runs; Postgres could record either as the grantor of the plan's GRANT / REVOKE on it. Take the grant option away from "${h}", or apply as a superuser`
            : `holds a grant option on an object the plan grants or revokes on, and the plan must borrow it (or a role that is a member of it) to act as an owner; Postgres could then record it as the grantor. Take the grant option away from "${h}", or apply as a superuser`,
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
      if (cur !== undefined && source.has(a.subject) && !canInherit(cur)) {
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
          canInherit(so) &&
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
    const openAction = membershipStatement(r, borrowSql(r));
    const createdAt = list.find(
      (a) => a.verb === "create" && roleSubject(a) === r,
    );
    // nothing to grant when the applier already has full use of the role and
    // only the plan's REVOKE is postponed
    if (inheritedSet.has(r) && settableSet.has(r)) {
      // no statement
    } else if (createdAt === undefined) head.push(openAction);
    else after.set(createdAt, [openAction, ...(after.get(createdAt) ?? [])]);
    // a role the plan drops takes the membership with it; one the plan
    // grants to the applier stays granted
    if (list.some((a) => a.verb === "drop" && roleSubject(a) === r)) continue;
    if (planGrants.has(r)) continue;
    // PG16+: the row the applier had granted itself goes back as it was
    const was = ownRow(r);
    const want = desiredUse(r);
    const keepsMembership =
      !modern && source.has(selfId(r)) && !planRevokes.has(r);
    if (was !== undefined && !planRevokes.has(r))
      tail.push(membershipStatement(r, withOptions(r, was.inherit, was.set)));
    else if (want !== undefined && keeps(r) && !planRevokes.has(r)) {
      // the desired database shows the applier holding the role: it stays,
      // narrowed when only one of INHERIT / SET is wanted
      if (!(want.inherit && want.set))
        tail.push(
          membershipStatement(r, withOptions(r, want.inherit, want.set)),
        );
    } else if (!keepsMembership)
      tail.push(
        membershipStatement(r, `REVOKE ${qid(r)} FROM ${qid(applier)}`),
      );
  }
  // PG16+, the other direction: a role the applier had granted itself in
  // full, that the plan used, and that the desired database shows it no
  // longer holding. The creator's ADMIN-only row hides that from the diff.
  for (const g of modern ? (cap.selfGrants ?? []) : []) {
    const r = g.role;
    const want = desiredUse(r);
    // used: directly, or as the way to a role a statement used
    if (borrowed.has(r) || planRevokes.has(r)) continue;
    if (!intersects(upward(r), touched)) continue;
    if (!(g.inherit && g.set) || want === undefined || keeps(r)) continue;
    if (list.some((a) => a.verb === "drop" && roleSubject(a) === r)) continue;
    tail.push(membershipStatement(r, `REVOKE ${qid(r)} FROM ${qid(applier)}`));
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

  const bound = borrowed.size > 0 || lends.length > 0;
  return {
    actions,
    blockers: [...blockerMap.values()],
    ...(bound ? { boundApplier: applier } : {}),
  };
}
