/**
 * Unit tests for compaction's executor-safe constraint folding (§3.6). No
 * Docker / database required — synthetic fact bases drive `plan()` end to end.
 *
 * A validated PRIMARY KEY / UNIQUE / CHECK table constraint is self-contained
 * (it never references another relation's rows), so folding it into its
 * co-created table's CREATE parens is safe for the apply EXECUTOR — unlike a
 * FOREIGN KEY, whose referenced table may be created later (constraint folds
 * were previously export-only for exactly that reason). The rule table
 * declares the safe types (`executorSafe` on the fold hint); the fold pass
 * applies them under the strict column-style crossing veto.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaApp: StableId = { kind: "schema", name: "app" };
const table = (name: string): StableId => ({
  kind: "table",
  schema: "app",
  name,
});
const column = (tbl: string, name: string): StableId => ({
  kind: "column",
  schema: "app",
  table: tbl,
  name,
});
const constraint = (tbl: string, name: string): StableId => ({
  kind: "constraint",
  schema: "app",
  table: tbl,
  name,
});

const f = (id: StableId, payload: Payload = {}, parent?: StableId): Fact =>
  parent ? { id, parent, payload } : { id, payload };
const tablePayload = (): Payload => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
});
const columnPayload = (position: number): Payload => ({
  type: "integer",
  collation: null,
  generatedExpr: null,
  identity: null,
  notNull: true,
  _position: position,
});
const constraintFact = (
  tbl: string,
  name: string,
  def: string,
  type: string,
  validated = true,
  keyColumns?: string[],
): Fact =>
  f(
    constraint(tbl, name),
    {
      def,
      type,
      validated,
      ...(keyColumns ? { _keyColumns: keyColumns } : {}),
    },
    table(tbl),
  );

/** table t with one integer column and one constraint. */
const tableFacts = (tbl: string, ...constraints: Fact[]): Fact[] => [
  f(table(tbl), tablePayload(), schemaApp),
  f(column(tbl, "id"), columnPayload(1), table(tbl)),
  ...constraints,
];

const empty = buildFactBase([], []);
const sqls = (p: ReturnType<typeof plan>) => p.actions.map((a) => a.sql);

