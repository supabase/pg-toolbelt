/**
 * Stage 7: the shadow-DB frontend — SQL files → fact base
 * (target-architecture §3.2). Parser-free by design:
 * - ordering: bounded retry rounds at FILE granularity against the shadow
 *   (fail-safe — errors surface before anything is extracted)
 * - body validation: routines re-validated with checks ON after loading
 * - shared-object isolation: pg_roles + pg_auth_members snapshot before/after;
 *   leakage fails in "databaseScratch" mode (skipped in "isolatedCluster" mode)
 * - DML rejection: any user table containing rows fails, by observation
 *
 * ## Loader modes
 *
 * ### "databaseScratch" (default)
 * The shadow database lives on a shared PostgreSQL cluster. Cluster-level
 * objects (roles, role memberships) are visible to every other database on
 * the same cluster, so any file that creates roles or modifies memberships
 * would pollute the shared catalog — this is called a "leak". The loader
 * snapshots pg_roles and pg_auth_members before loading and after; if the
 * sets differ, it throws a ShadowLoadError. Use this mode for typical CI /
 * tooling usage where one cluster hosts many test databases.
 *
 * ### "isolatedCluster"
 * The shadow database has its own dedicated PostgreSQL cluster (e.g. from
 * isolatedClusterPair()). Because no other database shares that cluster,
 * role/membership side-effects are confined and harmless. The shared-object
 * snapshot check is SKIPPED entirely; files that CREATE ROLE or GRANT role
 * memberships will load successfully. Use this mode when your SQL files
 * intentionally manage cluster-level state.
 */
import type { Pool, PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { FactBase } from "../core/fact.ts";
import { extract } from "../extract/extract.ts";

/** SQLSTATE 25001 ("active_sql_transaction") — raised when a statement that
 *  cannot run inside a transaction block (CREATE INDEX CONCURRENTLY, VACUUM, …)
 *  is attempted within one. Detection by effect, not by parsing (P1). */
function isNonTransactional(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return (
    code === "25001" ||
    (error instanceof Error &&
      /cannot run inside a transaction block/i.test(error.message))
  );
}

/**
 * Apply one file's SQL inside an EXPLICIT transaction (hardening Item 6 /
 * review #5), so a mid-file failure leaves NO partial state and the file can be
 * cleanly retried in a later round — instead of relying on PostgreSQL's
 * implicit multi-statement-query transaction. A statement that cannot run in a
 * transaction block (e.g. CREATE INDEX CONCURRENTLY) is re-run RAW on the
 * throwaway shadow, detected by effect (SQLSTATE 25001); its real error, if
 * any, still surfaces to the caller.
 */
async function applyFile(client: PoolClient, sql: string): Promise<void> {
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isNonTransactional(error)) {
      await client.query(sql);
      return;
    }
    throw error;
  }
}

export interface SqlFile {
  name: string;
  sql: string;
}

export interface LoadResult {
  factBase: FactBase;
  pgVersion: string;
  diagnostics: Diagnostic[];
  rounds: number;
}

export class ShadowLoadError extends Error {
  constructor(
    message: string,
    readonly details: Diagnostic[],
  ) {
    super(message);
    this.name = "ShadowLoadError";
  }
}

/** A membership tuple used for snapshot comparison. */
interface MembershipTuple {
  role: string;
  member: string;
  admin_option: boolean;
}

function serializeMembership(m: MembershipTuple): string {
  return `${m.role}:${m.member}:${String(m.admin_option)}`;
}

