/**
 * Programmatic DDL for E2E bench: covers object families that `extractCatalog`
 * loads (schemas, collations, types, domains, enums, ranges, composites,
 * sequences, tables/columns/constraints/indexes/triggers/rules/RLS, aggregates,
 * procedures, views, matviews, publications, event triggers, FDW graph) plus
 * comments and optional `dummy_seclabel` security labels (`includeSecurityLabels`).
 *
 * **Not emitted:** `subscription` — logical replication requires a subscriber
 * database distinct from the publisher; the single-DB bench cannot model that.
 *
 * **Languages** (`objectType: "language"`) are not loaded by `extractCatalog`
 * today, so no `CREATE LANGUAGE` block is included.
 */

export type FdwLoopbackConfig = {
  /** Host reachable from inside the Postgres server process (container loopback). */
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
};

/** Cluster-wide roles created by the bench DDL (must differ per DB when cloning on one cluster). */
export type BenchRoleNames = {
  shadow: string;
  actor: string;
};

export type GenerateLargeSchemaOptions = {
  /** Number of base tables `public.bench_t_{i}`. */
  tableCount: number;
  /**
   * When set, creates `SERVER` / `USER MAPPING` / `FOREIGN TABLE` using
   * `postgres_fdw` pointed at this instance. Use loopback from inside the
   * container (e.g. host `127.0.0.1`, port `5432`).
   */
  fdwLoopback?: FdwLoopbackConfig;
  /**
   * Emit `CREATE EXTENSION dummy_seclabel` and `SECURITY LABEL FOR dummy …`.
   * Off by default: stock `supabase/postgres` images do not ship that contrib.
   * Enable for `pg-delta-test:*` / alpine images that include it (see tests).
   */
  includeSecurityLabels?: boolean;
  /**
   * Roles are global per Postgres cluster; use distinct names for each logical DB
   * when applying this script twice (see `bench:e2e-mutations`).
   */
  benchRoles?: BenchRoleNames;
};

function qIdent(name: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
    throw new Error(`unsafe SQL identifier: ${name}`);
  }
  return name;
}

/** Single-quoted SQL literal. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Returns a full SQL script (BEGIN … COMMIT) applying the synthetic schema.
 */
