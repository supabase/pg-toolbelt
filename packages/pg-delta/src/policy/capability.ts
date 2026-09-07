/**
 * Applier capability (docs/architecture/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability): an
 * operation the applier cannot execute is projected out of the view, never
 * silently emitted to fail at apply time. Capability is a property of WHO
 * applies, not of the objects — so it is not derivable from the catalog; it is
 * probed from the applier connection and threaded into plan()/prove() as an
 * option. Absent, the view is unrestricted (the default — superuser/CI path).
 *
 * Restrictions for a non-superuser:
 *   - FDW ACLs (`GRANT`/`REVOKE ON FOREIGN DATA WRAPPER` is superuser-only).
 *     Derives, for ANY non-superuser, the exclusion Supabase hard-codes as
 *     Rule 9 — additively (Rule 9 stays until the derivation is proven at
 *     parity).
 *   - Event triggers whose backing function is superuser-owned. That is
 *     supautils' `T_CreateEventTrigStmt`: a privileged non-superuser may
 *     create an event trigger only if the function is not superuser-owned.
 *     Stock PostgreSQL has no such carve-out (CREATE EVENT TRIGGER is
 *     superuser-only). Read off the function fact's `owner` edge.
 */
import type { Pool } from "pg";
import type { Fact, FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";

export interface ApplierCapability {
  /** the role the migration is applied as (current_user) */
  role: string;
  /** superuser bypasses most permission checks (incl. FDW GRANT/REVOKE) */
  isSuperuser: boolean;
  /** roles the applier is a member of (can SET ROLE / own objects as). A plain
   *  array (not a Set) so the capability persists losslessly in the Plan
   *  artifact's JSON (follow-up 2 productization). */
  memberOf: readonly string[];
}

/** Probe the applier's capability from a live connection. */
export async function probeApplierCapability(
  pool: Pool,
): Promise<ApplierCapability> {
  const res = await pool.query(`
    SELECT current_user AS role,
           (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) AS is_superuser,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS member_of
  `);
  const row = res.rows[0] as {
    role: string;
    is_superuser: boolean;
    member_of: string[] | null;
  };
  return {
    role: String(row.role),
    isSuperuser: Boolean(row.is_superuser),
    memberOf: row.member_of ?? [],
  };
}

const CAPABILITY_FDW_ACL = "capability.fdw-acl";
const CAPABILITY_EVENT_TRIGGER_SUPERUSER_FUNCTION =
  "capability.event-trigger-superuser-function";

function eventTriggerFunctionOwnedBySuperuser(
  fb: FactBase,
  fact: Fact,
): boolean {
  const schema = fact.payload["functionSchema"];
  const name = fact.payload["functionName"];
  if (typeof schema !== "string" || typeof name !== "string") return false;
  const fnId: StableId = { kind: "function", schema, name, args: [] };
  const fn = fb.get(fnId);
  if (fn === undefined) return false;
  const owner = fb.outgoingEdges(fn.id).find((e) => e.kind === "owner");
  if (owner === undefined || owner.to.kind !== "role") return false;
  return fb.get(owner.to)?.payload["superuser"] === true;
}

/**
 * Fact-id keys to project out for a given capability, mapped to the audit
 * reason. A superuser is unrestricted. Currently: FDW ACL facts, and event
 * triggers whose function is owned by a superuser.
 */
export function capabilityExcludedRoots(
  fb: FactBase,
  cap: ApplierCapability,
): Map<string, string> {
  const roots = new Map<string, string>();
  if (cap.isSuperuser) return roots;
  for (const fact of fb.facts()) {
    if (fact.id.kind === "acl" && fact.id.target.kind === "fdw") {
      roots.set(encodeId(fact.id), CAPABILITY_FDW_ACL);
      continue;
    }
    if (
      fact.id.kind === "eventTrigger" &&
      eventTriggerFunctionOwnedBySuperuser(fb, fact)
    ) {
      roots.set(encodeId(fact.id), CAPABILITY_EVENT_TRIGGER_SUPERUSER_FUNCTION);
    }
  }
  return roots;
}

/**
 * Whether the applier can run `ALTER <obj> OWNER TO roleName` — PostgreSQL
 * requires the applier to be a superuser or a member of the target role (the
 * owner residue, move 6 / follow-up 1).
 *
 * Unlike an FDW ACL (a leaf fact that projects out cleanly), an owner cannot be
 * silently skipped: leaving an object applier-owned ripples into its
 * acldefault-normalized ACL (which is owner-relative), so the state can't
 * converge. So an owner action the applier can't run is a FAIL-FAST at plan
 * time (the planner throws a clear, actionable error) rather than a silent
 * projection — surfaced before any statement is applied.
 */
export function canSetOwner(cap: ApplierCapability, roleName: string): boolean {
  return cap.isSuperuser || cap.memberOf.includes(roleName);
}
