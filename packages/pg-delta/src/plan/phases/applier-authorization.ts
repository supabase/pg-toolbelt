/**
 * Applier authorization pass ("assume-owner envelope").
 *
 * A plan is one program run by ONE role (the applier) against a desired state
 * with many owners. A superuser is authorized for every statement; a
 * non-superuser (CREATEROLE) applier is authorized per statement by the
 * authorization state at that point of the plan: who owns the object, which
 * roles it holds, which schema ACLs exist. The dependency graph models none of
 * that, so this pass runs on the final ordered + compacted list, only for a
 * known non-superuser capability, and never touches the graph.
 *
 * Contract — SOUND OR LOUD: it never predicts Postgres's authorization in order
 * to refuse. It refuses (a plan blocker) only on exact rules, and otherwise
 * lets the apply fail with Postgres's own error.
 * Classification reads only action ids and the two fact bases, never SQL.
 *
 * Invariant: only grant-family statements (GRANT/REVOKE on objects and
 * memberships) depend on WHO runs them — Postgres picks their grantor from
 * every role the applier inherits. Each runs under exactly one explicit
 * identity; everything else either errors or has one effect, so it may run
 * as the widened applier.
 *
 *  1. Membership statements (PG16+): every one carries `GRANTED BY
 *     <applier>` and the full desired `WITH [ADMIN x,] INHERIT y, SET z` (the
 *     applier's own row never ADMIN: 0LP01). Blocker when the applier has no
 *     direct ADMIN on the role, or when a row of another grantor would have
 *     to change or lose an option (only that grantor can).
 *  2. Bounded strata: role creates, membership widenings and schema-ACL
 *     widenings move earlier; membership narrowings, role drops and schema-ACL
 *     narrowings move later. A move stops at the first action it conflicts
 *     with (an id written by either side — an owner change writes its object
 *     — any other membership action, a non-transactional statement).
 *  3. Blockers on owner changes: the NEW owner must be settable or
 *     self-grantable; the CURRENT owner's privileges must be inherited or
 *     obtainable.
 *  4. Temporary schema CREATE: a new owner without CREATE on the object's
 *     schema gets `GRANT CREATE` / `REVOKE CREATE` around the owner change, when
 *     the applier can act as the schema owner; otherwise nothing is emitted.
 *  5. Envelope: every role that owns something an action touches (one-hop
 *     closure over parents, satellite targets, dependency targets and
 *     inheritance children, in both states) and that the applier cannot use
 *     yet is granted to the applier (OPEN, after the role exists) and the
 *     applier's own grant row is restored afterwards (CLOSE). A role the
 *     applier cannot grant itself is skipped silently.
 *  6. Object-ACL statements (and the temporary CREATE wrapper) run inside
 *     `SET ROLE <owner at that point>` / `RESET ROLE`, so the owner is the
 *     grantor as under a superuser. Brackets never span a segment boundary
 *     or a non-transactional statement. When the owner cannot be set or
 *     cannot resolve the name, the statement runs as the applier and is a
 *     blocker if a role the envelope opened holds a grant option on it.
 *
 * Declared limits: grant provenance (which grantor row carries an option) is
 * not modelled; an owner change whose new owner needs more than a schema
 * CREATE (publication → database CREATE, FDW → superuser) fails at apply; a
 * failure in a later transaction segment leaves the envelope open (visible to
 * the next plan as a membership delta); a plan bound to the applier refuses to
 * run as another role (apply.ts).
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

export interface AuthorizationInput {
  capability: ApplierCapability;
  source: FactBase;
  desired: FactBase;
}

export interface AuthorizationResult {
  actions: Action[];
  blockers: PlanBlocker[];
  /** set when the plan names the applier (GRANTED BY, envelope) or runs
   *  statements under SET ROLE: only that role may run it */
  boundApplier?: string;
}

type MembershipId = { kind: "membership"; role: string; member: string };
type AclId = {
  kind: "acl";
  target: StableId;
  grantee: string;
  column?: string;
};

const MAX_ANCESTOR_HOPS = 8;

const idsOf = (a: Action): StableId[] => [
  ...a.produces,
  ...a.consumes,
  ...a.destroys,
  ...a.releases,
];