export function generateLargeSchemaSql(
  options: GenerateLargeSchemaOptions,
): string {
  const n = options.tableCount;
  if (!Number.isInteger(n) || n < 1 || n > 50_000) {
    throw new Error(
      `tableCount must be an integer in [1, 50000], got ${options.tableCount}`,
    );
  }

  const includeSec = options.includeSecurityLabels === true;
  const benchShadow = qIdent(options.benchRoles?.shadow ?? "bench_shadow");
  const benchActor = qIdent(options.benchRoles?.actor ?? "bench_actor");

  const fdw = options.fdwLoopback;
  if (fdw !== undefined) {
    if (
      !Number.isInteger(fdw.port) ||
      fdw.port < 1 ||
      fdw.port > 65_535 ||
      fdw.host.length === 0
    ) {
      throw new Error(`invalid fdwLoopback: ${JSON.stringify(fdw)}`);
    }
  }

  const lines: string[] = [
    "-- Programmatic large schema for pg-delta E2E bench (see bench/large-schema-generator.ts).",
    "BEGIN;",
    "",
    ...(includeSec
      ? [
          "-- Extensions: dummy_seclabel (security labels), postgres_fdw, pg_trgm",
          "CREATE EXTENSION IF NOT EXISTS dummy_seclabel;",
        ]
      : [
          "-- Extensions: postgres_fdw, pg_trgm (no dummy_seclabel — use includeSecurityLabels)",
        ]),
    "CREATE EXTENSION IF NOT EXISTS postgres_fdw;",
    "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
    "COMMENT ON EXTENSION postgres_fdw IS 'bench: fdw coverage';",
    "",
    "CREATE SCHEMA bench_kit;",
    "COMMENT ON SCHEMA bench_kit IS 'pg-delta bench kitchen-sink objects';",
    ...(includeSec
      ? ["SECURITY LABEL FOR dummy ON SCHEMA bench_kit IS 'bench_schema';"]
      : []),
    "GRANT USAGE ON SCHEMA bench_kit TO PUBLIC;",
    "",
    'CREATE COLLATION bench_kit.bench_collate FROM "C";',
    "COMMENT ON COLLATION bench_kit.bench_collate IS 'bench collation';",
    "",
    "CREATE TYPE bench_kit.bench_severity AS ENUM ('low', 'med', 'high');",
    "ALTER TYPE bench_kit.bench_severity ADD VALUE 'crit';",
    "COMMENT ON TYPE bench_kit.bench_severity IS 'bench enum';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TYPE bench_kit.bench_severity IS 'bench_enum';",
        ]
      : []),
    "",
    "CREATE TYPE bench_kit.bench_pair AS (a integer, b text);",
    "COMMENT ON TYPE bench_kit.bench_pair IS 'bench composite';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TYPE bench_kit.bench_pair IS 'bench_composite';",
        ]
      : []),
    "GRANT USAGE ON TYPE bench_kit.bench_pair TO PUBLIC;",
    "",
    "CREATE DOMAIN bench_kit.bench_label AS text CONSTRAINT bench_label_nonempty CHECK (VALUE <> '');",
    "COMMENT ON DOMAIN bench_kit.bench_label IS 'bench domain';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON DOMAIN bench_kit.bench_label IS 'bench_domain';",
        ]
      : []),
    "",
    "CREATE TYPE bench_kit.bench_numspan AS RANGE (subtype = numeric);",
    "COMMENT ON TYPE bench_kit.bench_numspan IS 'bench range';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TYPE bench_kit.bench_numspan IS 'bench_range';",
        ]
      : []),
    "",
    "CREATE SEQUENCE bench_kit.bench_seq;",
    "COMMENT ON SEQUENCE bench_kit.bench_seq IS 'bench sequence';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON SEQUENCE bench_kit.bench_seq IS 'bench_sequence';",
        ]
      : []),
    "GRANT USAGE, SELECT ON SEQUENCE bench_kit.bench_seq TO PUBLIC;",
    "",
    "CREATE TABLE bench_kit.seq_holder (id bigint NOT NULL);",
    "CREATE SEQUENCE bench_kit.owned_seq OWNED BY bench_kit.seq_holder.id;",
    "ALTER TABLE bench_kit.seq_holder ALTER COLUMN id SET DEFAULT nextval('bench_kit.owned_seq');",
    "ALTER TABLE bench_kit.seq_holder ADD CONSTRAINT seq_holder_pkey PRIMARY KEY (id);",
    "COMMENT ON TABLE bench_kit.seq_holder IS 'bench: OWNED BY sequence';",
    "",
    "CREATE TABLE bench_kit.pg_fdw_src (id integer NOT NULL PRIMARY KEY, note text);",
    "COMMENT ON TABLE bench_kit.pg_fdw_src IS 'local source for postgres_fdw mirror';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TABLE bench_kit.pg_fdw_src IS 'bench_ft_src';",
        ]
      : []),
    "",
    "CREATE TABLE bench_kit.part_root (",
    "  id integer NOT NULL,",
    "  shard text NOT NULL,",
    "  PRIMARY KEY (id, shard)",
    ") PARTITION BY LIST (shard);",
    "CREATE TABLE bench_kit.part_a PARTITION OF bench_kit.part_root FOR VALUES IN ('a');",
    "CREATE TABLE bench_kit.part_b PARTITION OF bench_kit.part_root FOR VALUES IN ('b');",
    "COMMENT ON TABLE bench_kit.part_root IS 'bench partitioned table';",
    "COMMENT ON TABLE bench_kit.part_a IS 'bench partition child';",
    "",
    "CREATE OR REPLACE FUNCTION bench_kit.bench_accum(numeric, numeric)",
    "RETURNS numeric LANGUAGE sql IMMUTABLE STRICT AS 'SELECT $1 + $2';",
    "",
    "CREATE AGGREGATE bench_kit.bench_sum_agg (numeric) (",
    "  SFUNC = bench_kit.bench_accum,",
    "  STYPE = numeric,",
    "  INITCOND = '0'",
    ");",
    "COMMENT ON AGGREGATE bench_kit.bench_sum_agg (numeric) IS 'bench aggregate';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON AGGREGATE bench_kit.bench_sum_agg (numeric) IS 'bench_agg';",
        ]
      : []),
    "",
    "CREATE OR REPLACE FUNCTION bench_kit.bench_trg()",
    "RETURNS trigger LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  RETURN NEW;",
    "END;",
    "$$;",
    "COMMENT ON FUNCTION bench_kit.bench_trg() IS 'bench trigger fn';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON FUNCTION bench_kit.bench_trg() IS 'bench_trg_fn';",
        ]
      : []),
    "",
    "CREATE OR REPLACE FUNCTION bench_kit.bench_event()",
    "RETURNS event_trigger LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  NULL;",
    "END;",
    "$$;",
    "COMMENT ON FUNCTION bench_kit.bench_event() IS 'bench event trigger fn';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON FUNCTION bench_kit.bench_event() IS 'bench_ev_fn';",
        ]
      : []),
    "",
    "CREATE PROCEDURE bench_kit.bench_proc(INOUT n integer)",
    "LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  n := n + 1;",
    "END;",
    "$$;",
    "COMMENT ON PROCEDURE bench_kit.bench_proc(integer) IS 'bench procedure';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON PROCEDURE bench_kit.bench_proc(integer) IS 'bench_proc';",
        ]
      : []),
    "",
    "CREATE EVENT TRIGGER bench_et_end ON ddl_command_end",
    "  WHEN TAG IN ('CREATE INDEX')",
    "  EXECUTE FUNCTION bench_kit.bench_event();",
    "COMMENT ON EVENT TRIGGER bench_et_end IS 'bench event trigger';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON EVENT TRIGGER bench_et_end IS 'bench_ev';",
        ]
      : []),
    "",
  ];

  if (fdw !== undefined) {
    const h = sqlString(fdw.host);
    const port = String(fdw.port);
    const db = sqlString(fdw.dbname);
    const u = sqlString(fdw.user);
    const pw = sqlString(fdw.password);
    lines.push(
      "CREATE SERVER bench_loop_srv FOREIGN DATA WRAPPER postgres_fdw",
      `  OPTIONS (host ${h}, port ${sqlString(port)}, dbname ${db});`,
      "COMMENT ON SERVER bench_loop_srv IS 'bench postgres_fdw loopback';",
      ...(includeSec
        ? ["SECURITY LABEL FOR dummy ON SERVER bench_loop_srv IS 'bench_srv';"]
        : []),
      "",
      `CREATE USER MAPPING FOR CURRENT_USER SERVER bench_loop_srv OPTIONS (user ${u}, password ${pw});`,
      "",
      "CREATE FOREIGN TABLE bench_kit.pg_fdw_mirror (",
      "  id integer,",
      "  note text",
      ") SERVER bench_loop_srv OPTIONS (schema_name 'bench_kit', table_name 'pg_fdw_src');",
      "COMMENT ON FOREIGN TABLE bench_kit.pg_fdw_mirror IS 'bench foreign table';",
      ...(includeSec
        ? [
            "SECURITY LABEL FOR dummy ON FOREIGN TABLE bench_kit.pg_fdw_mirror IS 'bench_ft';",
          ]
        : []),
      "GRANT SELECT ON TABLE bench_kit.pg_fdw_mirror TO PUBLIC;",
      "",
    );
  }

  lines.push(
    `CREATE ROLE ${benchShadow} NOLOGIN;`,
    `COMMENT ON ROLE ${benchShadow} IS 'bench non-login role';`,
    ...(includeSec
      ? [`SECURITY LABEL FOR dummy ON ROLE ${benchShadow} IS 'bench_role_nl';`]
      : []),
    "",
    `CREATE ROLE ${benchActor} LOGIN PASSWORD 'bench_actor_pw' NOINHERIT;`,
    `COMMENT ON ROLE ${benchActor} IS 'bench login role';`,
    ...(includeSec
      ? [`SECURITY LABEL FOR dummy ON ROLE ${benchActor} IS 'bench_role_l';`]
      : []),
    `GRANT ${benchShadow} TO ${benchActor} WITH ADMIN OPTION;`,
    "",
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${benchShadow};`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA bench_kit GRANT SELECT ON TABLES TO ${benchShadow};`,
    "",
  );

  lines.push(
    "CREATE TYPE public.bench_status AS ENUM ('draft', 'active', 'archived');",
    "COMMENT ON TYPE public.bench_status IS 'bench public enum';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TYPE public.bench_status IS 'bench_pub_enum';",
        ]
      : []),
    "",
    "CREATE TYPE public.bench_coord AS (x integer, y text);",
    "COMMENT ON TYPE public.bench_coord IS 'bench public composite';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TYPE public.bench_coord IS 'bench_pub_comp';",
        ]
      : []),
    "",
  );

  for (let i = 0; i < n; i++) {
    const t = qIdent(`bench_t_${i}`);
    const parentCol =
      i > 0
        ? `,\n  parent_id integer REFERENCES public.bench_t_${i - 1}(id) ON DELETE SET NULL`
        : "";
    const extras =
      i === 0
        ? `,\n  slug text GENERATED ALWAYS AS (COALESCE(NULLIF(label, ''), '_')) STORED,\n  CONSTRAINT bench_t_0_nonneg CHECK (id >= 0)`
        : "";
    lines.push(`CREATE TABLE public.${t} (`);
    lines.push(`  id serial PRIMARY KEY,`);
    lines.push(`  label text NOT NULL DEFAULT '',`);
    lines.push(
      `  status public.bench_status NOT NULL DEFAULT 'draft'::public.bench_status,`,
    );
    lines.push(
      `  coord public.bench_coord NOT NULL DEFAULT (0, '')::public.bench_coord,`,
    );
    lines.push(`  xref_id integer${parentCol}${extras}`);
    lines.push(`);`);
    lines.push(
      `CREATE INDEX ${t}_label_idx ON public.${t} USING btree (label);`,
    );
    if (i > 0) {
      lines.push(
        `CREATE INDEX ${t}_parent_idx ON public.${t} USING btree (parent_id);`,
      );
    }
    lines.push(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    lines.push(
      `CREATE POLICY ${t}_select ON public.${t} FOR SELECT TO public USING (true);`,
    );
    lines.push(
      `CREATE POLICY ${t}_insert ON public.${t} FOR INSERT TO authenticated WITH CHECK (true);`,
    );
    lines.push(
      `GRANT SELECT, INSERT, UPDATE ON public.${t} TO anon, authenticated, service_role;`,
    );
    lines.push("");
  }

  lines.push(
    "ALTER TABLE public.bench_t_0 REPLICA IDENTITY FULL;",
    "CREATE INDEX bench_t_0_partial ON public.bench_t_0 (id) WHERE status = 'draft'::public.bench_status;",
    "CREATE INDEX bench_t_0_expr ON public.bench_t_0 ((lower(label)));",
    "CREATE INDEX bench_t_0_gin ON public.bench_t_0 USING gin (label gin_trgm_ops);",
    "",
    "CREATE TRIGGER bench_trg_after_ins AFTER INSERT ON public.bench_t_0 FOR EACH ROW EXECUTE FUNCTION bench_kit.bench_trg();",
    "COMMENT ON TRIGGER bench_trg_after_ins ON public.bench_t_0 IS 'bench trigger';",
    "",
    "CREATE RULE bench_block_huge AS ON INSERT TO public.bench_t_0 WHERE length(NEW.label) > 100000 DO INSTEAD NOTHING;",
    "COMMENT ON RULE bench_block_huge ON public.bench_t_0 IS 'bench rule';",
    "",
    "COMMENT ON TABLE public.bench_t_0 IS 'bench wide table sample';",
    "COMMENT ON COLUMN public.bench_t_0.label IS 'bench column comment';",
    ...(includeSec
      ? [
          "SECURITY LABEL FOR dummy ON TABLE public.bench_t_0 IS 'bench_tbl';",
          "SECURITY LABEL FOR dummy ON COLUMN public.bench_t_0.label IS 'bench_col';",
        ]
      : []),
    "COMMENT ON INDEX public.bench_t_0_label_idx IS 'bench btree index';",
    "COMMENT ON POLICY bench_t_0_select ON public.bench_t_0 IS 'bench policy comment';",
    "",
  );

  for (let i = 0; i < n; i++) {
    const t = qIdent(`bench_t_${i}`);
    const ref = xrefTarget(i, n);
    lines.push(
      `ALTER TABLE public.${t} ADD CONSTRAINT ${t}_xref_fk FOREIGN KEY (xref_id) REFERENCES public.bench_t_${ref}(id) ON DELETE SET NULL;`,
    );
  }
  lines.push("");

  const viewBlocks = Math.floor(n / 10);
  for (let k = 0; k < viewBlocks; k++) {
    const a = 10 * k;
    const b = 10 * k + 1;
    if (b >= n) break;
    const v = qIdent(`bench_v_${k}`);
    lines.push(`CREATE VIEW public.${v} AS`);
    lines.push(
      `  SELECT a.id AS root_id, b.id AS child_id, a.status AS root_status, b.coord AS child_coord`,
    );
    lines.push(
      `  FROM public.bench_t_${a} a INNER JOIN public.bench_t_${b} b ON b.parent_id = a.id;`,
    );
    lines.push("");
  }

  if (viewBlocks > 0) {
    lines.push("COMMENT ON VIEW public.bench_v_0 IS 'bench view';");
    if (includeSec) {
      lines.push(
        "SECURITY LABEL FOR dummy ON VIEW public.bench_v_0 IS 'bench_view';",
      );
    }
    lines.push("");
  }

  const mvBlocks = Math.floor(n / 15);
  for (let k = 0; k < mvBlocks; k++) {
    const base = 15 * k;
    const mv = qIdent(`bench_mv_${k}`);
    lines.push(
      `CREATE MATERIALIZED VIEW public.${mv} AS SELECT id, label, status FROM public.bench_t_${base} WITH DATA;`,
    );
    lines.push(
      `CREATE INDEX ${mv}_label_idx ON public.${mv} USING btree (label);`,
    );
    lines.push(
      `GRANT SELECT ON public.${mv} TO anon, authenticated, service_role;`,
    );
    lines.push("");
  }

  if (mvBlocks > 0) {
    lines.push(
      "COMMENT ON MATERIALIZED VIEW public.bench_mv_0 IS 'bench matview';",
    );
    if (includeSec) {
      lines.push(
        "SECURITY LABEL FOR dummy ON MATERIALIZED VIEW public.bench_mv_0 IS 'bench_mv';",
      );
    }
    lines.push(
      "COMMENT ON INDEX public.bench_mv_0_label_idx IS 'bench matview index';",
      "",
    );
  }

  lines.push(
    "CREATE PUBLICATION bench_pub FOR TABLE public.bench_t_0;",
    "COMMENT ON PUBLICATION bench_pub IS 'bench publication';",
  );
  if (includeSec) {
    lines.push(
      "SECURITY LABEL FOR dummy ON PUBLICATION bench_pub IS 'bench_pub';",
    );
  }
  lines.push("");

  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

/** Cross-FK target table index; avoids self-reference when possible. */
function xrefTarget(i: number, n: number): number {
  if (n <= 1) return 0;
  const step = Math.max(1, Math.floor(n / 3));
  let t = (i + step) % n;
  if (t === i) t = (i + 1) % n;
  return t;
}
