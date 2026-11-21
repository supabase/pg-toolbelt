/**
 * Applier authorization pass (revision 4).
 *
 * A plan is run by ONE role, the applier. For a non-superuser applier
 * Postgres decides per statement, from WHO runs it, (1) whether it may run
 * and (2) for GRANT / REVOKE, which grantor it records. A superuser may run
 * everything and is always attributed as the object's owner. This pass gives
 * a non-superuser applier that same result, or fails loudly: a typed plan
 * blocker for an exact rule, otherwise Postgres's own error at apply.
 *
 * It runs on the final ordered and compacted list, only for a known
 * non-superuser capability, and classifies actions by `subject` / `verb` /
 * `change` only. Authorization state (owners, schema ACLs, memberships, grant
 * options) is read from the RAW source and desired fact bases: a grant the
 * policy filters out still exists in the database.
 *
 *  1. Ordering: role creates, membership widenings and schema-ACL widenings
 *     move earlier; membership narrowings, role drops and schema-ACL
 *     narrowings move later, each stopping at the first action it conflicts
 *     with.
 *  2. Envelope: every role whose privileges an action needs (owner of the
 *     action's root object and of the schema it lives in, of its dependency
 *     targets and inheritance children; an owner change's new owner) that the
 *     applier lacks but can grant itself is granted to it after the role
 *     exists (OPEN), and its own-grantor row is restored at the end (CLOSE).
 *     The row is opened with INHERIT and SET.
 *  3. Grantor: an ACL statement whose grantor could differ from the owner's
 *     (another role the applier inherits holds a grant option on the object)
 *     runs as the owner; a membership statement whose grantor the envelope
 *     could pick is a blocker.
 *  4. Owner changes: blockers when the new owner cannot be set or the current
 *     owner's privileges cannot be had; a temporary schema CREATE for a new
 *     owner that lacks it.
 *
 * Declared limits: tests/owner-lab/DESIGN-v4.md.
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

/** PoC measurement knob: `union` is the pass; each other value switches one
 *  mechanism off so the owner-lab can count the scenarios that need it.
 *  `nopin`: no `Action.runAs` (a grantor hazard is a blocker instead);
 *  `nowrap`: no temporary schema CREATE for a new owner; `nomoves`: no
 *  reordering. */
export type OwnerMode = "union" | "nopin" | "nowrap" | "nomoves";

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
  /** set when the plan names its applier (envelope statements, `runAs`):
   *  only that role may run it */
  boundApplier?: string;
}

type MembershipId = Extract<StableId, { kind: "membership" }>;
type SelfRow = { inherit: boolean; set: boolean };

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

const selfRowOf = (
  fb: FactBase,
  role: string,
  member: string,
): SelfRow | undefined =>
  fb.get({ kind: "membership", role, member })?.payload["self"] as
    | SelfRow
    | undefined;

