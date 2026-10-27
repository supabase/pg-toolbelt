/**
 * Applier capability (docs/architecture/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability): an
 * operation the applier cannot execute is projected out of the view, never
 * silently emitted to fail at apply time. Capability is a property of WHO
 * applies, not of the objects — so it is not derivable from the catalog; it is
 * probed from the applier connection and threaded into plan()/prove() as an
 * option. Absent from bare `plan()`, the view is unrestricted. `resolveProfile`
 * probes by default; a superuser probe excludes nothing (local CI no-op).
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
  /** roles the applier can SET ROLE to, i.e. hand objects to (PG <= 15: any
   *  membership; PG16+: membership with the SET option — a CREATEROLE creator
   *  only holds ADMIN). A plain array (not a Set) so the capability persists
   *  losslessly in the Plan artifact's JSON (follow-up 2 productization). */
  memberOf: readonly string[];
  /** PG16+: roles the applier holds ADMIN OPTION on, so it can grant itself
   *  membership. Omitted on legacy artifacts / hand-built fixtures. */
  adminOf?: readonly string[];
  /** PG16+ `createrole_self_grant` of the applying session (e.g. "set,
   *  inherit"); "" when unset. Omitted before PG16 and on legacy artifacts. */
  createroleSelfGrant?: string;
  /** supautils `reserved_memberships`: roles nobody but the superuser may
   *  grant. Omitted when supautils is not loaded. */
  reservedMemberships?: readonly string[];
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
             WHERE pg_catalog.pg_has_role(current_user, r.oid,
                     CASE WHEN current_setting('server_version_num')::int >= 160000
                          THEN 'SET' ELSE 'MEMBER' END)
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS member_of,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER WITH ADMIN OPTION')
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS admin_of,
           current_setting('createrole_self_grant', true) AS createrole_self_grant,
           current_setting('supautils.reserved_memberships', true) AS reserved_memberships
  `);
  const row = res.rows[0] as {
    role: string;
    is_superuser: boolean;
    create_role: boolean;
    pg_major: number;
    member_of: string[] | null;
    admin_of: string[] | null;
    createrole_self_grant: string | null;
    reserved_memberships: string | null;
  };
  return {
    role: String(row.role),
    isSuperuser: Boolean(row.is_superuser),
    memberOf: row.member_of ?? [],
    adminOf: row.admin_of ?? [],
    createRole: Boolean(row.create_role),
    pgMajor: Number(row.pg_major),
    ...(row.createrole_self_grant !== null
      ? { createroleSelfGrant: row.createrole_self_grant }
      : {}),
    ...(row.reserved_memberships
      ? {
          reservedMemberships: row.reserved_memberships
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0),
        }
      : {}),
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
 * Whether the applier can run `ALTER <obj> OWNER TO roleName` directly —
 * PostgreSQL requires a superuser or a role that can SET ROLE to the new owner
 * (the owner residue, move 6 / follow-up 1). See `canSelfGrantOwner` for the
 * case the planner bridges with a temporary self-grant.
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

/**
 * Whether the applier may `GRANT roleName TO <applier>` itself, so the planner
 * can bracket an owner change it cannot run directly (#563):
 *   - PG <= 15: CREATEROLE may grant any non-superuser role;
 *   - PG16+: needs ADMIN OPTION on the role, which a CREATEROLE creator gets
 *     automatically — so a role this plan creates qualifies.
 * A supautils reserved membership is superuser-only either way. Legacy
 * capabilities (no `pgMajor`) never qualify.
 */
export function canSelfGrantOwner(
  cap: ApplierCapability,
  roleName: string,
  role: { createdByPlan: boolean; superuser: boolean },
): boolean {
  if (cap.isSuperuser || cap.pgMajor === undefined) return false;
  if (role.superuser) return false;
  if (cap.reservedMemberships?.includes(roleName)) return false;
  if (cap.pgMajor < 16) return cap.createRole === true;
  return (
    (cap.adminOf?.includes(roleName) ?? false) ||
    (role.createdByPlan && cap.createRole === true)
  );
}

/**
 * PG16+ `createrole_self_grant` containing `set` makes CREATE ROLE grant the
 * creator SET on the new role, so an owner change to a role this plan creates
 * needs no bracket.
 */
export function createRoleGrantsSet(cap: ApplierCapability): boolean {
  if (cap.pgMajor === undefined || cap.pgMajor < 16) return false;
  // SET alone passes OWNER TO, but later COMMENT/ACL actions need INHERIT
  const options = (cap.createroleSelfGrant ?? "")
    .split(",")
    .map((option) => option.trim().toLowerCase());
  return options.includes("set") && options.includes("inherit");
}

/** An `ALTER … OWNER TO` the applier can neither run nor bridge with a
 *  self-grant. Typed so callers can report it as a request problem (the
 *  applier lacks a privilege) rather than an internal failure. */
export class CapabilityError extends Error {
  readonly code = "capability_owner";
  constructor(
    readonly objectId: string,
    readonly ownerRole: string,
    readonly applierRole: string,
  ) {
    super(
      `capability: cannot set owner of ${objectId} to role "${ownerRole}" — applier "${applierRole}" is not a superuser, cannot SET ROLE to it, and cannot grant itself membership; grant membership or apply as a member/superuser`,
    );
    this.name = "CapabilityError";
  }
}
