/**
 * Stage 7: the shadow-DB frontend — SQL files → fact base
 * (target-architecture §3.2). Parser-free by design:
 * - ordering: bounded retry rounds at FILE granularity against the shadow
 *   (fail-safe — errors surface before anything is extracted)
 * - body validation: routines re-validated with checks ON after loading
 * - shared-object isolation: pg_roles snapshot before/after; leakage fails
 * - DML rejection: any user table containing rows fails, by observation
 */
import type { Pool } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { FactBase } from "../core/fact.ts";
import { extract } from "../extract/extract.ts";

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

export async function loadSqlFiles(
  files: SqlFile[],
  shadow: Pool,
  options: { maxRounds?: number } = {},
): Promise<LoadResult> {
  const maxRounds = options.maxRounds ?? 25;

  // the shadow must be empty — verify by observation
  const preexisting = await shadow.query(`
    SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'`);
  if ((preexisting.rows[0] as { n: number }).n > 0) {
    throw new ShadowLoadError("shadow database is not empty", []);
  }

  const rolesBefore = await shadow.query(
    `SELECT rolname FROM pg_roles ORDER BY 1`,
  );

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
          await client.query(file.sql);
        } catch (error) {
          failures.push({
            file,
            message: error instanceof Error ? error.message : String(error),
          });
          next.push(file);
        }
      }
      if (next.length === pending.length) {
        // no progress: stuck — loud, structured, before extraction
        throw new ShadowLoadError(
          `shadow load stuck after ${rounds} round(s): ${next.length} file(s) cannot apply`,
          failures.map((f) => ({
            code: "stuck_statement",
            severity: "error",
            message: `${f.file.name}: ${f.message}`,
          })),
        );
      }
      pending = next;
    }

    // shared-object isolation: role leakage is an error in database-scratch mode
    const rolesAfter = await client.query(
      `SELECT rolname FROM pg_roles ORDER BY 1`,
    );
    const before = new Set(
      rolesBefore.rows.map((r) => (r as { rolname: string }).rolname),
    );
    const leaked = rolesAfter.rows
      .map((r) => (r as { rolname: string }).rolname)
      .filter((r) => !before.has(r));
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

  const result = await extract(shadow);
  return {
    factBase: result.factBase,
    pgVersion: result.pgVersion,
    diagnostics: result.diagnostics,
    rounds,
  };
}
