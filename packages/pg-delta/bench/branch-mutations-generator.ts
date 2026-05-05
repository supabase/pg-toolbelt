/**
 * Ordered DDL to diverge the **branch** database from a twin that received the
 * same `generateLargeSchemaSql` baseline. Mixes ALTER / DROP / REPLACE across
 * RLS, indexes, triggers, rules, views, matviews, publication, event triggers,
 * FDW, aggregates, procedures, functions, partitions, sequences, roles, etc.
 *
 * Apply only to the branch pool after both sides share the baseline schema.
 * Statement order respects PostgreSQL dependencies.
 */

import type { BenchRoleNames } from "./large-schema-generator.ts";

const DEFAULT_BENCH_ROLES: BenchRoleNames = {
  shadow: "bench_shadow",
  actor: "bench_actor",
};

export type GenerateBranchMutationsOptions = {
  tableCount: number;
  /** How many mutation statements to apply (from the start of the ordered list). */
  mutationCount: number;
  /** Must match `benchRoles` passed to `generateLargeSchemaSql` for this DB. */
  benchRoles?: BenchRoleNames;
};

function qTable(schema: string, name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(schema) || !/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unsafe identifier: ${schema}.${name}`);
  }
  return `${schema}.${name}`;
}

function qIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unsafe SQL identifier: ${name}`);
  }
  return name;
}

/**
 * Full ordered mutation list for `tableCount` (must match the baseline generator).
 */
