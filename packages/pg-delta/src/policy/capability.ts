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
  /** roles the applier is a member of (can SET ROLE / own objects as). A plain
   *  array (not a Set) so the capability persists losslessly in the Plan
   *  artifact's JSON (follow-up 2 productization). */
  memberOf: readonly string[];
  /** CREATEROLE on the applying role. Omitted on legacy artifacts / hand-built
   *  fixtures — membership projection stays off. */
  createRole?: boolean;
  /** Server major (e.g. 16). Omitted on legacy artifacts / hand-built fixtures. */
  pgMajor?: number;
  /** Applier `rolinherit`. On PG<=15 a NOINHERIT applier cannot use a
   *  temporary membership, so it cannot self-grant an owner role. */
  inherit?: boolean;
  /** Roles the applier can SET ROLE to (PG16+ `SET`; <=15 `MEMBER`), i.e. the
   *  roles it can hand an object to with `ALTER … OWNER TO`. Built-in
   *  (`pg_*`) roles included. Omitted on legacy artifacts (then `memberOf`). */
  settableRoles?: readonly string[];
  /** Roles whose privileges the applier already has (`USAGE`) AND can set:
   *  it can act as their objects' owner. Built-in roles included (e.g.
   *  `pg_database_owner` when the applier owns the database). */
  usableRoles?: readonly string[];
  /** Roles whose privileges the applier has (`USAGE`, i.e. inherited),
   *  settable or not. Acting on an object as its CURRENT owner (ALTER, DROP,
   *  `ALTER … OWNER TO`) needs only these privileges. */
  inheritedRoles?: readonly string[];
  /** Roles the applier holds ADMIN on through a DIRECT pg_auth_members row
   *  (never inherited ADMIN, which records another grantor). On PG16+ these
   *  are the roles it may grant to itself. */
  adminOf?: readonly string[];
  /** The applier's own-grantor membership rows (PG16+: grantor = applier;
   *  <=15: every direct row). The envelope restores these exactly. */
  selfGrants?: readonly {
    role: string;
    admin: boolean;
    inherit: boolean;
    set: boolean;
  }[];
  /** `supautils.reserved_memberships` entries (a trailing `*` is a prefix
   *  match); empty when supautils is absent. */
  reservedMemberships?: readonly string[];
}

export const CAPABILITY_FDW_ACL = "capability.fdw-acl";
export const CAPABILITY_CREATEROLE_SELF_ADMIN =
  "capability.createrole-self-admin";

/** Probe the applier's capability from a live connection (one round trip).
 *  Version-dependent catalog columns are read through `to_jsonb(m)` so the
 *  same statement parses on PG14–18. */
