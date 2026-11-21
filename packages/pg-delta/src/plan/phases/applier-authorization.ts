/**
 * Applier authorization pass (revision 5).
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
 * The pass inserts statements and removes the ones an inserted statement
 * replaces. The only statements it moves are schema GRANT / REVOKE, and only
 * in the direction that keeps a privilege longer (step 0):
 *
 *  0. Schema ACL placement: a schema ACL statement that only adds privileges
 *     moves earlier, one that only removes them moves later, each stopping at
 *     the first statement that writes something it names. Holding a schema
 *     privilege longer can only let a crossed statement succeed, never change
 *     the result of one that succeeded.
 *  1. Envelope: every role whose privileges an action needs (owner of the
 *     action's root object and of the schema it lives in, of its dependency
 *     targets and inheritance children; an owner change's new owner) that the
 *     applier lacks but can grant itself is granted to it after the role
 *     exists (OPEN, `WITH INHERIT TRUE, SET TRUE`), and the applier's own
 *     row on that role is put in its final state at the end (CLOSE). The
 *     plan's own statements on that row are removed: CLOSE writes the desired
 *     row instead, so the applier keeps the role for the whole plan.
 *  2. Grantor: an ACL statement whose grantor could differ from the owner's
 *     (another role the applier inherits holds a grant option on the object)
 *     runs as the owner (`Action.runAs`); a membership statement whose
 *     grantor the envelope could change is a blocker.
 *  3. Owner changes: blockers when the new owner cannot be set or the current
 *     owner's privileges cannot be had; `GRANT CREATE ON SCHEMA` to the new
 *     owner right before, revoked right after unless the plan itself grants
 *     it. Decided from the two states only, never from a simulated ACL.
 *
 * Declared limits: tests/owner-lab/DESIGN-v5.md.
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
 *  `nowrap`: no temporary schema CREATE for a new owner; `nomoves`: schema
 *  ACL statements stay where the base plan put them. */
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
  (fb.get({ kind: "membership", role, member })?.payload["self"] ??
    undefined) as SelfRow | undefined;

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
  const pin = ctx.mode !== "nopin";
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

  // membership graph over BOTH states (member → roles): every membership the
  // plan could see at any step is in one of them
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
  const upwardCache = new Map<string, Set<string>>();
  const upward = (r: string): Set<string> => {
    let seen = upwardCache.get(r);
    if (seen !== undefined) return seen;
    seen = new Set<string>();
    const queue = [r];
    while (queue.length > 0) {
      const x = queue.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const up of rolesOfMember.get(x) ?? []) queue.push(up);
    }
    upwardCache.set(r, seen);
    return seen;
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
  const filtered = without(
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

  // ── 0. schema ACL placement ─────────────────────────────────────────────
  const planned = [...filtered];
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
    const named = new Map<Action, Set<string>>();
    const written = new Map<Action, Set<string>>();
    const namedOf = (a: Action) => {
      let k = named.get(a);
      if (k === undefined) named.set(a, (k = namedKeys(a)));
      return k;
    };
    const writtenOf = (a: Action) => {
      let k = written.get(a);
      if (k === undefined) written.set(a, (k = writtenKeys(a)));
      return k;
    };
    /** whether `moved` may not pass `other` */
    const blocks = (moved: Action, other: Action): boolean =>
      other.transactionality !== "transactional" ||
      intersects(writtenOf(other), namedOf(moved)) ||
      intersects(writtenOf(moved), namedOf(other));
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
      // passing an action that opens a segment would move `a` into the
      // previous transaction
      while (
        to > 0 &&
        !(planned[to] as Action).newSegmentBefore &&
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

  // ── the plan's own statements on the applier's membership in a role ─────
  const ownActions = new Map<string, Action[]>();
  for (const a of planned) {
    if (a.subject.kind !== "membership" || a.subject.member !== applier)
      continue;
    ownActions.set(a.subject.role, [
      ...(ownActions.get(a.subject.role) ?? []),
      a,
    ]);
  }
  const isSelfStatement = (a: Action) =>
    a.change?.kind === "attribute" && a.change.name === "self";
  /** A statement the envelope replaces: every statement on the applier's
   *  own row (PG16+), and the membership's REVOKE. Run by an applier that
   *  holds ADMIN directly, a plain REVOKE removes the row it granted itself,
   *  which is what CLOSE does. */
  const absorbable = (a: Action) => isSelfStatement(a) || a.verb === "drop";
  /** PG16+: the plan also grants, or changes ADMIN on, rows of that
   *  membership the applier did not grant. Their provenance is not
   *  modelled, so the role is left alone. */
  const foreignRows = (r: string) =>
    modern && (ownActions.get(r) ?? []).some((a) => !absorbable(a));
  const changesOwn = (r: string) => (ownActions.get(r) ?? []).some(absorbable);
  const planGives = (r: string, option: "inherit" | "set"): boolean =>
    foreignRows(r) && selfRowOf(desired, r, applier)?.[option] === true;

  // A role the applier has only through a row the plan changes is not
  // something a statement can rely on.
  const unstable = new Set<string>();
  for (const r of ownActions.keys()) {
    if (changesOwn(r)) for (const u of upward(r)) unstable.add(u);
  }
  const stablyInherited = (r: string) =>
    r === applier || (inheritedSet.has(r) && !unstable.has(r));
  const stablySettable = (r: string) =>
    r === applier || (settableSet.has(r) && !unstable.has(r));

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
    for (const r of touched) {
      if (!stablyInherited(r) && !planGives(r, "inherit")) missing.add(r);
    }
    if (a.change?.kind === "owner") {
      const r = a.change.to;
      touched.add(r);
      if (!stablySettable(r) && !planGives(r, "set")) missing.add(r);
    }
    return { touched, missing };
  };

  // ── 1. envelope roles ───────────────────────────────────────────────────
  const touched = new Set<string>();
  const needed = new Set<string>();
  {
    const walk = tracker();
    for (const a of planned) {
      const needs = needsOf(a, walk.ownerNow);
      for (const r of needs.touched) touched.add(r);
      for (const r of needs.missing) needed.add(r);
      walk.step(a);
    }
  }
  const openable = (r: string) => !foreignRows(r) && selfGrantable(r).ok;
  const envelopeRoles = [...needed].filter(openable);
  // a role whose own row the plan changes, and through which a statement
  // reaches a role it uses, stays open for the whole plan too
  for (const r of ownActions.keys()) {
    if (changesOwn(r) && openable(r) && intersects(upward(r), touched))
      envelopeRoles.push(r);
  }
  const envelope = new Set(envelopeRoles.sort());
  // roles the applier inherits through the envelope (every membership of an
  // envelope role, transitively)
  const viaEnvelope = new Set<string>();
  for (const r of envelope) for (const u of upward(r)) viaEnvelope.add(u);

  const canSet = (r: string) =>
    r === applier ||
    settableSet.has(r) ||
    viaEnvelope.has(r) ||
    planGives(r, "set");
  const canInherit = (r: string) =>
    r === applier ||
    inheritedSet.has(r) ||
    viaEnvelope.has(r) ||
    planGives(r, "inherit");

  // the envelope replaces the plan's own statements on those rows
  const absorbed = new Set<string>();
  const list = without(planned, (a) => {
    if (
      a.subject.kind !== "membership" ||
      a.subject.member !== applier ||
      !envelope.has(a.subject.role) ||
      !absorbable(a)
    )
      return false;
    absorbed.add(a.subject.role);
    return true;
  });

  // ── 2./3. identity, blockers, schema CREATE for a new owner ────────────
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

  /** Who must run an ACL statement on `target` (owned by `o`) so that the
   *  owner is the recorded grantor, as under a superuser. Postgres picks the
   *  owner unless another role the applier inherits holds a grant option on
   *  the object. `exact: false`: it cannot be guaranteed. */
  const grantorFor = (
    target: StableId,
    o: string | undefined,
    blockOn: StableId | undefined,
  ): { as?: string; exact: boolean } => {
    if (o === undefined || o === applier) return { exact: true };
    const hazard = [...grantOptionHolders(target)].filter(
      (h) =>
        h !== o && (h === applier || inheritedSet.has(h) || viaEnvelope.has(h)),
    );
    if (hazard.length === 0) return { exact: true };
    if (pin && canSet(o)) return { as: o, exact: true };
    if (blockOn !== undefined) {
      // a hazard the applier had before the plan is base-branch behaviour
      for (const h of hazard.filter((x) => viaEnvelope.has(x))) {
        block(
          "capability_acl_grantor",
          h,
          `holds a grant option on an object owned by "${o}", which the applier cannot run its ACL statements as; with the owner envelope open Postgres could record "${h}" as the grantor`,
          blockOn,
        );
      }
    }
    return { exact: false };
  };

  const before = new Map<Action, Action[]>();
  const after = new Map<Action, Action[]>();
  const push = (m: Map<Action, Action[]>, at: Action, x: Action): void => {
    m.set(at, [...(m.get(at) ?? []), x]);
  };
  const runAsOf = new Map<Action, string>();
  let bound = envelope.size > 0;

  // schema ACL items the plan itself writes (a GRANT merged over several
  // grantees names the first as its subject and lists all in `produces`)
  const plannedAcl = new Set<string>();
  for (const a of list) {
    if (a.subject.kind !== "acl") continue;
    plannedAcl.add(encodeId(a.subject));
    for (const id of a.produces) {
      if (id.kind === "acl") plannedAcl.add(encodeId(id));
    }
  }
  const walk = tracker();

  /** `grantee` needs `privilege` on the schema for the statement `a` only.
   *  Decided from the two states, with no simulated ACL:
   *   - it holds it (itself or through PUBLIC) before and after the plan,
   *     so at every step: nothing;
   *   - the plan itself grants it: GRANT before `a`, the plan's own
   *     statement completes the item wherever it sits;
   *   - otherwise: GRANT before `a`, REVOKE right after. A REVOKE never
   *     removes a privilege the desired state holds. */
  const lendSchemaPrivilege = (
    a: Action,
    schemaName: string,
    privilege: string,
    grantee: string,
  ): void => {
    const schema: StableId = { kind: "schema", name: schemaName };
    const so = walk.ownerNow(schema);
    if (so === undefined || so === grantee) return;
    const aclId = (g: string): StableId => ({
      kind: "acl",
      target: schema,
      grantee: g,
    });
    const has = (fb: FactBase, g: string) =>
      (
        (fb.get(aclId(g))?.payload["privileges"] as string[] | undefined) ?? []
      ).includes(privilege);
    const isPlanned = (g: string) => plannedAcl.has(encodeId(aclId(g)));
    const holdsThroughout = (g: string) =>
      has(source, g) && (!isPlanned(g) || has(desired, g));
    if (holdsThroughout(grantee) || holdsThroughout("PUBLIC")) return;
    if (!canInherit(so)) return;
    const identity = grantorFor(schema, so, undefined);
    if (!identity.exact) return;
    const consumes: StableId[] = [schema, { kind: "role", name: grantee }];
    const grant = synthetic(
      renderGrantSql(schema, [privilege], [grantee]),
      aclId(grantee),
      "privileges",
      consumes,
    );
    before.set(a, [grant, ...(before.get(a) ?? [])]);
    if (identity.as !== undefined) runAsOf.set(grant, identity.as);
    if (!(isPlanned(grantee) && has(desired, grantee))) {
      const revoke = synthetic(
        `REVOKE ${privilege} ON SCHEMA ${qid(schemaName)} FROM ${qid(grantee)}`,
        aclId(grantee),
        "privileges",
        consumes,
      );
      after.set(a, [...(after.get(a) ?? []), revoke]);
      if (identity.as !== undefined) runAsOf.set(revoke, identity.as);
    }
    bound = true;
  };

  for (const a of list) {
    const newOwner = a.change?.kind === "owner" ? a.change.to : undefined;

    // object ACL statements: the grantor must be the owner
    if (a.subject.kind === "acl") {
      const target = a.subject.target;
      const root = rootOf(target);
      const o = root === undefined ? undefined : walk.ownerNow(root);
      const identity = grantorFor(target, o, target);
      if (identity.as !== undefined) runAsOf.set(a, identity.as);
    }

    // membership statements (PG16+): Postgres picks the grantor from every
    // role the applier inherits. The member's own row names its grantor.
    if (modern && a.subject.kind === "membership" && !isSelfStatement(a)) {
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
    if (as !== undefined && home?.kind === "schema")
      lendSchemaPrivilege(a, home.name, "USAGE", as);

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
      if (schema?.kind === "schema" && ctx.mode !== "nowrap")
        lendSchemaPrivilege(a, schema.name, "CREATE", newOwner);
    }
    walk.step(a);
  }

  // ── assemble: OPEN after the role exists, CLOSE at the end (a role the
  // plan drops loses the row with it) ─────────────────────────────────────
  const head: Action[] = [];
  const tail: Action[] = [];
  const plainRevoke = (r: string): Action =>
    synthetic(
      `REVOKE ${qid(r)} FROM ${qid(applier)}${modern ? ` GRANTED BY ${qid(applier)}` : ""}`,
      selfId(r),
      "self",
      roleIds(r),
    );
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
    if (modern) {
      // the applier's own row ends as the plan wanted it (its statements
      // were removed above), or exactly as it was
      const row = selfRowOf(absorbed.has(r) ? desired : source, r, applier);
      tail.push(
        row !== undefined ? selfGrant(r, row.inherit, row.set) : plainRevoke(r),
      );
    } else {
      // one row per membership: it stays when the plan grants it or the
      // source had it and the plan does not revoke it
      const stays =
        !absorbed.has(r) &&
        (source.has(selfId(r)) ||
          (ownActions.get(r) ?? []).some((a) => a.verb === "create"));
      if (!stays) tail.push(plainRevoke(r));
    }
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