export async function loadSqlFiles(
  files: SqlFile[],
  shadow: Pool,
  options: {
    maxRounds?: number;
    mode?: "databaseScratch" | "isolatedCluster";
  } = {},
): Promise<LoadResult> {
  const maxRounds = options.maxRounds ?? 25;
  const mode = options.mode ?? "databaseScratch";

  // the shadow must be empty — verify by observation
  const preexisting = await shadow.query(`
    SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'`);
  if ((preexisting.rows[0] as { n: number }).n > 0) {
    throw new ShadowLoadError("shadow database is not empty", []);
  }

  // snapshot pg_roles + pg_auth_members before loading (databaseScratch only)
  const rolesBefore =
    mode === "databaseScratch"
      ? await shadow.query(`SELECT rolname FROM pg_roles ORDER BY 1`)
      : null;
  const membershipsBefore =
    mode === "databaseScratch"
      ? await shadow.query<MembershipTuple>(`
          SELECT r1.rolname AS role, r2.rolname AS member,
                 m.admin_option
          FROM pg_auth_members m
          JOIN pg_roles r1 ON r1.oid = m.roleid
          JOIN pg_roles r2 ON r2.oid = m.member
          ORDER BY 1, 2`)
      : null;

  // bounded retry rounds at file granularity (fail-safe ordering)
  let pending = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  let rounds = 0;
  const client = await shadow.connect();
  try {
    await client.query(`SET check_function_bodies = off`);
    while (pending.length > 0) {
      rounds++;
      if (rounds > maxRounds) break;
      const failures: Array<{ file: SqlFile; message: string }> = [];
      const next: SqlFile[] = [];
      for (const file of pending) {
        try {
          await applyFile(client, file.sql);
        } catch (error) {
          failures.push({
            file,
            message: error instanceof Error ? error.message : String(error),
          });
          next.push(file);
        }
      }
      if (next.length === pending.length) {
        // no progress: stuck — inspect for mutual-FK situation, then fail loud
        const mutualFkHint = detectMutualFk(failures)
          ? " Tip: if two tables reference each other with inline REFERENCES clauses, split one foreign key into a separate ALTER TABLE … ADD CONSTRAINT statement."
          : "";
        throw new ShadowLoadError(
          `shadow load stuck after ${rounds} round(s): ${next.length} file(s) cannot apply${mutualFkHint}`,
          failures.map((f) => ({
            code: "stuck_statement",
            severity: "error",
            message: `${f.file.name}: ${f.message}`,
          })),
        );
      }
      pending = next;
    }

    // shared-object isolation: role/membership leakage is an error in databaseScratch mode
    if (mode === "databaseScratch") {
      const rolesAfter = await client.query(
        `SELECT rolname FROM pg_roles ORDER BY 1`,
      );
      const beforeRoleSet = new Set(
        (rolesBefore?.rows ?? []).map(
          (r) => (r as { rolname: string }).rolname,
        ),
      );
      const leaked = rolesAfter.rows
        .map((r) => (r as { rolname: string }).rolname)
        .filter((r) => !beforeRoleSet.has(r));
      if (leaked.length > 0) {
        throw new ShadowLoadError(
          `declarative files created cluster-level objects (roles: ${leaked.join(", ")}) — use an isolated-cluster shadow for shared objects`,
          leaked.map((r) => ({
            code: "shared_object_leak",
            severity: "error",
            subject: { kind: "role", name: r },
            message: `role ${r} leaked out of the shadow database`,
          })),
        );
      }

      // membership snapshot comparison: detect GRANT role_a TO role_b leaks
      const membershipsAfter = await client.query<MembershipTuple>(`
        SELECT r1.rolname AS role, r2.rolname AS member,
               m.admin_option
        FROM pg_auth_members m
        JOIN pg_roles r1 ON r1.oid = m.roleid
        JOIN pg_roles r2 ON r2.oid = m.member
        ORDER BY 1, 2`);
      const beforeMemberSet = new Set(
        (membershipsBefore?.rows ?? []).map(serializeMembership),
      );
      const leakedMemberships = membershipsAfter.rows.filter(
        (m) => !beforeMemberSet.has(serializeMembership(m)),
      );
      if (leakedMemberships.length > 0) {
        const descriptions = leakedMemberships.map(
          (m) =>
            `GRANT ${m.role} TO ${m.member}${m.admin_option ? " WITH ADMIN OPTION" : ""}`,
        );
        throw new ShadowLoadError(
          `declarative files modified cluster-level membership (${descriptions.join(", ")}) — use an isolated-cluster shadow for shared objects`,
          leakedMemberships.map((m) => ({
            code: "shared_object_leak",
            severity: "error",
            message: `membership leak: GRANT ${m.role} TO ${m.member}${m.admin_option ? " WITH ADMIN OPTION" : ""}`,
          })),
        );
      }
    }

    // body validation: re-run routine definitions with checks ON
    const defs = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prokind IN ('f', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`);
    await client.query(`SET check_function_bodies = on`);
    const bodyErrors: Diagnostic[] = [];
    for (const row of defs.rows as { def: string }[]) {
      try {
        await client.query(row.def);
      } catch (error) {
        bodyErrors.push({
          code: "invalid_routine_body",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (bodyErrors.length > 0) {
      throw new ShadowLoadError(
        `${bodyErrors.length} routine bod${bodyErrors.length === 1 ? "y" : "ies"} failed validation`,
        bodyErrors,
      );
    }

    // DML rejection by observation: any user table with rows fails
    const tables = await client.query(`
      SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
    const populated: string[] = [];
    for (const row of tables.rows as { schema: string; name: string }[]) {
      const r = await client.query(
        `SELECT EXISTS (SELECT 1 FROM "${row.schema.replaceAll('"', '""')}"."${row.name.replaceAll('"', '""')}" LIMIT 1) AS has`,
      );
      if ((r.rows[0] as { has: boolean }).has)
        populated.push(`${row.schema}.${row.name}`);
    }
    if (populated.length > 0) {
      throw new ShadowLoadError(
        `declarative files must not contain data statements — rows found in: ${populated.join(", ")}`,
        populated.map((t) => ({
          code: "data_statement",
          severity: "error",
          message: `table ${t} contains rows after loading`,
        })),
      );
    }
  } finally {
    client.release();
  }

  // provenance tag: mark the fact base as originating from SQL files
  const result = await extract(shadow, { source: "sqlFiles" });
  return {
    factBase: result.factBase,
    pgVersion: result.pgVersion,
    diagnostics: result.diagnostics,
    rounds,
  };
}

/**
 * Heuristic: detect whether stuck files are likely suffering from a mutual
 * inline FK cycle (two CREATE TABLEs each referencing the other's table inline).
 *
 * We look for: ≥2 stuck files whose PG errors mention "relation … does not
 * exist" or "foreign key constraint … references table" against a table name
 * that another stuck file would create.
 */
function detectMutualFk(
  failures: Array<{ file: SqlFile; message: string }>,
): boolean {
  if (failures.length < 2) return false;

  // Extract table names that each file attempts to CREATE TABLE
  const tablePattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|[\w.]+)/gi;
  const fkErrorPattern =
    /relation "([^"]+)" does not exist|foreign key constraint .* references table "([^"]+)"/i;

  const filesThatCreate = new Map<string, Set<string>>();
  for (const f of failures) {
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    tablePattern.lastIndex = 0;
    while ((m = tablePattern.exec(f.file.sql)) !== null) {
      // strip schema prefix and quotes for simple matching
      const raw = m[0]
        .replace(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "")
        .trim();
      const bare =
        raw
          .replace(/^"([^"]+)"$/, "$1")
          .split(".")
          .pop() ?? raw;
      names.add(bare.toLowerCase());
    }
    filesThatCreate.set(f.file.name, names);
  }

  // Check whether any stuck file's error mentions a table that another stuck
  // file would create (i.e. cross-file unresolved reference)
  const allCreated = new Set<string>();
  for (const names of filesThatCreate.values()) {
    for (const n of names) allCreated.add(n);
  }

  for (const f of failures) {
    const em = fkErrorPattern.exec(f.message);
    if (!em) continue;
    const missing = (em[1] ?? em[2] ?? "").toLowerCase().split(".").pop() ?? "";
    if (missing && allCreated.has(missing)) return true;
  }

  return false;
}