export async function probeApplierCapability(
  pool: Pool,
): Promise<ApplierCapability> {
  const res = await pool.query(`
    WITH me AS (
      SELECT oid, rolname, rolsuper, rolcreaterole, rolinherit
      FROM pg_catalog.pg_roles WHERE rolname = current_user
    ), v AS (
      SELECT current_setting('server_version_num')::int / 10000 AS major
    )
    SELECT me.rolname AS role,
           me.rolsuper AS is_superuser,
           me.rolcreaterole AS create_role,
           me.rolinherit AS inherit,
           v.major AS pg_major,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE pg_catalog.pg_has_role(me.oid, r.oid, 'MEMBER')
               AND r.rolname NOT LIKE 'pg\\_%'
           ) AS member_of,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE r.oid <> me.oid
               AND pg_catalog.pg_has_role(me.oid, r.oid,
                     CASE WHEN v.major >= 16 THEN 'SET' ELSE 'MEMBER' END)
             ORDER BY 1
           ) AS settable_roles,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE r.oid <> me.oid
               AND pg_catalog.pg_has_role(me.oid, r.oid, 'USAGE')
               AND pg_catalog.pg_has_role(me.oid, r.oid,
                     CASE WHEN v.major >= 16 THEN 'SET' ELSE 'MEMBER' END)
             ORDER BY 1
           ) AS usable_roles,
           ARRAY(
             SELECT r.rolname::text FROM pg_catalog.pg_roles r
             WHERE r.oid <> me.oid
               AND pg_catalog.pg_has_role(me.oid, r.oid, 'USAGE')
             ORDER BY 1
           ) AS inherited_roles,
           ARRAY(
             SELECT DISTINCT pg_catalog.pg_get_userbyid(m.roleid)::text
             FROM pg_catalog.pg_auth_members m
             WHERE m.member = me.oid AND m.admin_option
             ORDER BY 1
           ) AS admin_of,
           (SELECT COALESCE(json_agg(json_build_object(
                     'role', pg_catalog.pg_get_userbyid(m.roleid),
                     'admin', m.admin_option,
                     'inherit', CASE WHEN v.major >= 16
                                     THEN (to_jsonb(m)->>'inherit_option')::boolean
                                     ELSE me.rolinherit END,
                     'set', CASE WHEN v.major >= 16
                                 THEN (to_jsonb(m)->>'set_option')::boolean
                                 ELSE true END)
                     ORDER BY m.roleid), '[]'::json)
            FROM pg_catalog.pg_auth_members m
            WHERE m.member = me.oid
              AND (v.major < 16 OR (to_jsonb(m)->>'grantor')::oid = me.oid)
           ) AS self_grants,
           COALESCE(current_setting('supautils.reserved_memberships', true), '')
             AS reserved
    FROM me, v
  `);
  const row = res.rows[0] as {
    role: string;
    is_superuser: boolean;
    create_role: boolean;
    inherit: boolean;
    pg_major: number;
    member_of: string[] | null;
    settable_roles: string[] | null;
    usable_roles: string[] | null;
    inherited_roles: string[] | null;
    admin_of: string[] | null;
    self_grants:
      | {
          role: string;
          admin: boolean;
          inherit: boolean;
          set: boolean;
        }[]
      | null;
    reserved: string | null;
  };
  return {
    role: String(row.role),
    isSuperuser: Boolean(row.is_superuser),
    memberOf: row.member_of ?? [],
    createRole: Boolean(row.create_role),
    pgMajor: Number(row.pg_major),
    inherit: Boolean(row.inherit),
    settableRoles: row.settable_roles ?? [],
    usableRoles: row.usable_roles ?? [],
    inheritedRoles: row.inherited_roles ?? [],
    adminOf: row.admin_of ?? [],
    selfGrants: (row.self_grants ?? []).map((g) => ({
      role: String(g.role),
      admin: Boolean(g.admin),
      inherit: Boolean(g.inherit),
      set: Boolean(g.set),
    })),
    reservedMemberships: (row.reserved ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  };
}

/** Whether supautils refuses a self-grant of `role` (`*` = prefix match). */
export function isReservedMembership(
  cap: ApplierCapability,
  role: string,
): boolean {
  return (cap.reservedMemberships ?? []).some((entry) =>
    entry.endsWith("*") ? role.startsWith(entry.slice(0, -1)) : role === entry,
  );
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
    // Only the PURE implicit row CREATE ROLE leaves behind (ADMIN, no SET, no
    // INHERIT). An explicit self-grant sets SET/INHERIT and stays in the view.
    if (
      selfAdmin &&
      fact.id.kind === "membership" &&
      fact.id.member === cap.role &&
      fact.payload["admin"] === true &&
      fact.payload["set"] !== true &&
      fact.payload["inherit"] !== true
    ) {
      roots.set(encodeId(fact.id), CAPABILITY_CREATEROLE_SELF_ADMIN);
    }
  }
  return roots;
}

/**
 * Whether the applier can run `ALTER <obj> OWNER TO roleName` as it stands
 * (superuser, or it can SET ROLE to the role). Legacy capabilities without
 * `settableRoles` fall back to `memberOf`.
 */
export function canSetOwner(cap: ApplierCapability, roleName: string): boolean {
  return (
    cap.isSuperuser ||
    roleName === cap.role ||
    (cap.settableRoles ?? cap.memberOf).includes(roleName)
  );
}

/** A blocker: the plan is valid to read but cannot be applied by this
 *  applier. `apply()` / `provePlan` refuse a plan that carries any. */
export interface PlanBlocker {
  /** `capability_owner`: an owner change the applier cannot authorize;
   *  `capability_acl_grantor`: a role the envelope opens holds a grant option
   *  on an object whose ACL statement cannot run as its owner, so Postgres
   *  could record that role as the grantor; `capability_membership_grantor`:
   *  a membership row the applier cannot change (another grantor's row, or no
   *  direct ADMIN on the role for `GRANTED BY <applier>`). */
  code:
    | "capability_owner"
    | "capability_acl_grantor"
    | "capability_membership_grantor";
  role: string;
  reason: string;
  /** encoded ids of the objects (or memberships) the blocker is about */
  objects: string[];
}

/** Thrown by `apply()` / `provePlan` before running anything when the plan
 *  carries blockers. */
export class CapabilityError extends Error {
  readonly code = "capability_blocked";
  constructor(readonly blockers: readonly PlanBlocker[]) {
    super(
      `capability: the applier cannot run this plan:\n` +
        blockers
          .map(
            (b) =>
              `  - [${b.code}] role "${b.role}" (${b.reason}): ${b.objects.join(", ")}`,
          )
          .join("\n"),
    );
    this.name = "CapabilityError";
  }
}

/** Thrown by `apply()` when a plan bound to an applier role (it carries
 *  self-membership statements naming that role) runs as another role. */
export class ApplierIdentityError extends Error {
  readonly code = "applier_identity";
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `apply: this plan was made for applier "${expected}" and grants/revokes memberships of that role; it is running as "${actual}" — re-plan with this role's capability or apply as "${expected}"`,
    );
    this.name = "ApplierIdentityError";
  }
}
