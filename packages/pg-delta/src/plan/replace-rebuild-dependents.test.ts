/**
 * A partitionKey replace DROP+CREATEs the parent. Dependents that are not
 * childrenOf(table) — partitions (schema children + inherits depends), views
 * (depends on columns), publicationRel (child of the publication) — must
 * still be rebuilt. Without that, DROP TABLE cascades partitions away, fails
 * on a surviving view, and silently drops publication membership.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { DependencyEdge } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const s1: StableId = { kind: "schema", name: "s1" };
const s2: StableId = { kind: "schema", name: "s2" };
const parent: StableId = { kind: "table", schema: "s1", name: "parent" };
const part: StableId = { kind: "table", schema: "s2", name: "p1" };
const colId: StableId = {
  kind: "column",
  schema: "s1",
  table: "parent",
  name: "id",
};
const colCreated: StableId = {
  kind: "column",
  schema: "s1",
  table: "parent",
  name: "created_on",
};
const colPeriod: StableId = {
  kind: "column",
  schema: "s1",
  table: "parent",
  name: "period",
};
const viewId: StableId = { kind: "view", schema: "s1", name: "parent_ids" };
const pubId: StableId = { kind: "publication", name: "pub_warehouse" };
const pubRel: StableId = {
  kind: "publicationRel",
  publication: "pub_warehouse",
  schema: "s1",
  table: "parent",
};

const tablePayload = (
  partitionKey: string | null,
  extra: Fact["payload"] = {},
): Fact["payload"] => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey,
  partitionBound: null,
  parentTable: null,
  reloptions: null,
  ...extra,
});

const col = (id: StableId, type: string, position: number): Fact => ({
  id,
  parent: parent,
  payload: {
    _position: position,
    type,
    notNull: true,
    identity: null,
    collation: null,
    generatedExpr: null,
  },
});

const parentFact = (partitionKey: string): Fact => ({
  id: parent,
  parent: s1,
  payload: tablePayload(partitionKey),
});

const partFact = (): Fact => ({
  id: part,
  parent: s2,
  payload: {
    persistence: "p",
    rowSecurity: false,
    forceRowSecurity: false,
    replicaIdentity: "d",
    replicaIdentityIndex: null,
    partitionKey: null,
    partitionBound: "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')",
    parentTable: { schema: "s1", name: "parent" },
    reloptions: null,
  },
});

const viewFact: Fact = {
  id: viewId,
  parent: s1,
  payload: { def: "SELECT id FROM s1.parent", reloptions: null },
};

const pubFact: Fact = {
  id: pubId,
  payload: {
    allTables: false,
    viaRoot: true,
    publish: ["insert", "update", "delete", "truncate"],
  },
};

const pubRelFact: Fact = {
  id: pubRel,
  parent: pubId,
  payload: { columns: null, where: null },
};

const schemas: Fact[] = [
  { id: s1, payload: {} },
  { id: s2, payload: {} },
];

const columns: Fact[] = [
  col(colId, "integer", 1),
  col(colCreated, "date", 2),
  col(colPeriod, "date", 3),
];

const inherit: DependencyEdge = { from: part, to: parent, kind: "depends" };
const viewOnCol: DependencyEdge = {
  from: viewId,
  to: colId,
  kind: "depends",
};
const pubRelOnTable: DependencyEdge = {
  from: pubRel,
  to: parent,
  kind: "depends",
};

describe("partitionKey replace rebuilds non-child dependents", () => {
  test("recreates a partition that only depends via inheritance", () => {
    const source = buildFactBase(
      [...schemas, parentFact("RANGE (created_on)"), ...columns, partFact()],
      [inherit],
    );
    const desired = buildFactBase(
      [...schemas, parentFact("RANGE (period)"), ...columns, partFact()],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls.some((s) => s.includes(`PARTITION OF`))).toBe(true);
  });

  test("drops a column-dependent view before DROP TABLE", () => {
    const source = buildFactBase(
      [...schemas, parentFact("RANGE (created_on)"), ...columns, viewFact],
      [viewOnCol],
    );
    const desired = buildFactBase(
      [...schemas, parentFact("RANGE (period)"), ...columns, viewFact],
      [viewOnCol],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    const dropView = sqls.findIndex((s) => s.startsWith(`DROP VIEW`));
    const dropTable = sqls.findIndex((s) =>
      s.startsWith(`DROP TABLE "s1"."parent"`),
    );
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(dropTable).toBeGreaterThanOrEqual(0);
    expect(dropView).toBeLessThan(dropTable);
    expect(sqls.some((s) => s.startsWith(`CREATE VIEW`))).toBe(true);
  });

  test("re-ADDs surviving publication membership after the table replace", () => {
    const source = buildFactBase(
      [
        ...schemas,
        parentFact("RANGE (created_on)"),
        ...columns,
        pubFact,
        pubRelFact,
      ],
      [pubRelOnTable],
    );
    const desired = buildFactBase(
      [
        ...schemas,
        parentFact("RANGE (period)"),
        ...columns,
        pubFact,
        pubRelFact,
      ],
      [pubRelOnTable],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(
      sqls.some((s) => s.includes(`ALTER PUBLICATION`) && s.includes(`ADD`)),
    ).toBe(true);
  });
});
