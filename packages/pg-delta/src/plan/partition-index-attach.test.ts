/**
 * CREATE INDEX ON ONLY a partitioned parent does not build indexes on
 * partitions that already exist. The plan must CREATE the child index and
 * ATTACH it, matching pg_dump post-data.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { DependencyEdge } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const s1: StableId = { kind: "schema", name: "s1" };
const parent: StableId = { kind: "table", schema: "s1", name: "parent" };
const part: StableId = { kind: "table", schema: "s1", name: "p1" };
const colId: StableId = {
  kind: "column",
  schema: "s1",
  table: "parent",
  name: "id",
};
const colStatus: StableId = {
  kind: "column",
  schema: "s1",
  table: "parent",
  name: "status",
};
const parentIdx: StableId = {
  kind: "index",
  schema: "s1",
  name: "idx_parent_status",
};
const childIdx: StableId = {
  kind: "index",
  schema: "s1",
  name: "p1_status_idx",
};

const tablePayload = (extra: Fact["payload"] = {}): Fact["payload"] => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
  reloptions: null,
  ...extra,
});

const schema: Fact = { id: s1, payload: {} };
const parentFact: Fact = {
  id: parent,
  parent: s1,
  payload: tablePayload({ partitionKey: "RANGE (id)" }),
};
const partFact: Fact = {
  id: part,
  parent: s1,
  payload: tablePayload({
    partitionBound: "FOR VALUES FROM (0) TO (100)",
    parentTable: { schema: "s1", name: "parent" },
  }),
};
const columns: Fact[] = [
  {
    id: colId,
    parent,
    payload: {
      _position: 1,
      type: "integer",
      notNull: true,
      identity: null,
      collation: null,
      generatedExpr: null,
    },
  },
  {
    id: colStatus,
    parent,
    payload: {
      _position: 2,
      type: "text",
      notNull: false,
      identity: null,
      collation: null,
      generatedExpr: null,
    },
  },
];
const inherit: DependencyEdge = { from: part, to: parent, kind: "depends" };

const parentIdxFact: Fact = {
  id: parentIdx,
  parent,
  payload: {
    def: `CREATE INDEX idx_parent_status ON ONLY s1.parent USING btree (status)`,
    valid: true,
    attachedTo: null,
  },
};
const childIdxFact: Fact = {
  id: childIdx,
  parent: part,
  payload: {
    def: `CREATE INDEX p1_status_idx ON s1.p1 USING btree (status)`,
    valid: true,
    attachedTo: { schema: "s1", name: "idx_parent_status" },
  },
};

describe("add index on partitioned parent with existing partitions", () => {
  test("emits child CREATE INDEX and ATTACH PARTITION", () => {
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls.some((s) => s.includes(`ON ONLY`))).toBe(true);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX p1_status_idx`))).toBe(
      true,
    );
    expect(
      sqls.some(
        (s) => s.includes(`ATTACH PARTITION`) && s.includes(`p1_status_idx`),
      ),
    ).toBe(true);
  });

  test("DROP of the parent index subsumes attached children", () => {
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, partFact],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(
      sqls.some(
        (s) => s.includes(`DROP INDEX`) && s.includes(`idx_parent_status`),
      ),
    ).toBe(true);
    expect(sqls.some((s) => s.includes(`p1_status_idx`))).toBe(false);
  });

  test("attaching a missing child does not DROP the parent index", () => {
    const part2: StableId = { kind: "table", schema: "s1", name: "p2" };
    const child2: StableId = {
      kind: "index",
      schema: "s1",
      name: "p2_status_idx",
    };
    const part2Fact: Fact = {
      id: part2,
      parent: s1,
      payload: tablePayload({
        partitionBound: "FOR VALUES FROM (100) TO (200)",
        parentTable: { schema: "s1", name: "parent" },
      }),
    };
    const child2Fact: Fact = {
      id: child2,
      parent: part2,
      payload: {
        def: `CREATE INDEX p2_status_idx ON s1.p2 USING btree (status)`,
        valid: true,
        attachedTo: { schema: "s1", name: "idx_parent_status" },
      },
    };
    const inherit2: DependencyEdge = {
      from: part2,
      to: parent,
      kind: "depends",
    };
    const source = buildFactBase(
      [
        schema,
        parentFact,
        ...columns,
        partFact,
        part2Fact,
        parentIdxFact,
        childIdxFact,
      ],
      [inherit, inherit2],
    );
    const desired = buildFactBase(
      [
        schema,
        parentFact,
        ...columns,
        partFact,
        part2Fact,
        parentIdxFact,
        childIdxFact,
        child2Fact,
      ],
      [inherit, inherit2],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls.some((s) => s.includes(`DROP INDEX`))).toBe(false);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX p2_status_idx`))).toBe(
      true,
    );
    expect(
      sqls.some(
        (s) => s.includes(`ATTACH PARTITION`) && s.includes(`p2_status_idx`),
      ),
    ).toBe(true);
  });

  test("replacing a parent index def does not DROP attached children", () => {
    const parentIdxNext: Fact = {
      ...parentIdxFact,
      payload: {
        ...parentIdxFact.payload,
        def: `CREATE INDEX idx_parent_status ON ONLY s1.parent USING btree (status, id)`,
      },
    };
    const childIdxNext: Fact = {
      ...childIdxFact,
      payload: {
        ...childIdxFact.payload,
        def: `CREATE INDEX p1_status_idx ON s1.p1 USING btree (status, id)`,
      },
    };
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxNext, childIdxNext],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(
      sqls.some((s) => s.includes(`DROP INDEX`) && s.includes(`p1_status_idx`)),
    ).toBe(false);
    expect(
      sqls.some(
        (s) => s.includes(`DROP INDEX`) && s.includes(`idx_parent_status`),
      ),
    ).toBe(true);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX p1_status_idx`))).toBe(
      true,
    );
  });

  test("replacing a parent index def recreates unchanged attached children", () => {
    const parentIdxNext: Fact = {
      ...parentIdxFact,
      payload: {
        ...parentIdxFact.payload,
        def: `CREATE INDEX idx_parent_status ON ONLY s1.parent USING btree (status) WITH (fillfactor='70')`,
      },
    };
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxNext, childIdxFact],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(
      sqls.some((s) => s.includes(`DROP INDEX`) && s.includes(`p1_status_idx`)),
    ).toBe(false);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX p1_status_idx`))).toBe(
      true,
    );
    expect(
      sqls.some(
        (s) => s.includes(`ATTACH PARTITION`) && s.includes(`p1_status_idx`),
      ),
    ).toBe(true);
  });

  test("replacing a parent index def recreates nested attached grandchildren", () => {
    const mid: StableId = { kind: "table", schema: "s1", name: "mid" };
    const leaf: StableId = { kind: "table", schema: "s1", name: "leaf" };
    const midIdx: StableId = { kind: "index", schema: "s1", name: "z_middle" };
    const leafIdx: StableId = { kind: "index", schema: "s1", name: "a_leaf" };
    const midFact: Fact = {
      id: mid,
      parent: s1,
      payload: tablePayload({
        partitionBound: "FOR VALUES FROM (0) TO (100)",
        parentTable: { schema: "s1", name: "parent" },
        partitionKey: "RANGE (id)",
      }),
    };
    const leafFact: Fact = {
      id: leaf,
      parent: s1,
      payload: tablePayload({
        partitionBound: "FOR VALUES FROM (0) TO (50)",
        parentTable: { schema: "s1", name: "mid" },
      }),
    };
    const midIdxFact: Fact = {
      id: midIdx,
      parent: mid,
      payload: {
        def: `CREATE INDEX z_middle ON ONLY s1.mid USING btree (status)`,
        valid: true,
        attachedTo: { schema: "s1", name: "idx_parent_status" },
      },
    };
    const leafIdxFact: Fact = {
      id: leafIdx,
      parent: leaf,
      payload: {
        def: `CREATE INDEX a_leaf ON s1.leaf USING btree (status)`,
        valid: true,
        attachedTo: { schema: "s1", name: "z_middle" },
      },
    };
    const parentIdxNext: Fact = {
      ...parentIdxFact,
      payload: {
        ...parentIdxFact.payload,
        def: `CREATE INDEX idx_parent_status ON ONLY s1.parent USING btree (status) WITH (fillfactor='70')`,
      },
    };
    const inheritMid: DependencyEdge = {
      from: mid,
      to: parent,
      kind: "depends",
    };
    const inheritLeaf: DependencyEdge = {
      from: leaf,
      to: mid,
      kind: "depends",
    };
    const source = buildFactBase(
      [
        schema,
        parentFact,
        ...columns,
        midFact,
        leafFact,
        leafIdxFact,
        parentIdxFact,
        midIdxFact,
      ],
      [inheritMid, inheritLeaf],
    );
    const desired = buildFactBase(
      [
        schema,
        parentFact,
        ...columns,
        midFact,
        leafFact,
        leafIdxFact,
        parentIdxNext,
        midIdxFact,
      ],
      [inheritMid, inheritLeaf],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(
      sqls.some((s) => s.includes(`DROP INDEX`) && s.includes(`a_leaf`)),
    ).toBe(false);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX z_middle`))).toBe(true);
    expect(sqls.some((s) => s.startsWith(`CREATE INDEX a_leaf`))).toBe(true);
  });

  test("renaming a partitioned parent index recreates attached children", () => {
    const parentIdxOld: StableId = {
      kind: "index",
      schema: "s1",
      name: "idx_old",
    };
    const parentIdxNew: StableId = {
      kind: "index",
      schema: "s1",
      name: "idx_new",
    };
    const parentOld: Fact = {
      id: parentIdxOld,
      parent,
      payload: {
        def: `CREATE INDEX idx_old ON ONLY s1.parent USING btree (status)`,
        valid: true,
        attachedTo: null,
      },
    };
    const parentNew: Fact = {
      id: parentIdxNew,
      parent,
      payload: {
        def: `CREATE INDEX idx_new ON ONLY s1.parent USING btree (status)`,
        valid: true,
        attachedTo: null,
      },
    };
    const childOnOld: Fact = {
      ...childIdxFact,
      payload: {
        ...childIdxFact.payload,
        attachedTo: { schema: "s1", name: "idx_old" },
      },
    };
    const childOnNew: Fact = {
      ...childIdxFact,
      payload: {
        ...childIdxFact.payload,
        attachedTo: { schema: "s1", name: "idx_new" },
      },
    };
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentOld, childOnOld],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentNew, childOnNew],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    const dropOld = sqls.findIndex(
      (s) => s.includes(`DROP INDEX`) && s.includes(`idx_old`),
    );
    const createChild = sqls.findIndex((s) =>
      s.startsWith(`CREATE INDEX p1_status_idx`),
    );
    expect(dropOld).toBeGreaterThanOrEqual(0);
    expect(
      sqls.some((s) => s.includes(`DROP INDEX`) && s.includes(`p1_status_idx`)),
    ).toBe(false);
    expect(createChild).toBeGreaterThan(dropOld);
    expect(
      sqls.some(
        (s) =>
          s.includes(`ATTACH PARTITION`) &&
          s.includes(`idx_new`) &&
          s.includes(`p1_status_idx`),
      ),
    ).toBe(true);
  });

  test("replacing a partitioned parent while dropping partitions does not cycle", () => {
    const heapParent: Fact = {
      ...parentFact,
      payload: tablePayload(),
    };
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase([schema, heapParent, ...columns], []);
    expect(() => plan(source, desired)).not.toThrow();
  });

  test("dropping a partitioned parent together with its indexed partitions does not cycle", () => {
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase([schema], []);
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls).toEqual([`DROP TABLE "s1"."p1"`, `DROP TABLE "s1"."parent"`]);
  });

  test("replacing a partition's bound while removing the parent index never drops the attached child", () => {
    const reboundPart: Fact = {
      ...partFact,
      payload: tablePayload({
        partitionBound: "FOR VALUES FROM (0) TO (200)",
        parentTable: { schema: "s1", name: "parent" },
      }),
    };
    const source = buildFactBase(
      [schema, parentFact, ...columns, partFact, parentIdxFact, childIdxFact],
      [inherit],
    );
    const desired = buildFactBase(
      [schema, parentFact, ...columns, reboundPart],
      [inherit],
    );
    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls).toContain(`DROP INDEX "s1"."idx_parent_status"`);
    expect(sqls).toContain(`DROP TABLE "s1"."p1"`);
    expect(sqls.some((s) => s.includes(`p1_status_idx`))).toBe(false);
    expect(
      sqls.some((s) => s.startsWith(`CREATE TABLE "s1"."p1" PARTITION OF`)),
    ).toBe(true);
  });
});