/** What a move may not cross: every id an action's ordering edges carry,
 *  its subject, and the ids its change names, plus the roles inside them. */
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
    if (id.kind === "membership") {
      keys.add(encodeId({ kind: "role", name: id.role }));
      keys.add(encodeId({ kind: "role", name: id.member }));
    }
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
  const pin = ctx.mode !== "nopin";
  const views = [source, desired];

  const inheritedSet = new Set(cap.inheritedRoles ?? cap.memberOf);
  const settableSet = new Set(cap.settableRoles ?? cap.memberOf);
  const inherited = (r: string) => r === applier || inheritedSet.has(r);
  const settable = (r: string) => r === applier || settableSet.has(r);

  const roleSubject = (a: Action): string | undefined =>
    a.subject.kind === "role" ? a.subject.name : undefined;
  const createdByPlan = new Set<string>();
  for (const a of input) {
    const r = roleSubject(a);
    if (r !== undefined && a.verb === "create") createdByPlan.add(r);
  }

  // Roles whose membership of the applier the plan manages itself. The
  // envelope leaves them alone; what the desired state gives the applier on
  // them counts, once the plan's own (moved earlier) statements ran.
  const planSelf = new Set<string>();
  for (const a of input) {
    if (a.subject.kind === "membership" && a.subject.member === applier)
      planSelf.add(a.subject.role);
  }
  const planGives = (r: string, option: "inherit" | "set"): boolean => {
    if (!planSelf.has(r)) return false;
    if (!desired.has({ kind: "membership", role: r, member: applier }))
      return false;
    if (!modern) return option === "set" || cap.inherit === true;
    return selfRowOf(desired, r, applier)?.[option] === true;
  };

  const selfGrantable = (r: string): { ok: boolean; reason: string } => {
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
  const list: Action[] = input.filter(
    (a) =>
      !(
        modern &&
        a.verb === "create" &&
        a.subject.kind === "membership" &&
        a.subject.member === applier &&
        desired.get(a.subject)?.payload["admin"] === true &&
        (createdByPlan.has(a.subject.role) ||
          (cap.adminOf ?? []).includes(a.subject.role))
      ),
  );

  // ── 1. bounded moves ────────────────────────────────────────────────────
  type Direction = "earlier" | "later" | undefined;
  const compare = (from: boolean[], to: boolean[]): Direction => {
    const widen = from.some((f, i) => !f && to[i] === true);
    const narrow = from.some((f, i) => f && to[i] !== true);
    if (widen === narrow) return undefined;
    return widen ? "earlier" : "later";
  };
  const directionOf = (a: Action): Direction => {
    const s = a.subject;
    if (s.kind === "role" || s.kind === "membership") {
      if (a.verb === "create") return "earlier";
      if (a.verb === "drop") return "later";
    }
    if (s.kind === "membership" && a.change?.kind === "attribute") {
      if (a.change.name === "admin")
        return desired.get(s)?.payload["admin"] === true ? "earlier" : "later";
      if (a.change.name === "self") {
        const flags = (r: SelfRow | undefined) =>
          r === undefined ? [false, false, false] : [true, r.inherit, r.set];
        return compare(
          flags(selfRowOf(source, s.role, s.member)),
          flags(selfRowOf(desired, s.role, s.member)),
        );
      }
      return undefined;
    }
    if (
      s.kind === "acl" &&
      s.target.kind === "schema" &&
      s.column === undefined
    ) {
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
      const all = [...new Set([...from, ...to])];
      return compare(
        all.map((g) => from.has(g)),
        all.map((g) => to.has(g)),
      );
    }
    return undefined;
  };
  const namedCache = new Map<Action, Set<string>>();
  const writtenCache = new Map<Action, Set<string>>();
  const namedOf = (a: Action) => {
    let k = namedCache.get(a);
    if (k === undefined) namedCache.set(a, (k = namedKeys(a)));
    return k;
  };
  const writtenOf = (a: Action) => {
    let k = writtenCache.get(a);
    if (k === undefined) writtenCache.set(a, (k = writtenKeys(a)));
    return k;
  };
  /** whether `moved` may not pass `other` */
  const blocks = (moved: Action, other: Action): boolean =>
    other.transactionality !== "transactional" ||
    (moved.subject.kind === "membership" &&
      other.subject.kind === "membership") ||
    intersects(writtenOf(other), namedOf(moved)) ||
    intersects(writtenOf(moved), namedOf(other));
  const movable = (a: Action) =>
    a.transactionality === "transactional" && !a.newSegmentBefore;
  const earlier = list.filter(
    (a) => movable(a) && directionOf(a) === "earlier",
  );
  const later = list.filter((a) => movable(a) && directionOf(a) === "later");
  for (const a of ctx.mode === "nomoves" ? [] : earlier) {
    const from = list.indexOf(a);
    let to = from;
    // passing an action that opens a segment would move `a` into the
    // previous transaction
    while (
      to > 0 &&
      !(list[to] as Action).newSegmentBefore &&
      !blocks(a, list[to - 1] as Action)
    )
      to--;
    if (to < from) {
      list.splice(from, 1);
      list.splice(to, 0, a);
    }
  }
  for (const a of ctx.mode === "nomoves" ? [] : [...later].reverse()) {
    const from = list.indexOf(a);
    let to = from;
    while (
      to + 1 < list.length &&
      !(list[to + 1] as Action).newSegmentBefore &&
      !blocks(a, list[to + 1] as Action)
    )
      to++;
    if (to > from) {
      list.splice(from, 1);
      list.splice(to, 0, a);
    }
  }

  // ── owner tracking (a walk over the list in order) ──────────────────────
  const ownerChanged = new Set<string>();
  for (const a of list) {
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
    const schemaPriv = new Map<string, Set<string>>();
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
    const schemaPrivNow = (schema: string, priv: string): Set<string> => {
      const key = `${schema}\x00${priv}`;
      let set = schemaPriv.get(key);
      if (set === undefined) {
        set = new Set();
        for (const child of source.childrenOf({
          kind: "schema",
          name: schema,
        })) {
          const id = child.id;
          if (id.kind !== "acl" || id.column !== undefined) continue;
          const privs =
            (child.payload["privileges"] as string[] | undefined) ?? [];
          if (privs.includes(priv)) set.add(id.grantee);
        }
        schemaPriv.set(key, set);
      }
      return set;
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
      } else if (a.verb === "create" && ownable(s)) {
        // created as the applier; with no owner change of its own the create
        // itself set the desired owner (CREATE SCHEMA … AUTHORIZATION)
        if (ownerNow(s) === undefined)
          owners.set(
            key,
            ownerChanged.has(key) ? applier : (ownerIn(desired, s) ?? applier),
          );
        if (s.kind === "schema") {
          schemaPriv.set(`${s.name}\x00CREATE`, new Set());
          schemaPriv.set(`${s.name}\x00USAGE`, new Set());
        }
      } else if (a.verb === "drop" && ownable(s)) {
        owners.set(key, undefined);
      }
      if (
        s.kind === "acl" &&
        s.target.kind === "schema" &&
        s.column === undefined
      ) {
        const privs =
          a.verb === "drop"
            ? []
            : ((desired.get(s)?.payload["privileges"] as
                | string[]
                | undefined) ?? []);
        for (const priv of ["CREATE", "USAGE"]) {
          if (privs.includes(priv))
            schemaPrivNow(s.target.name, priv).add(s.grantee);
          else schemaPrivNow(s.target.name, priv).delete(s.grantee);
        }
      }
    };
    return { ownerNow, schemaPrivNow, step };
  };

  /** The role that acts on the subject as its owner: the owner of its root
   *  object, or the role a default privilege belongs to (defaclrole). */
  const ownerRoleOf = (
    a: Action,
    ownerNow: (id: StableId) => string | undefined,
  ): string | undefined => {
    if (a.subject.kind === "defaultPrivilege") return a.subject.role;
    const root = rootOf(a.subject);
    return root === undefined ? undefined : ownerNow(root);
  };

  /** Roles whose privileges (`inherit`) or SET (`set`) an action needs and
   *  the applier does not have. */
  const needsOf = (
    a: Action,
    ownerNow: (id: StableId) => string | undefined,
  ): Set<string> => {
    const inherit = new Set<string>();
    const add = (r: string | undefined) => {
      if (r !== undefined) inherit.add(r);
    };
    add(ownerRoleOf(a, ownerNow));
    const root = rootOf(a.subject);
    if (root !== undefined) {
      // the schema (or other owned container) the root lives in: CREATE in
      // it, or DROP by its owner
      const parent = parentOf(root);
      if (parent !== undefined) {
        const container = rootOf(parent);
        if (container !== undefined) add(ownerNow(container));
      }
      for (const fb of views) {
        for (const e of fb.outgoingEdges(root)) {
          if (e.kind !== "depends") continue;
          const target = rootOf(e.to);
          if (target !== undefined) add(ownerNow(target));
        }
        // inheritance / partition children: dependents of the same kind
        for (const e of fb.incomingEdges(root)) {
          if (e.kind === "depends" && e.from.kind === root.kind)
            add(ownerNow(e.from));
        }
      }
    }
    const out = new Set<string>();
    for (const r of inherit) {
      if (!inherited(r) && !planGives(r, "inherit")) out.add(r);
    }
    if (a.change?.kind === "owner") {
      const r = a.change.to;
      if (!settable(r) && !planGives(r, "set")) out.add(r);
    }
    return out;
  };

  // ── 2. envelope roles ───────────────────────────────────────────────────
  const needed = new Set<string>();
  {
    const walk = tracker();
    for (const a of list) {
      for (const r of needsOf(a, walk.ownerNow)) needed.add(r);
      walk.step(a);
    }
  }
  const envelope = new Set(
    [...needed].filter((r) => !planSelf.has(r) && selfGrantable(r).ok).sort(),
  );
  // roles the applier inherits through the envelope (every membership of an
  // envelope role, transitively)
  const viaEnvelope = new Set<string>();
  {
    const queue = [...envelope];
    while (queue.length > 0) {
      const r = queue.pop() as string;
      if (viaEnvelope.has(r)) continue;
      viaEnvelope.add(r);
      for (const fb of views) {
        for (const fact of fb.facts()) {
          if (fact.id.kind === "membership" && fact.id.member === r)
            queue.push(fact.id.role);
        }
      }
    }
  }
  const canSet = (r: string) =>
    settable(r) || envelope.has(r) || planGives(r, "set");
  const canInherit = (r: string) =>
    inherited(r) || envelope.has(r) || planGives(r, "inherit");

  // ── 3./4. identity, blockers, temporary schema CREATE ──────────────────
  const grantOptionHolders = (target: StableId): Set<string> => {
    const holders = new Set<string>();
    for (const fb of views) {
      for (const child of fb.childrenOf(target)) {
        if (child.id.kind !== "acl") continue;
        const grantable =
          (child.payload["grantable"] as string[] | undefined) ?? [];
        if (grantable.length > 0) holders.add(child.id.grantee);
      }
    }
    return holders;
  };
  const adminHolders = (role: string): Set<string> => {
    const holders = new Set<string>();
    for (const fb of views) {
      for (const fact of fb.facts()) {
        if (
          fact.id.kind === "membership" &&
          fact.id.role === role &&
          fact.payload["admin"] === true
        )
          holders.add(fact.id.member);
      }
    }
    return holders;
  };
  const selfId = (r: string): MembershipId => ({
    kind: "membership",
    role: r,
    member: applier,
  });
  const roleIds = (r: string): StableId[] => [
    { kind: "role", name: r },
    { kind: "role", name: applier },
  ];
  const selfGrant = (r: string, inherit: boolean, set: boolean): Action =>
    synthetic(
      `GRANT ${qid(r)} TO ${qid(applier)} WITH INHERIT ${inherit ? "TRUE" : "FALSE"}, SET ${set ? "TRUE" : "FALSE"} GRANTED BY ${qid(applier)}`,
      selfId(r),
      "self",
      roleIds(r),
    );

  const before = new Map<Action, Action[]>();
  const after = new Map<Action, Action[]>();
  const push = (m: Map<Action, Action[]>, at: Action, x: Action): void => {
    m.set(at, [...(m.get(at) ?? []), x]);
  };
  const runAsOf = new Map<Action, string>();
  let bound = envelope.size > 0;

  /** `GRANT <privilege> ON SCHEMA` to `grantee` right before `a` and its
   *  REVOKE right after, both as the schema owner `so` (so the owner is the
   *  grantor and the REVOKE removes exactly that grant). */
  const wrapSchemaPrivilege = (
    a: Action,
    schemaName: string,
    privilege: string,
    grantee: string,
    so: string,
  ): void => {
    const schema: StableId = { kind: "schema", name: schemaName };
    const aclId: StableId = { kind: "acl", target: schema, grantee };
    const consumes: StableId[] = [schema, { kind: "role", name: grantee }];
    const grant = synthetic(
      renderGrantSql(schema, [privilege], [grantee]),
      aclId,
      "privileges",
      consumes,
    );
    const revoke = synthetic(
      `REVOKE ${privilege} ON SCHEMA ${qid(schemaName)} FROM ${qid(grantee)}`,
      aclId,
      "privileges",
      consumes,
    );
    if (so !== applier && pin) {
      runAsOf.set(grant, so);
      runAsOf.set(revoke, so);
    }
    before.set(a, [grant, ...(before.get(a) ?? [])]);
    after.set(a, [...(after.get(a) ?? []), revoke]);
    bound = true;
  };

  const walk = tracker();
  for (const a of list) {
    const newOwner = a.change?.kind === "owner" ? a.change.to : undefined;

    // object ACL statements: the grantor must be the owner, as under a
    // superuser. Postgres picks the owner unless another role the applier
    // inherits holds a grant option on the object.
    if (a.subject.kind === "acl" && !runAsOf.has(a)) {
      const target = a.subject.target;
      const root = rootOf(target);
      const o = root === undefined ? undefined : walk.ownerNow(root);
      if (o !== undefined && o !== applier) {
        const hazard = [...grantOptionHolders(target)].filter(
          (h) => h !== o && (inherited(h) || viaEnvelope.has(h)),
        );
        if (hazard.length > 0) {
          if (pin && canSet(o)) runAsOf.set(a, o);
          else {
            for (const h of hazard.filter((x) => viaEnvelope.has(x))) {
              block(
                "capability_acl_grantor",
                h,
                `holds a grant option on an object owned by "${o}", which the applier cannot run its ACL statements as; with the owner envelope open Postgres could record "${h}" as the grantor`,
                target,
              );
            }
          }
        }
      }
    }

    // membership statements (PG16+): Postgres picks the grantor from every
    // role the applier inherits. The member's own row names its grantor.
    if (
      modern &&
      a.subject.kind === "membership" &&
      !(a.change?.kind === "attribute" && a.change.name === "self")
    ) {
      const g = a.subject.role;
      if (!((cap.adminOf ?? []).includes(g) || createdByPlan.has(g))) {
        for (const e of adminHolders(g)) {
          if (!viaEnvelope.has(e)) continue;
          block(
            "capability_membership_grantor",
            e,
            `holds ADMIN on "${g}" and the applier holds none directly; with the owner envelope open Postgres would record "${e}" as the grantor`,
            a.subject,
          );
        }
      }
    }

    // a statement run as an owner that cannot look up names in the schema
    // its object lives in gets USAGE there for that statement only
    const as = runAsOf.get(a);
    const root = rootOf(a.subject);
    const home = root === undefined ? undefined : parentOf(root);
    if (as !== undefined && home?.kind === "schema") {
      const so = walk.ownerNow(home);
      const users = walk.schemaPrivNow(home.name, "USAGE");
      if (
        so !== undefined &&
        as !== so &&
        !users.has(as) &&
        !users.has("PUBLIC") &&
        canSet(so)
      ) {
        wrapSchemaPrivilege(a, home.name, "USAGE", as, so);
      }
    }

    if (newOwner !== undefined) {
      if (!canSet(newOwner)) {
        block(
          "capability_owner",
          newOwner,
          `new owner: the applier cannot SET ROLE to it and cannot grant it to itself (${selfGrantable(newOwner).reason})`,
          a.subject,
        );
      }
      const cur = walk.ownerNow(a.subject);
      if (cur !== undefined && source.has(a.subject) && !canInherit(cur)) {
        block(
          "capability_owner",
          cur,
          `current owner: the applier does not have its privileges and cannot grant it to itself (${selfGrantable(cur).reason})`,
          a.subject,
        );
      }
      // the new owner needs CREATE on the object's schema (a superuser's
      // ALTER … OWNER TO skips that check)
      const schema =
        a.subject.kind === "schema" ? undefined : parentOf(a.subject);
      if (schema?.kind === "schema") {
        const so = walk.ownerNow(schema);
        const creators = walk.schemaPrivNow(schema.name, "CREATE");
        if (
          so !== undefined &&
          newOwner !== so &&
          !creators.has(newOwner) &&
          !creators.has("PUBLIC") &&
          canSet(so) &&
          ctx.mode !== "nowrap"
        ) {
          wrapSchemaPrivilege(a, schema.name, "CREATE", newOwner, so);
        }
      }
    }
    walk.step(a);
  }

  // ── assemble: OPEN after the role exists, CLOSE at the end (a role the
  // plan drops loses the row with it) ─────────────────────────────────────
  const head: Action[] = [];
  const tail: Action[] = [];
  for (const r of envelope) {
    const open = modern
      ? selfGrant(r, true, true)
      : synthetic(
          `GRANT ${qid(r)} TO ${qid(applier)}`,
          selfId(r),
          "self",
          roleIds(r),
        );
    const createdAt = list.find(
      (a) => a.verb === "create" && roleSubject(a) === r,
    );
    if (createdAt === undefined) head.push(open);
    else push(after, createdAt, open);
    if (list.some((a) => a.verb === "drop" && roleSubject(a) === r)) continue;
    const restore = modern ? selfRowOf(source, r, applier) : undefined;
    tail.push(
      restore !== undefined
        ? selfGrant(r, restore.inherit, restore.set)
        : synthetic(
            `REVOKE ${qid(r)} FROM ${qid(applier)}${modern ? ` GRANTED BY ${qid(applier)}` : ""}`,
            selfId(r),
            "self",
            roleIds(r),
          ),
    );
  }

  const out = (a: Action, newSegmentBefore = a.newSegmentBefore): Action => {
    const as = runAsOf.get(a);
    if (as !== undefined) bound = true;
    if (as === undefined && newSegmentBefore === a.newSegmentBefore) return a;
    return {
      ...a,
      newSegmentBefore,
      ...(as !== undefined ? { runAs: as } : {}),
    };
  };
  const actions: Action[] = head.map((a) => out(a));
  for (const a of list) {
    const pre = before.get(a) ?? [];
    // statements put before `a` run in `a`'s transaction: the segment
    // boundary `a` opens moves to the first of them
    pre.forEach((x, i) =>
      actions.push(out(x, i === 0 ? a.newSegmentBefore : false)),
    );
    actions.push(out(a, pre.length > 0 ? false : a.newSegmentBefore));
    for (const x of after.get(a) ?? []) actions.push(out(x));
  }
  for (const a of tail) actions.push(out(a));

  return {
    actions,
    blockers: [...blockerMap.values()],
    ...(bound ? { boundApplier: applier } : {}),
  };
}
