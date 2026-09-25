/**
 * Column grants versus a same-grantee object-level REVOKE. No Docker required —
 * synthetic fact bases drive `plan()` end to end.
 *
 * PostgreSQL revokes a role's column privileges on a relation whenever a
 * table-level privilege is revoked from it (REVOKE docs). Every object-level
 * acl action leads with `REVOKE ALL ON <rel> FROM <role>` (create leader,
 * replace, drop, create-time hygiene), so for each (relation, role):
 *   - a column GRANT must be ordered AFTER that REVOKE by a graph edge, and
 *   - a desired column acl with no action of its own must be re-emitted after
 *     it (forced recreate), never silently wiped.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaApp: StableId = { kind: "schema", name: "app" };
const tableT: StableId = { kind: "table", schema: "app", name: "t" };
const viewV: StableId = { kind: "view", schema: "app", name: "v" };
const colName: StableId = {
  kind: "column",
  schema: "app",
  table: "t",
  name: "name",
};
const role = (name: string): StableId => ({ kind: "role", name });
const acl = (target: StableId, grantee: string, column?: string): StableId =>
  column === undefined
    ? { kind: "acl", target, grantee }
    : { kind: "acl", target, grantee, column };

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
const columnPayload = (): Payload => ({
  _position: 1,
  type: "text",
  notNull: false,
  identity: null,
  collation: null,
  generatedExpr: null,
});
const viewPayload = (): Payload => ({
  def: " SELECT 1 AS a, 2 AS b;",
  reloptions: null,
});
const grant = (
  target: StableId,
  grantee: string,
  privileges: string[],
  parent: StableId,
  column?: string,
): Fact =>
  f(acl(target, grantee, column), { privileges, grantable: [] }, parent);

/** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT ALL ON
 *  TABLES TO <grantee>` — makes every relation create / recreate fire the
 *  create-time REVOKE (explicit leader or hygiene). */
const adp = (grantee: string): Fact =>
  f(
    {
      kind: "defaultPrivilege",
      role: "postgres",
      schema: "app",
      objtype: "r",
      grantee,
    },
    {
      privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      grantable: [],
    },
  );

const base: Fact[] = [
  f(schemaApp),
  f(role("r")),
  f(tableT, tablePayload(), schemaApp),
  f(colName, columnPayload(), tableT),
  f(viewV, viewPayload(), schemaApp),
];

const OBJ_REVOKE_T = `REVOKE ALL ON TABLE "app"."t" FROM "r"`;
const COL_GRANT_T = `GRANT UPDATE ("name") ON TABLE "app"."t" TO "r"`;
const OBJ_REVOKE_V = `REVOKE ALL ON TABLE "app"."v" FROM "r"`;
const COL_GRANT_V = `GRANT UPDATE ("b") ON TABLE "app"."v" TO "r"`;

const sqls = (p: ReturnType<typeof plan>): string[] =>
  p.actions.map((a) => a.sql);
const expectAfter = (list: string[], before: string, after: string): void => {
  const b = list.indexOf(before);
  const a = list.indexOf(after);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBeGreaterThan(b);
};