const roleNameOf = (id: StableId): string | undefined =>
  id.kind === "role" ? (id as { name: string }).name : undefined;

function ownerIn(fb: FactBase, id: StableId): string | undefined {
  for (const e of fb.outgoingEdges(id)) {
    if (e.kind === "owner" && e.to.kind === "role")
      return (e.to as { name: string }).name;
  }
  return undefined;
}

function newAction(sql: string, consumes: StableId[]): Action {
  return {
    sql,
    verb: "alter",
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

/** An action that sets `object`'s owner to `role`: an `ALTER … OWNER TO`
 *  (alter, consumes exactly the object + the role) or a folded
 *  `CREATE SCHEMA … AUTHORIZATION` (create of a schema consuming its owner). */
function ownerChangeOf(
  a: Action,
  desired: FactBase,
): { object: StableId; role: string; creates: boolean } | undefined {
  if (a.verb === "alter") {
    if (a.produces.length > 0 || a.destroys.length > 0) return undefined;
    if (a.consumes.length !== 2) return undefined;
    const roles = a.consumes.filter((id) => id.kind === "role");
    const objects = a.consumes.filter((id) => id.kind !== "role");
    if (roles.length !== 1 || objects.length !== 1) return undefined;
    const object = objects[0] as StableId;
    const role = roleNameOf(roles[0] as StableId) as string;
    if (ruleFlag(object.kind, "ownerAlterPrefix") === undefined)
      return undefined;
    if (ownerIn(desired, object) !== role) return undefined;
    return { object, role, creates: false };
  }
  if (a.verb === "create" && a.produces.length === 1) {
    const object = a.produces[0] as StableId;
    if (object.kind !== "schema") return undefined;
    const owner = ownerIn(desired, object);
    if (owner === undefined) return undefined;
    if (!a.consumes.some((id) => roleNameOf(id) === owner)) return undefined;
    return { object, role: owner, creates: true };
  }
  return undefined;
}

/** Options as booleans; a <=15 payload (no per-grant options) reads as
 *  SET/INHERIT on when the membership exists. */
function membershipOptions(
  fb: FactBase,
  id: MembershipId,
): { admin: boolean; set: boolean; inherit: boolean } | undefined {
  const fact = fb.get(id);
  if (fact === undefined) return undefined;
  const p = fact.payload;
  return {
    admin: p["admin"] === true,
    set: typeof p["set"] === "boolean" ? p["set"] : true,
    inherit: typeof p["inherit"] === "boolean" ? p["inherit"] : true,
  };
}

type Direction = "widen" | "narrow" | "mixed" | "none";

function membershipDirection(
  a: Action,
  source: FactBase,
  desired: FactBase,
): Direction {
  const ids = idsOf(a).filter((id) => id.kind === "membership");
  if (ids.length === 0) return "none";
  let widen = false;
  let narrow = false;
  for (const id of ids as MembershipId[]) {
    const from = membershipOptions(source, id);
    const to = membershipOptions(desired, id);
    if (a.verb === "create" && a.produces.length > 0) widen = true;
    else if (a.verb === "drop") narrow = true;
    else if (from !== undefined && to !== undefined) {
      for (const key of ["admin", "set", "inherit"] as const) {
        if (!from[key] && to[key]) widen = true;
        if (from[key] && !to[key]) narrow = true;
      }
    }
  }
  return widen && narrow
    ? "mixed"
    : widen
      ? "widen"
      : narrow
        ? "narrow"
        : "none";
}

function schemaAclDirection(
  a: Action,
  source: FactBase,
  desired: FactBase,
): Direction {
  const ids = idsOf(a).filter(
    (id) =>
      id.kind === "acl" &&
      (id as AclId).target.kind === "schema" &&
      (id as AclId).column === undefined,
  );
  if (ids.length === 0) return "none";
  const privs = (fb: FactBase, id: StableId): string[] =>
    (fb.get(id)?.payload["privileges"] as string[] | undefined) ?? [];
  let narrow = false;
  for (const id of ids) {
    const to = new Set(privs(desired, id));
    if (privs(source, id).some((p) => !to.has(p))) narrow = true;
  }
  return narrow ? "narrow" : "widen";
}

interface Keys {
  writes: Set<string>;
  touch: Set<string>;
  membership: boolean;
}

function keysOf(a: Action, desired: FactBase): Keys {
  const writes = new Set([...a.produces, ...a.destroys].map(encodeId));
  // An owner change rewrites the old owner's ACL items to the new owner, so
  // no ACL statement on that object may cross it (T5).
  const oc = ownerChangeOf(a, desired);
  if (oc !== undefined) writes.add(encodeId(oc.object));
  const touch = new Set<string>();
  let membership = false;
  for (const id of idsOf(a)) {
    touch.add(encodeId(id));
    if (isSatelliteId(id))
      touch.add(encodeId((id as { target: StableId }).target));
    if (id.kind === "membership") {
      membership = true;
      const m = id as MembershipId;
      touch.add(encodeId({ kind: "role", name: m.role }));
      touch.add(encodeId({ kind: "role", name: m.member }));
    }
  }
  return { writes, touch, membership };
}

const intersects = (a: Set<string>, b: Set<string>): boolean => {
  for (const k of a) if (b.has(k)) return true;
  return false;
};

/** Whether `a` and `b` may not swap: either writes an id the other touches,
 *  both are membership statements (keeps grant/revoke order, so no
 *  membership cycle can form), or either is not plainly transactional. */
function conflicts(a: Action, ka: Keys, b: Action, kb: Keys): boolean {
  if (a.transactionality !== "transactional") return true;
  if (b.transactionality !== "transactional") return true;
  if (ka.membership && kb.membership) return true;
  return intersects(ka.writes, kb.touch) || intersects(kb.writes, ka.touch);
}

export function authorizeForApplier(
  input: readonly Action[],
  ctx: AuthorizationInput,
): AuthorizationResult {
  const { capability: cap, source, desired } = ctx;
  const applier = cap.role;
  const pgMajor = cap.pgMajor;
  const modern = pgMajor !== undefined && pgMajor >= 16;
  const grantedBy = modern ? ` GRANTED BY ${qid(applier)}` : "";
  let bound = false;

  const createdByPlan = new Set<string>();
  for (const a of input) {
    if (a.verb !== "create") continue;
    for (const id of a.produces) {
      const name = roleNameOf(id);
      if (name !== undefined) createdByPlan.add(name);
    }
  }

  const usable = (r: string): boolean =>
    r === applier || (cap.usableRoles ?? cap.memberOf).includes(r);
  const settable = (r: string): boolean =>
    r === applier || (cap.settableRoles ?? cap.memberOf).includes(r);
  const selfGrantable = (r: string): { ok: boolean; reason: string } => {
    const no = (reason: string) => ({ ok: false, reason });
    if (r.startsWith("pg_")) return no("built-in role");
    if (isReservedMembership(cap, r))
      return no("membership is reserved by supautils");
    const roleFact =
      desired.get({ kind: "role", name: r }) ??
      source.get({ kind: "role", name: r });
    if (roleFact?.payload["superuser"] === true)
      return no("role is a superuser");
    if (pgMajor === undefined)
      return no("capability has no server version (re-probe the applier)");
    if (modern) {
      if ((cap.adminOf ?? []).includes(r) || createdByPlan.has(r))
        return { ok: true, reason: "" };
      return no("role was not created by the applier (PG16+ needs ADMIN)");
    }
    if (cap.createRole !== true) return no("applier lacks CREATEROLE");
    if (cap.inherit !== true) return no("NOINHERIT applier on PG<=15");
    if (roleFact === undefined) return no("role is not in the managed view");
    return { ok: true, reason: "" };
  };

  // The plan's own memberships of the applier, as they will be after its
  // widening statements (hoisted right after the role exists).
  const selfMembershipId = (r: string): MembershipId => ({
    kind: "membership",
    role: r,
    member: applier,
  });
  const selfWidened = new Set<string>();
  for (const a of input) {
    if (membershipDirection(a, source, desired) !== "widen") continue;
    for (const id of idsOf(a)) {
      if (id.kind === "membership" && (id as MembershipId).member === applier)
        selfWidened.add((id as MembershipId).role);
    }
  }
  const planWidensSelf = (r: string): boolean => selfWidened.has(r);
  const planGrantsUsable = (r: string): boolean => {
    if (!planWidensSelf(r)) return false;
    const opts = membershipOptions(desired, selfMembershipId(r));
    return (
      opts !== undefined &&
      opts.set &&
      opts.inherit &&
      (modern || cap.inherit === true)
    );
  };
  const planGrantsSettable = (r: string): boolean =>
    planWidensSelf(r) &&
    membershipOptions(desired, selfMembershipId(r))?.set === true;

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

  // ── 1. membership statements (PG16+) ──────────────────────────────────
  // Postgres picks a membership's grantor from every role the applier
  // inherits, so each statement names the applier explicitly (T2) and states
  // the full desired options (a single-option GRANT on a missing row would
  // default the others). The applier's own row never carries ADMIN (0LP01).
  // Rows of another grantor cannot be changed by the applier: a statement
  // that would need to is a blocker (T3), never a REVOKE that only warns.
  const rowsOf = (
    fb: FactBase,
    m: MembershipId,
  ): { grantor: string; admin: boolean; inherit: boolean; set: boolean }[] =>
    (fb.get(m)?.payload["_rows"] as
      | { grantor: string; admin: boolean; inherit: boolean; set: boolean }[]
      | undefined) ?? [];
  const membershipSubject = (a: Action): MembershipId | undefined => {
    const subject =
      a.verb === "create"
        ? a.produces.length === 1
          ? a.produces[0]
          : undefined
        : a.verb === "drop"
          ? a.produces.length === 0 && a.destroys.length === 1
            ? a.destroys[0]
            : undefined
          : a.produces.length === 0 && a.destroys.length === 0
            ? a.consumes[0]
            : undefined;
    return subject?.kind === "membership"
      ? (subject as MembershipId)
      : undefined;
  };
  const bool = (v: boolean): string => (v ? "TRUE" : "FALSE");
  const rewrittenAlters = new Set<string>();
  const list: Action[] = [];
  for (const a of input) {
    const m = modern ? membershipSubject(a) : undefined;
    if (m === undefined) {
      list.push(a);
      continue;
    }
    const self = m.member === applier;
    if (!((cap.adminOf ?? []).includes(m.role) || createdByPlan.has(m.role))) {
      block(
        "capability_membership_grantor",
        m.role,
        `the applier holds no direct ADMIN on the role, so it cannot grant or revoke it as itself (GRANTED BY ${applier})`,
        m,
      );
    }
    const to = membershipOptions(desired, m);
    const keys = self
      ? (["inherit", "set"] as const)
      : (["admin", "inherit", "set"] as const);
    for (const row of rowsOf(source, m)) {
      if (row.grantor === applier) continue;
      // the applier's implicit CREATE ROLE row (ADMIN only) is not managed
      if (self && !row.inherit && !row.set) continue;
      const mustDrop = to === undefined && !self;
      const off = keys.filter((k) => row[k] && (to === undefined || !to[k]));
      const kept = rowsOf(desired, m).find((d) => d.grantor === row.grantor);
      const changed =
        kept !== undefined &&
        (kept.admin !== row.admin ||
          kept.inherit !== row.inherit ||
          kept.set !== row.set);
      if (mustDrop || off.length > 0 || changed) {
        block(
          "capability_membership_grantor",
          row.grantor,
          mustDrop || off.length > 0
            ? `a membership row granted by "${row.grantor}" carries ${mustDrop ? "the membership" : off.join("/")}, which only that grantor can revoke`
            : `the membership row granted by "${row.grantor}" must change options, which only that grantor can do`,
          m,
        );
      }
    }
    const role = qid(m.role);
    if (a.verb === "drop") {
      list.push({
        ...a,
        sql: `REVOKE ${role} FROM ${qid(m.member)}${grantedBy}`,
      });
    } else if (to !== undefined) {
      if (a.verb === "alter") {
        if (rewrittenAlters.has(encodeId(m))) continue;
        rewrittenAlters.add(encodeId(m));
      }
      list.push({
        ...a,
        sql: `GRANT ${role} TO ${qid(m.member)} WITH ${self ? "" : `ADMIN ${bool(to.admin)}, `}INHERIT ${bool(to.inherit)}, SET ${bool(to.set)}${grantedBy}`,
      });
    } else {
      list.push(a);
      continue;
    }
    bound = true;
  }

  // ── 2. bounded strata ─────────────────────────────────────────────────
  const keys = new Map<Action, Keys>();
  const keyOf = (a: Action): Keys => {
    let k = keys.get(a);
    if (k === undefined) {
      k = keysOf(a, desired);
      keys.set(a, k);
    }
    return k;
  };
  const isRoleCreate = (a: Action): boolean =>
    a.verb === "create" &&
    a.produces.some((id) => id.kind === "role") &&
    !a.destroys.some((id) => id.kind === "role");
  const isRoleDrop = (a: Action): boolean =>
    a.verb === "drop" &&
    a.produces.length === 0 &&
    a.destroys.some((id) => id.kind === "role");
  const hoist: Action[] = [];
  const sink: Action[] = [];
  // Only statements whose every written id is a role, membership or ACL are
  // moved: the dependency graph's edges derived from fact edges (owner,
  // depends) are not visible in action ids, and for these kinds they only
  // ever point the way the move goes (roles must exist before and outlive the
  // objects that name them).
  const writesOnly = (a: Action, kinds: readonly string[]): boolean =>
    [...a.produces, ...a.destroys].every((id) => kinds.includes(id.kind));
  for (const a of list) {
    if (a.newSegmentBefore) continue;
    const m = writesOnly(a, ["role", "membership"])
      ? membershipDirection(a, source, desired)
      : "none";
    const acl = writesOnly(a, ["acl"])
      ? schemaAclDirection(a, source, desired)
      : "none";
    if (isRoleCreate(a) || m === "widen" || (m === "none" && acl === "widen"))
      hoist.push(a);
    else if (
      isRoleDrop(a) ||
      m === "narrow" ||
      (m === "none" && acl === "narrow")
    )
      sink.push(a);
  }
  for (const a of hoist) {
    const from = list.indexOf(a);
    let j = from - 1;
    while (
      j >= 0 &&
      !conflicts(list[j] as Action, keyOf(list[j] as Action), a, keyOf(a))
    )
      j--;
    if (j + 1 < from) {
      list.splice(from, 1);
      list.splice(j + 1, 0, a);
    }
  }
  for (const a of [...sink].reverse()) {
    const from = list.indexOf(a);
    let j = from + 1;
    while (
      j < list.length &&
      !conflicts(a, keyOf(a), list[j] as Action, keyOf(list[j] as Action))
    )
      j++;
    if (j - 1 > from) {
      list.splice(from, 1);
      list.splice(j - 1, 0, a);
    }
  }

  // ── 3. blockers + 4. temporary schema CREATE ─────────────────────────
  const canActAs = (r: string): boolean =>
    usable(r) || planGrantsUsable(r) || selfGrantable(r).ok;

  // Who owns what, and which roles hold CREATE / USAGE on each schema, at the
  // current point of a walk over the plan. Created objects are
  // applier-owned until their owner change. A schema with no owner edge uses
  // its raw `_owner` (e.g. `public` → pg_database_owner), else the applier
  // (an edge pruned to the default owner) (T6).
  // objects whose owner an owner change of another object carries (an owned
  // sequence follows its table), keyed by the carrier
  const followers = new Map<string, StableId[]>();
  for (const fact of desired.facts()) {
    const carrier = ruleFlag(fact.id.kind, "ownerCarrier")?.(
      fact,
      source.get(fact.id),
    );
    if (carrier === undefined) continue;
    const list = followers.get(encodeId(carrier)) ?? [];
    list.push(fact.id);
    followers.set(encodeId(carrier), list);
  }
  const tracker = () => {
    const objOwner = new Map<string, string | undefined>();
    const schemaPriv = new Map<string, Set<string>>();
    const ownerNow = (id: StableId): string | undefined => {
      const key = encodeId(id);
      if (!objOwner.has(key)) {
        let o = ownerIn(source, id);
        if (o === undefined && id.kind === "schema" && source.has(id)) {
          const raw = source.get(id)?.payload["_owner"];
          o = typeof raw === "string" ? raw : applier;
        }
        objOwner.set(key, o);
      }
      return objOwner.get(key);
    };
    const privNow = (schema: string, priv: string): Set<string> => {
      const key = `${schema}\x00${priv}`;
      let set = schemaPriv.get(key);
      if (set === undefined) {
        set = new Set();
        for (const child of source.childrenOf({
          kind: "schema",
          name: schema,
        })) {
          const id = child.id;
          if (id.kind !== "acl" || (id as AclId).column !== undefined) continue;
          const privs =
            (child.payload["privileges"] as string[] | undefined) ?? [];
          if (privs.includes(priv)) set.add((id as AclId).grantee);
        }
        schemaPriv.set(key, set);
      }
      return set;
    };
    const step = (a: Action): void => {
      const oc = ownerChangeOf(a, desired);
      for (const id of a.produces) {
        if (a.verb !== "create") continue;
        objOwner.set(encodeId(id), applier);
        if (id.kind === "schema") {
          const name = (id as { name: string }).name;
          schemaPriv.set(`${name}\x00CREATE`, new Set());
          schemaPriv.set(`${name}\x00USAGE`, new Set());
        }
      }
      if (oc !== undefined) {
        objOwner.set(encodeId(oc.object), oc.role);
        for (const f of followers.get(encodeId(oc.object)) ?? [])
          objOwner.set(encodeId(f), oc.role);
      }
      for (const id of idsOf(a)) {
        if (id.kind !== "acl") continue;
        const acl = id as AclId;
        if (acl.target.kind !== "schema" || acl.column !== undefined) continue;
        const name = (acl.target as { name: string }).name;
        const privs =
          (desired.get(id)?.payload["privileges"] as string[] | undefined) ??
          [];
        for (const priv of ["CREATE", "USAGE"]) {
          if (privs.includes(priv)) privNow(name, priv).add(acl.grantee);
          else privNow(name, priv).delete(acl.grantee);
        }
      }
    };
    return { ownerNow, privNow, step };
  };

  const inherited = (r: string): boolean =>
    usable(r) || (cap.inheritedRoles ?? []).includes(r);
  const tempGrant = new Map<Action, { schema: string; role: string }>();
  const extraTouched = new Set<string>();
  const walk = tracker();
  for (const a of list) {
    const oc = ownerChangeOf(a, desired);
    if (oc !== undefined) {
      const r = oc.role;
      if (!(settable(r) || planGrantsSettable(r) || selfGrantable(r).ok)) {
        block(
          "capability_owner",
          r,
          `new owner: the applier cannot SET ROLE to it and cannot grant it to itself (${selfGrantable(r).reason})`,
          oc.object,
        );
      }
      if (!oc.creates) {
        // acting as the CURRENT owner needs only its privileges (T4)
        const cur = walk.ownerNow(oc.object);
        if (
          cur !== undefined &&
          cur !== applier &&
          !(inherited(cur) || canActAs(cur))
        ) {
          block(
            "capability_owner",
            cur,
            `current owner: the applier does not have its privileges and cannot grant it to itself (${selfGrantable(cur).reason})`,
            oc.object,
          );
        }
        const schema = (oc.object as { schema?: unknown }).schema;
        if (oc.object.kind !== "schema" && typeof schema === "string") {
          const owner = walk.ownerNow({ kind: "schema", name: schema });
          const creators = walk.privNow(schema, "CREATE");
          if (
            r !== owner &&
            !creators.has(r) &&
            !creators.has("PUBLIC") &&
            owner !== undefined &&
            canActAs(owner)
          ) {
            tempGrant.set(a, { schema, role: r });
            if (!usable(owner) && !planGrantsUsable(owner))
              extraTouched.add(owner);
          }
        }
      }
    }
    walk.step(a);
  }

  // ── 5. envelope ───────────────────────────────────────────────────────
  const views = [source, desired];
  const ownersOf = (id: StableId, into: Set<string>): void => {
    for (const fb of views) {
      const o = ownerIn(fb, id);
      if (o !== undefined) into.add(o);
    }
  };
  const chainOf = (id: StableId): StableId[] => {
    const chain = [id];
    let cur: StableId | undefined = id;
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS && cur !== undefined; hop++) {
      const at: StableId = cur;
      cur =
        source.get(at)?.parent ??
        desired.get(at)?.parent ??
        (isSatelliteId(at) ? (at as { target: StableId }).target : undefined);
      if (cur !== undefined) chain.push(cur);
    }
    return chain;
  };
  const touched = new Set<string>(extraTouched);
  for (const a of list) {
    const ids = [...a.produces, ...a.consumes, ...a.destroys].filter(
      (id) => id.kind !== "role" && id.kind !== "membership",
    );
    for (const id of ids) {
      if (id.kind === "defaultPrivilege")
        touched.add((id as { role: string }).role);
      for (const x of chainOf(id)) {
        ownersOf(x, touched);
        for (const fb of views) {
          for (const e of fb.outgoingEdges(x)) {
            if (e.kind !== "depends") continue;
            for (const t of chainOf(e.to)) ownersOf(t, touched);
          }
          if (x.kind === "table") {
            for (const e of fb.incomingEdges(x)) {
              if (e.kind === "depends" && e.from.kind === "table")
                ownersOf(e.from, touched);
            }
          }
        }
      }
    }
    const oc = ownerChangeOf(a, desired);
    if (oc !== undefined) touched.add(oc.role);
  }
  touched.delete(applier);

  const before = new Map<Action, Action[]>();
  const after = new Map<Action, Action[]>();
  const head: Action[] = [];
  const tail: Action[] = [];
  const push = (m: Map<Action, Action[]>, at: Action, x: Action): void => {
    const xs = m.get(at) ?? [];
    xs.push(x);
    m.set(at, xs);
  };
  const applierId = { kind: "role", name: applier } as const;
  const selfKey = (r: string): string => encodeId(selfMembershipId(r));

  const opened = new Set<string>();
  for (const r of [...touched].sort()) {
    if (usable(r) || planGrantsUsable(r) || !selfGrantable(r).ok) continue;
    opened.add(r);
    const roleId: StableId = { kind: "role", name: r };
    const roleKey = encodeId(roleId);
    // OPEN after the role exists and after the plan's own widening of the
    // applier's row (so that statement cannot narrow the open envelope).
    let openAt = -1;
    list.forEach((a, i) => {
      if (a.produces.some((id) => encodeId(id) === roleKey)) openAt = i;
      if (
        idsOf(a).some((id) => encodeId(id) === selfKey(r)) &&
        membershipDirection(a, source, desired) === "widen"
      )
        openAt = i;
    });
    // CLOSE before the role is renamed/dropped or the plan narrows the row.
    let closeAt = -1;
    for (let i = openAt + 1; i < list.length; i++) {
      const a = list[i] as Action;
      if (
        a.destroys.some((id) => encodeId(id) === roleKey) ||
        (idsOf(a).some((id) => encodeId(id) === selfKey(r)) &&
          membershipDirection(a, source, desired) !== "widen")
      ) {
        closeAt = i;
        break;
      }
    }
    const open = newAction(
      `GRANT ${qid(r)} TO ${qid(applier)}${modern ? " WITH INHERIT TRUE, SET TRUE" : ""}${grantedBy}`,
      [roleId, applierId],
    );
    if (openAt < 0) head.push(open);
    else push(after, list[openAt] as Action, open);

    const anchor = closeAt < 0 ? undefined : (list[closeAt] as Action);
    if (anchor !== undefined && isRoleDrop(anchor)) {
      bound = true;
      continue; // DROP ROLE removes the envelope row
    }
    const restore = planWidensSelf(r)
      ? membershipOptions(desired, selfMembershipId(r))
      : modern
        ? cap.selfGrants?.find((g) => g.role === r)
        : undefined;
    const close = newAction(
      restore !== undefined && modern
        ? `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT ${restore.inherit ? "TRUE" : "FALSE"}, SET ${restore.set ? "TRUE" : "FALSE"}${grantedBy}`
        : `REVOKE ${qid(r)} FROM ${qid(applier)}${grantedBy}`,
      [roleId, applierId],
    );
    if (anchor === undefined) tail.push(close);
    else push(before, anchor, close);
    bound = true;
  }

  const wrapperTarget = new Map<Action, StableId>();
  for (const [a, { schema, role }] of tempGrant) {
    const schemaId: StableId = { kind: "schema", name: schema };
    const roleId: StableId = { kind: "role", name: role };
    const grant = newAction(renderGrantSql(schemaId, ["CREATE"], [role]), [
      schemaId,
      roleId,
    ]);
    const revoke = newAction(
      `REVOKE CREATE ON SCHEMA ${qid(schema)} FROM ${qid(role)}`,
      [schemaId, roleId],
    );
    wrapperTarget.set(grant, schemaId);
    wrapperTarget.set(revoke, schemaId);
    push(before, a, grant);
    push(after, a, revoke);
  }

  const assembled: Action[] = [...head];
  for (const a of list) {
    assembled.push(...(before.get(a) ?? []), a, ...(after.get(a) ?? []));
  }
  assembled.push(...tail);

  // ── 6. grant-family statements run as the object's owner (T1) ─────────
  // With the envelope open the applier inherits many roles, and Postgres
  // records as grantor the first inherited role holding the needed grant
  // option. Running the statement as the owner (what a superuser does)
  // makes the owner the grantor. The owner must be able to resolve the name
  // (schema owner or USAGE on the schema). Otherwise the statement runs as
  // the applier, and is a blocker when a role the envelope opened holds a
  // grant option on the object (the exact case where our widening could
  // pick the grantor).
  const grantOptionHolders = (target: StableId): string[] => {
    const holders = new Set<string>();
    for (const fb of views) {
      for (const child of fb.childrenOf(target)) {
        const id = child.id;
        if (id.kind !== "acl") continue;
        const grantee = (id as AclId).grantee;
        const grantable =
          (child.payload["grantable"] as string[] | undefined) ?? [];
        if (opened.has(grantee) && grantable.length > 0) holders.add(grantee);
      }
    }
    return [...holders].sort();
  };
  const runAs = tracker();
  const roleFor = (a: Action): string | undefined => {
    const targets = new Map<string, StableId>();
    const wrapped = wrapperTarget.get(a);
    if (wrapped !== undefined) targets.set(encodeId(wrapped), wrapped);
    for (const id of idsOf(a)) {
      if (id.kind !== "acl") continue;
      const t = (id as AclId).target;
      targets.set(encodeId(t), t);
    }
    if (targets.size === 0) return undefined;
    let as: string | undefined;
    if (targets.size === 1 && a.transactionality === "transactional") {
      const target = [...targets.values()][0] as StableId;
      const owner = runAs.ownerNow(target);
      if (owner === undefined || owner === applier) return undefined;
      const schema = (target as { schema?: unknown }).schema;
      const resolves =
        target.kind === "schema" ||
        typeof schema !== "string" ||
        runAs.ownerNow({ kind: "schema", name: schema }) === owner ||
        runAs.privNow(schema, "USAGE").has(owner) ||
        runAs.privNow(schema, "USAGE").has("PUBLIC");
      const canSet =
        settable(owner) || opened.has(owner) || planGrantsSettable(owner);
      if (!owner.startsWith("pg_") && canSet && resolves) as = owner;
    }
    if (as === undefined) {
      for (const target of targets.values()) {
        for (const holder of grantOptionHolders(target)) {
          block(
            "capability_acl_grantor",
            holder,
            "holds a grant option on an object whose ACL statement cannot run as its owner; with the envelope open Postgres could record it as the grantor",
            target,
          );
        }
      }
    }
    return as;
  };
  const actions: Action[] = [];
  let current: string | undefined;
  const resetRole = (): void => {
    actions.push(newAction("RESET ROLE", []));
    current = undefined;
  };
  for (const a of assembled) {
    const as = roleFor(a);
    runAs.step(a);
    if (current !== undefined && (as !== current || a.newSegmentBefore))
      resetRole();
    if (as !== undefined && current === undefined) {
      actions.push({
        ...newAction(`SET ROLE ${qid(as)}`, [{ kind: "role", name: as }]),
        newSegmentBefore: a.newSegmentBefore,
      });
      current = as;
      bound = true;
      actions.push(a.newSegmentBefore ? { ...a, newSegmentBefore: false } : a);
      continue;
    }
    actions.push(a);
  }
  if (current !== undefined) resetRole();

  return {
    actions,
    blockers: [...blockerMap.values()],
    ...(bound ? { boundApplier: applier } : {}),
  };
}
