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
 * Projected today:
 *   - FDW ACLs (superuser-only GRANT/REVOKE), the exclusion Supabase Rule 9
 *     hard-codes — additive until that derivation is proven at parity.
 *   - PG16+ CREATEROLE self-ADMIN memberships: `GRANT role TO <applier>
 *     WITH ADMIN OPTION` is 0LP01; CREATE ROLE already recreates the row.
 */
import type { Pool } from "pg";
import type { FactBase } from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";

export interface ApplierCapability {
  /** the role the migration is applied as (current_user) */
  role: string;
  /** superuser bypasses most permission checks (incl. FDW GRANT/REVOKE) */
  isSuperuser: boolean;
  /** roles the applier is a member of (can SET ROLE / own objects as). A plain
   *  array (not a Set) so the capability persists losslessly in the Plan
   *  artifact's JSON (follow-up 2 productization). */
  memberOf: readonly string[];
  /** CREATEROLE on the applying role. Omitted on legacy artifacts / hand-built
   *  fixtures — membership projection stays off. */
  createRole?: boolean;
  /** Server major (e.g. 16). Omitted on legacy artifacts / hand-built fixtures. */
  pgMajor?: number;
}

export const CAPABILITY_FDW_ACL = "capability.fdw-acl";
export const CAPABILITY_CREATEROLE_SELF_ADMIN =
  "capability.createrole-self-admin";

/** Probe the applier's capability from a live connection. */
export async function probeApplierCapability(
  pool: Pool,
): Promise<ApplierCapability> {
  const res = await pool.query(`
    SELECT current_user AS role,
           (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) AS is_superuser,
           (SELECT rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user) AS create_role,
           (current_setting('server_version_num')::int / 10000) AS pg_major,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS member_of
  `);
  const row = res.rows[0] as {
    role: string;
    is_superuser: boolean;
    create_role: boolean;
    pg_major: number;
    member_of: string[] | null;
  };
  return {
    role: String(row.role),
    isSuperuser: Boolean(row.is_superuser),
    memberOf: row.member_of ?? [],
    createRole: Boolean(row.create_role),
    pgMajor: Number(row.pg_major),
  };
}

/**
 * Fact-id keys to project out for a given capability, keyed by audit reason.
 * A superuser is unrestricted. Missing `createRole` / `pgMajor` (legacy JSON)
 * does not exclude memberships.
 */
export function capabilityExcludedRoots(
  fb: FactBase,
  cap: ApplierCapability,
): Map<string, string> {
  const roots = new Map<string, string>();
  if (cap.isSuperuser) return roots;
  const selfAdmin =
    cap.createRole === true && cap.pgMajor !== undefined && cap.pgMajor >= 16;
  for (const fact of fb.facts()) {
    if (fact.id.kind === "acl" && fact.id.target.kind === "fdw") {
      roots.set(encodeId(fact.id), CAPABILITY_FDW_ACL);
      continue;
    }
    if (
      selfAdmin &&
      fact.id.kind === "membership" &&
      fact.id.member === cap.role &&
      fact.payload["admin"] === true
    ) {
      roots.set(encodeId(fact.id), CAPABILITY_CREATEROLE_SELF_ADMIN);
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