describe("column grants survive a same-grantee object-level REVOKE", () => {
  test("object-level grant removed: the unchanged column grant is re-granted after the REVOKE", () => {
    const columnGrants = [
      grant(tableT, "r", ["UPDATE"], colName, "name"),
      grant(viewV, "r", ["UPDATE"], viewV, "b"),
    ];
    const source = buildFactBase(
      [
        ...base,
        grant(tableT, "r", ["SELECT"], tableT),
        grant(viewV, "r", ["SELECT"], viewV),
        ...columnGrants,
      ],
      [],
    );
    const desired = buildFactBase([...base, ...columnGrants], []);
    const list = sqls(plan(source, desired));
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
    expectAfter(list, OBJ_REVOKE_V, COL_GRANT_V);
  });

  test("object-level grant added on an existing relation: the unchanged column grant is re-granted after the REVOKE", () => {
    const columnGrants = [
      grant(tableT, "r", ["UPDATE"], colName, "name"),
      grant(viewV, "r", ["UPDATE"], viewV, "b"),
    ];
    const source = buildFactBase([...base, ...columnGrants], []);
    const desired = buildFactBase(
      [
        ...base,
        grant(tableT, "r", ["SELECT"], tableT),
        grant(viewV, "r", ["SELECT"], viewV),
        ...columnGrants,
      ],
      [],
    );
    const list = sqls(plan(source, desired));
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
    expectAfter(list, OBJ_REVOKE_V, COL_GRANT_V);
  });

  test("object-level privilege change (replace): the unchanged column grant is re-granted once, after the REVOKE", () => {
    const columnGrants = [
      grant(tableT, "r", ["UPDATE"], colName, "name"),
      grant(viewV, "r", ["UPDATE"], viewV, "b"),
    ];
    const source = buildFactBase(
      [
        ...base,
        grant(tableT, "r", ["DELETE", "SELECT"], tableT),
        grant(viewV, "r", ["SELECT"], viewV),
        ...columnGrants,
      ],
      [],
    );
    const desired = buildFactBase(
      [
        ...base,
        grant(tableT, "r", ["DELETE", "INSERT", "SELECT"], tableT),
        grant(viewV, "r", ["INSERT", "SELECT"], viewV),
        ...columnGrants,
      ],
      [],
    );
    const list = sqls(plan(source, desired));
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
    expectAfter(list, OBJ_REVOKE_V, COL_GRANT_V);
    expect(list.filter((s) => s === COL_GRANT_T)).toHaveLength(1);
    expect(list.filter((s) => s === COL_GRANT_V)).toHaveLength(1);
  });

  test("object-level grant swapped for a column grant: the column GRANT follows the REVOKE, which declares the column acl destroyed", () => {
    const source = buildFactBase(
      [...base, grant(tableT, "r", ["SELECT"], tableT)],
      [],
    );
    const desired = buildFactBase(
      [...base, grant(tableT, "r", ["UPDATE"], colName, "name")],
      [],
    );
    const p = plan(source, desired);
    const list = sqls(p);
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
    const revoke = p.actions.find((a) => a.sql === OBJ_REVOKE_T);
    expect(revoke?.destroys.map(encodeId)).toContain(
      encodeId(acl(tableT, "r", "name")),
    );
  });

  test("new relation under default privileges: every column GRANT runs after that role's create-time REVOKE", () => {
    const common: Fact[] = [
      f(schemaApp),
      f(role("postgres")),
      f(role("r")),
      f(role("colonly")),
      adp("r"),
      adp("colonly"),
    ];
    const source = buildFactBase(common, []);
    const desired = buildFactBase(
      [
        ...common,
        f(tableT, tablePayload(), schemaApp),
        f(colName, columnPayload(), tableT),
        // r: narrowed object grant + column grant (explicit REVOKE leader kept:
        // the default would grant more than the explicit acl)
        grant(tableT, "r", ["SELECT"], tableT),
        grant(tableT, "r", ["UPDATE"], colName, "name"),
        // colonly: column grant only (the wipe is the hygiene REVOKE)
        grant(tableT, "colonly", ["SELECT"], colName, "name"),
      ],
      [{ from: tableT, to: role("postgres"), kind: "owner" }],
    );
    const list = sqls(plan(source, desired));
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
    expectAfter(
      list,
      `REVOKE ALL ON TABLE "app"."t" FROM "colonly"`,
      `GRANT SELECT ("name") ON TABLE "app"."t" TO "colonly"`,
    );
  });

  // A relation REBUILD (drop + recreate) recreates the object-level acl AND the
  // column acl from the desired subtree. The recreated REVOKE leader wipes the
  // recreated column grant too, so the same ordering must hold — and the wipe
  // must not order the leader before the relation's DROP (that would close a
  // DROP -> CREATE -> leader -> DROP cycle).
  test("view rebuild: both grants are re-granted, the column GRANT after the REVOKE", () => {
    const grants = [
      grant(viewV, "r", ["SELECT"], viewV),
      grant(viewV, "r", ["UPDATE"], viewV, "b"),
    ];
    const source = buildFactBase([...base, ...grants], []);
    const desired = buildFactBase(
      [
        ...base.filter((x) => x.id !== viewV),
        f(
          viewV,
          { def: " SELECT 10 AS a, 20 AS b;", reloptions: null },
          schemaApp,
        ),
        ...grants,
      ],
      [],
    );
    const list = sqls(plan(source, desired));
    expectAfter(
      list,
      `CREATE VIEW "app"."v" AS SELECT 10 AS a, 20 AS b;`,
      OBJ_REVOKE_V,
    );
    expectAfter(list, OBJ_REVOKE_V, COL_GRANT_V);
  });

  test("table rebuild (partition key change): both grants are re-granted, the column GRANT after the REVOKE", () => {
    const grants = [
      grant(tableT, "r", ["SELECT"], tableT),
      grant(tableT, "r", ["UPDATE"], colName, "name"),
    ];
    const source = buildFactBase([...base, ...grants], []);
    const desired = buildFactBase(
      [
        ...base.filter((x) => x.id !== tableT),
        f(
          tableT,
          { ...tablePayload(), partitionKey: "LIST (name)" },
          schemaApp,
        ),
        ...grants,
      ],
      [],
    );
    const list = sqls(plan(source, desired));
    expectAfter(list, `DROP TABLE "app"."t"`, OBJ_REVOKE_T);
    expectAfter(list, OBJ_REVOKE_T, COL_GRANT_T);
  });

  test("view rebuild under default privileges with a column-only grant: the hygiene REVOKE precedes the re-granted column GRANT", () => {
    const common: Fact[] = [
      f(schemaApp),
      f(role("postgres")),
      f(role("r")),
      adp("r"),
      grant(viewV, "r", ["UPDATE"], viewV, "b"),
    ];
    const owner = [
      { from: viewV, to: role("postgres"), kind: "owner" as const },
    ];
    const source = buildFactBase(
      [...common, f(viewV, viewPayload(), schemaApp)],
      owner,
    );
    const desired = buildFactBase(
      [
        ...common,
        f(
          viewV,
          { def: " SELECT 10 AS a, 20 AS b;", reloptions: null },
          schemaApp,
        ),
      ],
      owner,
    );
    const list = sqls(plan(source, desired));
    expectAfter(
      list,
      `CREATE VIEW "app"."v" AS SELECT 10 AS a, 20 AS b;`,
      OBJ_REVOKE_V,
    );
    expectAfter(list, OBJ_REVOKE_V, COL_GRANT_V);
  });

  test("no column grants: an object-level privilege change stays a bare REVOKE + GRANT", () => {
    const source = buildFactBase(
      [...base, grant(tableT, "r", ["SELECT"], tableT)],
      [],
    );
    const desired = buildFactBase(
      [...base, grant(tableT, "r", ["INSERT", "SELECT"], tableT)],
      [],
    );
    expect(sqls(plan(source, desired))).toEqual([
      OBJ_REVOKE_T,
      `GRANT INSERT, SELECT ON TABLE "app"."t" TO "r"`,
    ]);
  });
});