describe("compaction folds self-contained constraints into CREATE TABLE", () => {
  test("a validated PRIMARY KEY folds into the co-created table's parens", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        ...tableFacts(
          "t",
          constraintFact("t", "t_pkey", "PRIMARY KEY (id)", "p"),
        ),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    expect(sqls(compacted)).toContain(
      `CREATE TABLE "app"."t" ("id" integer NOT NULL, CONSTRAINT "t_pkey" PRIMARY KEY (id))`,
    );
    expect(sqls(compacted).some((s) => s.includes("ADD CONSTRAINT"))).toBe(
      false,
    );
  });

  test("UNIQUE and CHECK fold; the uncompacted plan keeps the ALTERs", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        ...tableFacts(
          "t",
          constraintFact("t", "t_id_key", "UNIQUE (id)", "u"),
          constraintFact("t", "t_id_check", "CHECK ((id > 0))", "c"),
        ),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createTable).toContain(`CONSTRAINT "t_id_check" CHECK ((id > 0))`);
    expect(createTable).toContain(`CONSTRAINT "t_id_key" UNIQUE (id)`);
    expect(sqls(compacted).some((s) => s.includes("ADD CONSTRAINT"))).toBe(
      false,
    );

    const decomposed = plan(empty, desired, { compact: false });
    expect(
      sqls(decomposed).filter((s) => s.includes("ADD CONSTRAINT")),
    ).toHaveLength(2);
  });

  test("a validated FOREIGN KEY stays an ALTER in executor plans", () => {
    const fkDef = "FOREIGN KEY (id) REFERENCES app.u(id)";
    const desired = buildFactBase(
      [
        f(schemaApp),
        ...tableFacts(
          "u",
          constraintFact("u", "u_pkey", "PRIMARY KEY (id)", "p"),
        ),
        ...tableFacts("t", constraintFact("t", "t_id_fkey", fkDef, "f")),
      ],
      [
        // the FK depends on the referenced table (pg_depend at extract time)
        {
          from: constraint("t", "t_id_fkey"),
          to: table("u"),
          kind: "depends",
        } satisfies DependencyEdge,
      ],
    );
    const compacted = plan(empty, desired);
    expect(sqls(compacted)).toContain(
      `ALTER TABLE "app"."t" ADD CONSTRAINT "t_id_fkey" ${fkDef}`,
    );
    const createT = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createT).not.toContain("FOREIGN KEY");
  });

  test("a NOT VALID constraint never folds (inline constraints always validate)", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        ...tableFacts(
          "t",
          constraintFact("t", "t_id_check", "CHECK ((id > 0))", "c", false),
        ),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    expect(sqls(compacted)).toContain(
      `ALTER TABLE "app"."t" ADD CONSTRAINT "t_id_check" CHECK ((id > 0)) NOT VALID`,
    );
  });

  test("a constraint added to a PRE-EXISTING table stays an ALTER", () => {
    const source = buildFactBase([f(schemaApp), ...tableFacts("t")], []);
    const desired = buildFactBase(
      [
        f(schemaApp),
        ...tableFacts(
          "t",
          constraintFact("t", "t_pkey", "PRIMARY KEY (id)", "p"),
        ),
      ],
      [],
    );
    const compacted = plan(source, desired);
    expect(sqls(compacted)).toEqual([
      `ALTER TABLE "app"."t" ADD CONSTRAINT "t_pkey" PRIMARY KEY (id)`,
    ]);
  });

  test("PK + same-key UNIQUE still folds when _keyColumns is absent", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        f(table("t"), tablePayload(), schemaApp),
        f(column("t", "id"), columnPayload(1), table("t")),
        f(column("t", "company_id"), columnPayload(2), table("t")),
        constraintFact("t", "t_pkey", "PRIMARY KEY (id, company_id)", "p"),
        constraintFact("t", "t_ab_unique", "UNIQUE (id, company_id)", "u"),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createTable).toContain(
      `CONSTRAINT "t_pkey" PRIMARY KEY (id, company_id)`,
    );
    expect(createTable).toContain(
      `CONSTRAINT "t_ab_unique" UNIQUE (id, company_id)`,
    );
    expect(sqls(compacted).some((s) => s.includes("ADD CONSTRAINT"))).toBe(
      false,
    );
  });

  test("UNIQUE on the same columns as a co-created PRIMARY KEY stays an ALTER", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        f(table("t"), tablePayload(), schemaApp),
        f(column("t", "id"), columnPayload(1), table("t")),
        f(column("t", "company_id"), columnPayload(2), table("t")),
        constraintFact(
          "t",
          "t_pkey",
          "PRIMARY KEY (id, company_id)",
          "p",
          true,
          ["id", "company_id"],
        ),
        constraintFact(
          "t",
          "t_ab_unique",
          "UNIQUE (id, company_id)",
          "u",
          true,
          ["id", "company_id"],
        ),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createTable).toContain(
      `CONSTRAINT "t_pkey" PRIMARY KEY (id, company_id)`,
    );
    expect(createTable).not.toContain("UNIQUE");
    expect(sqls(compacted)).toContain(
      `ALTER TABLE "app"."t" ADD CONSTRAINT "t_ab_unique" UNIQUE (id, company_id)`,
    );
  });

  test("UNIQUE on different columns than the PRIMARY KEY still folds", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        f(table("t"), tablePayload(), schemaApp),
        f(column("t", "id"), columnPayload(1), table("t")),
        f(column("t", "email"), columnPayload(2), table("t")),
        constraintFact("t", "t_pkey", "PRIMARY KEY (id)", "p", true, ["id"]),
        constraintFact("t", "t_email_key", "UNIQUE (email)", "u", true, [
          "email",
        ]),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createTable).toContain(`CONSTRAINT "t_pkey" PRIMARY KEY (id)`);
    expect(createTable).toContain(`CONSTRAINT "t_email_key" UNIQUE (email)`);
    expect(sqls(compacted).some((s) => s.includes("ADD CONSTRAINT"))).toBe(
      false,
    );
  });

  test("a second UNIQUE on the same columns as a folded UNIQUE stays an ALTER", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        f(table("t"), tablePayload(), schemaApp),
        f(column("t", "id"), columnPayload(1), table("t")),
        constraintFact("t", "t_u1", "UNIQUE (id)", "u", true, ["id"]),
        constraintFact("t", "t_u2", "UNIQUE (id)", "u", true, ["id"]),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect((createTable?.match(/UNIQUE/g) ?? []).length).toBe(1);
    const alters = sqls(compacted).filter((s) => s.includes("ADD CONSTRAINT"));
    expect(alters).toHaveLength(1);
    expect(alters[0]).toMatch(/UNIQUE \(id\)/);
    expect(sqls(compacted).some((s) => s.includes(`"t_u1"`))).toBe(true);
    expect(sqls(compacted).some((s) => s.includes(`"t_u2"`))).toBe(true);
  });

  test("UNIQUE with the PK columns in a different order still folds", () => {
    const desired = buildFactBase(
      [
        f(schemaApp),
        f(table("t"), tablePayload(), schemaApp),
        f(column("t", "a"), columnPayload(1), table("t")),
        f(column("t", "b"), columnPayload(2), table("t")),
        constraintFact("t", "t_pkey", "PRIMARY KEY (a, b)", "p", true, [
          "a",
          "b",
        ]),
        constraintFact("t", "t_ba_unique", "UNIQUE (b, a)", "u", true, [
          "b",
          "a",
        ]),
      ],
      [],
    );
    const compacted = plan(empty, desired);
    const createTable = sqls(compacted).find((s) =>
      s.startsWith(`CREATE TABLE "app"."t"`),
    );
    expect(createTable).toContain(`CONSTRAINT "t_pkey" PRIMARY KEY (a, b)`);
    expect(createTable).toContain(`CONSTRAINT "t_ba_unique" UNIQUE (b, a)`);
    expect(sqls(compacted).some((s) => s.includes("ADD CONSTRAINT"))).toBe(
      false,
    );
  });
});