export function listBranchMutationSteps(
  tableCount: number,
  benchRoles: BenchRoleNames = DEFAULT_BENCH_ROLES,
): string[] {
  const n = tableCount;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`tableCount must be a positive integer, got ${tableCount}`);
  }

  const last = n - 1;
  const tLast = qTable("public", `bench_t_${last}`);
  const shadow = qIdent(benchRoles.shadow);
  const actor = qIdent(benchRoles.actor);
  const viewBlocks = Math.floor(n / 10);
  const mvBlocks = Math.floor(n / 15);

  const steps: string[] = [];

  // --- Alters & replacements (keep dependency graph intact) ---
  steps.push(
    `ALTER TABLE ${tLast} ADD COLUMN mut_extra text DEFAULT 'bench_mut';`,
  );
  steps.push(
    `ALTER TABLE ${tLast} ADD CONSTRAINT mut_id_sane CHECK (id > -1000000000);`,
  );
  steps.push(`COMMENT ON TABLE ${tLast} IS 'branch: mutated tail table';`);
  steps.push(`ALTER SEQUENCE bench_kit.bench_seq CACHE 3;`);
  steps.push(
    `ALTER TABLE bench_kit.pg_fdw_src ADD COLUMN src_extra integer DEFAULT 0;`,
  );
  steps.push(
    `COMMENT ON SCHEMA bench_kit IS 'branch: mutated schema comment';`,
  );
  steps.push(
    `ALTER DOMAIN bench_kit.bench_label DROP CONSTRAINT bench_label_nonempty;`,
  );
  steps.push(
    `ALTER DOMAIN bench_kit.bench_label ADD CONSTRAINT bench_label_nonempty CHECK (VALUE <> '');`,
  );
  steps.push(
    `ALTER TYPE bench_kit.bench_severity RENAME VALUE 'crit' TO 'critical';`,
  );
  steps.push(`ALTER PUBLICATION bench_pub SET (publish = 'insert');`);
  steps.push(
    `ALTER TABLE public.bench_t_0 ALTER COLUMN label SET STATISTICS 80;`,
  );

  if (viewBlocks > 0) {
    steps.push(
      `CREATE OR REPLACE VIEW public.bench_v_0 AS SELECT a.id AS root_id, b.id AS child_id, a.status AS root_status, b.coord AS child_coord FROM public.bench_t_0 a INNER JOIN public.bench_t_1 b ON b.parent_id = a.id WHERE false;`,
    );
  }

  if (mvBlocks > 0) {
    steps.push(
      `ALTER MATERIALIZED VIEW public.bench_mv_0 RENAME COLUMN label TO bench_lbl;`,
    );
  }

  // --- RLS / index / trigger / rule ---
  steps.push(`DROP POLICY IF EXISTS bench_t_${last}_insert ON ${tLast};`);
  steps.push(`DROP INDEX IF EXISTS public.bench_t_${last}_label_idx;`);
  steps.push(`ALTER TABLE ${tLast} DISABLE ROW LEVEL SECURITY;`);
  steps.push(`DROP TRIGGER IF EXISTS bench_trg_after_ins ON public.bench_t_0;`);
  steps.push(`DROP RULE IF EXISTS bench_block_huge ON public.bench_t_0;`);

  // --- Views & matviews (drop “last” scaled objects first when present) ---
  if (viewBlocks > 0) {
    steps.push(`DROP VIEW IF EXISTS public.bench_v_${viewBlocks - 1};`);
  }
  if (mvBlocks > 0) {
    steps.push(
      `DROP MATERIALIZED VIEW IF EXISTS public.bench_mv_${mvBlocks - 1};`,
    );
  }

  // --- Publication & event trigger ---
  steps.push(`DROP PUBLICATION IF EXISTS bench_pub;`);
  steps.push(`DROP EVENT TRIGGER IF EXISTS bench_et_end;`);

  // --- FDW stack ---
  steps.push(`DROP FOREIGN TABLE IF EXISTS bench_kit.pg_fdw_mirror;`);
  steps.push(
    `DROP USER MAPPING IF EXISTS FOR CURRENT_USER SERVER bench_loop_srv;`,
  );
  steps.push(`DROP SERVER IF EXISTS bench_loop_srv CASCADE;`);

  // --- Routines & aggregate ---
  steps.push(`DROP AGGREGATE IF EXISTS bench_kit.bench_sum_agg (numeric);`);
  steps.push(
    `DROP FUNCTION IF EXISTS bench_kit.bench_accum(numeric, numeric) CASCADE;`,
  );
  steps.push(`DROP PROCEDURE IF EXISTS bench_kit.bench_proc(integer);`);
  steps.push(`DROP FUNCTION IF EXISTS bench_kit.bench_trg() CASCADE;`);
  steps.push(`DROP FUNCTION IF EXISTS bench_kit.bench_event() CASCADE;`);

  // --- Partitioned table ---
  steps.push(
    `ALTER TABLE bench_kit.part_root DETACH PARTITION bench_kit.part_a;`,
  );
  steps.push(
    `ALTER TABLE bench_kit.part_root DETACH PARTITION bench_kit.part_b;`,
  );
  steps.push(`DROP TABLE IF EXISTS bench_kit.part_root;`);

  steps.push(`DROP SEQUENCE IF EXISTS bench_kit.bench_seq;`);

  // --- Role graph ---
  steps.push(`REVOKE ${shadow} FROM ${actor};`);
  steps.push(`DROP ROLE IF EXISTS ${actor};`);

  return steps;
}

export function maxBranchMutationCount(
  tableCount: number,
  benchRoles: BenchRoleNames = DEFAULT_BENCH_ROLES,
): number {
  return listBranchMutationSteps(tableCount, benchRoles).length;
}

/**
 * Single transaction applying the first `mutationCount` mutations (clamped).
 */
export function generateBranchMutationsSql(
  options: GenerateBranchMutationsOptions,
): string {
  const roles = options.benchRoles ?? DEFAULT_BENCH_ROLES;
  const all = listBranchMutationSteps(options.tableCount, roles);
  const want = Math.max(0, options.mutationCount);
  const take = Math.min(want, all.length);
  const lines = [
    "-- Branch-only mutations (see bench/branch-mutations-generator.ts).",
    "BEGIN;",
    "",
    ...all.slice(0, take),
    "",
    "COMMIT;",
  ];
  return `${lines.join("\n")}\n`;
}
