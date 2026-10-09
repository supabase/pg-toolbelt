/**
 * The benchmark catalog: ~10k facts spread over the extractor families the
 * engine spends its time on (tables/columns/indexes, views, functions,
 * triggers, RLS policies, ACLs, comments, sequences, enums). Shared by
 * `scripts/benchmark.ts` and the CI regression gate (`scripts/bench/`).
 */

export const SCHEMAS = 40;
export const TABLES_PER_SCHEMA = 15;
export const COLUMNS_PER_TABLE = 8;

export function fixtureSql(): string {
  const parts: string[] = [
    // Roles are cluster-global: tolerate a second fixture DB on the same cluster.
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bench_reader') THEN
         CREATE ROLE bench_reader NOLOGIN;
       END IF;
     END $$;`,
  ];
  for (let s = 0; s < SCHEMAS; s++) {
    const schema = `bench_${String(s).padStart(2, "0")}`;
    parts.push(`CREATE SCHEMA ${schema};`);
    parts.push(
      `CREATE TYPE ${schema}.status AS ENUM ('a', 'b', 'c');`,
      `CREATE SEQUENCE ${schema}.ids;`,
      `CREATE FUNCTION ${schema}.f(a integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT a + 1';`,
      `CREATE FUNCTION ${schema}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.c2 := now(); RETURN NEW; END $$;`,
      `GRANT USAGE ON SCHEMA ${schema} TO bench_reader;`,
    );
    for (let t = 0; t < TABLES_PER_SCHEMA; t++) {
      const table = `${schema}.t${String(t).padStart(2, "0")}`;
      const cols = [
        "id integer NOT NULL DEFAULT nextval('" + schema + ".ids')",
      ];
      for (let c = 0; c < COLUMNS_PER_TABLE; c++) {
        cols.push(
          c % 3 === 0
            ? `c${c} text`
            : c % 3 === 1
              ? `c${c} numeric(12,2) DEFAULT 0`
              : `c${c} timestamptz`,
        );
      }
      cols.push("PRIMARY KEY (id)");
      parts.push(`CREATE TABLE ${table} (${cols.join(", ")});`);
      parts.push(`CREATE INDEX t${t}_c0_idx_${s} ON ${table} (c0);`);
      if (t % 2 === 0) {
        parts.push(
          `CREATE VIEW ${schema}.v${t} AS SELECT id, c0 FROM ${table} WHERE id > 0;`,
        );
        parts.push(`COMMENT ON TABLE ${table} IS 'bench table ${t}';`);
        parts.push(`GRANT SELECT ON ${table} TO bench_reader;`);
      }
      if (t % 5 === 0) {
        parts.push(
          `CREATE TRIGGER touch BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.touch();`,
          `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
          `CREATE POLICY reader ON ${table} FOR SELECT TO bench_reader USING (id > 0);`,
        );
      }
    }
  }
  return parts.join("\n");
}

/** A small, mixed delta against {@link fixtureSql} — the common "one PR's
 *  worth of schema change on a big database" shape. */
export const MUTATIONS = `
  CREATE SCHEMA bench_new;
  CREATE TABLE bench_new.extra (id integer PRIMARY KEY, note text);
  ALTER TABLE bench_00.t00 ADD COLUMN added_col integer DEFAULT 5;
  DROP VIEW bench_01.v0;
  COMMENT ON SCHEMA bench_02 IS 'mutated';
  REVOKE SELECT ON bench_03.t02 FROM bench_reader;
  ALTER POLICY reader ON bench_04.t05 USING (id > 1);
  CREATE INDEX t01_c3_idx ON bench_05.t01 (c3);
`;
