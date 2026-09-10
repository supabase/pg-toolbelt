/**
 * Built-in (pg_*) ownership vs an implicit applier/defaultOwner.
 *
 * PG15+ `public` is owned by `pg_database_owner`, which is never a role fact.
 * When the desired owner is the policy's defaultOwner (edge dropped so we do
 * not spam OWNER TO on every create), the diff is unlink-only — and must still
 * emit ALTER … OWNER TO <defaultOwner>. No Docker.
 */
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  retainOwnerRoleDangling,
  type Fact,
} from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import type { Policy } from "../policy/policy.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const postgres: StableId = { kind: "role", name: "postgres" };
const pgDatabaseOwner: StableId = { kind: "role", name: "pg_database_owner" };

const implicitApplierPolicy: Policy = {
  id: "implicit-applier",
  defaultOwner: "postgres",
  assumedRoles: ["postgres"],
  filter: [
    {
      match: { all: [{ kind: "role" }, { name: "postgres" }] },
      action: "exclude",
    },
  ],
};

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

describe("plan() — built-in owner unlink to implicit defaultOwner", () => {
  test("pg_database_owner → implicit postgres emits ALTER SCHEMA OWNER TO postgres before REVOKE", () => {
    const ownerAcl: StableId = {
      kind: "acl",
      target: publicSchema,
      grantee: "pg_database_owner",
    };
    const source = buildFactBase(
      [
        f(publicSchema),
        {
          id: ownerAcl,
          parent: publicSchema,
          payload: { privileges: ["CREATE", "USAGE"], grantable: [] },
        },
      ],
      [{ from: publicSchema, to: pgDatabaseOwner, kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    // Desired ownership is already implicit (no postgres role, no owner edge) —
    // the E1 projected shape. A leftover link-to-postgres would hide a deleted
    // unlink-only emitter.
    const desired = buildFactBase([f(publicSchema)], []);

    const sqls = plan(source, desired, {
      policy: implicitApplierPolicy,
    }).actions.map((a) => a.sql);
    const ownerIdx = sqls.indexOf(`ALTER SCHEMA "public" OWNER TO "postgres"`);
    const revokeIdx = sqls.findIndex((s) =>
      /REVOKE ALL ON SCHEMA "public" FROM "pg_database_owner"/.test(s),
    );
    expect(ownerIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeGreaterThan(ownerIdx);
  });

  test("sqlFiles desired keeps catalog public owner; plan-time defaultOwner unlinks to implicit postgres", () => {
    const liveEdges = [
      { from: publicSchema, to: pgDatabaseOwner, kind: "owner" as const },
    ];
    const source = buildFactBase(
      [f(publicSchema)],
      liveEdges,
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    // Extract reports catalog truth — the platform default stays on the fact
    // base. Reconstruct drops it for the diff when defaultOwner is set.
    const desired = buildFactBase(
      [f(publicSchema)],
      liveEdges,
      "sqlFiles",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    expect(desired.edges).toEqual(liveEdges);
    const sqls = plan(source, desired, {
      policy: implicitApplierPolicy,
    }).actions.map((a) => a.sql);
    expect(sqls).toContain(`ALTER SCHEMA "public" OWNER TO "postgres"`);
    expect(sqls.join("\n")).not.toContain('OWNER TO "pg_database_owner"');
  });

  test("sqlFiles catalog-default public vs live implicit postgres does not reverse OWNER TO", () => {
    const source = buildFactBase(
      [f(publicSchema), f(postgres, { login: true })],
      [{ from: publicSchema, to: postgres, kind: "owner" }],
    );
    const desired = buildFactBase(
      [f(publicSchema)],
      [{ from: publicSchema, to: pgDatabaseOwner, kind: "owner" }],
      "sqlFiles",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    const sql = plan(source, desired, { policy: implicitApplierPolicy })
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain('OWNER TO "pg_database_owner"');
    expect(sql).not.toContain("OWNER TO");
  });

  test("sqlFiles and live both catalog-default public emit no OWNER TO without defaultOwner", () => {
    const edges = [
      { from: publicSchema, to: pgDatabaseOwner, kind: "owner" as const },
    ];
    const opts = {
      allowDangling: retainOwnerRoleDangling,
    };
    const source = buildFactBase(
      [f(publicSchema)],
      edges,
      "liveDb",
      new Set(),
      opts,
    );
    const desired = buildFactBase(
      [f(publicSchema)],
      edges,
      "sqlFiles",
      new Set(),
      opts,
    );
    const sql = plan(source, desired)
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain("OWNER TO");
  });

  test("both sides implicitly postgres-owned emit no OWNER TO", () => {
    const facts = [f(publicSchema), f(postgres, { login: true })];
    const edges = [
      { from: publicSchema, to: postgres, kind: "owner" as const },
    ];
    const source = buildFactBase(facts, edges);
    const desired = buildFactBase(facts, edges);

    const sql = plan(source, desired, { policy: implicitApplierPolicy })
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain("OWNER TO");
  });

  test("without defaultOwner, unlink-only does not invent an OWNER TO", () => {
    const source = buildFactBase(
      [f(publicSchema)],
      [{ from: publicSchema, to: pgDatabaseOwner, kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    const desired = buildFactBase([f(publicSchema)], []);

    const sql = plan(source, desired)
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain("OWNER TO");
  });

  test("supabase policy does not DROP public when the base lists supabase_admin as nspowner", () => {
    const admin: StableId = { kind: "role", name: "supabase_admin" };
    const source = buildFactBase(
      [f(publicSchema)],
      [{ from: publicSchema, to: pgDatabaseOwner, kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    const desired = buildFactBase(
      [f(publicSchema), f(admin, { superuser: true })],
      [{ from: publicSchema, to: admin, kind: "owner" }],
    );
    const sql = plan(source, desired, { policy: supabasePolicy })
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toContain(`DROP SCHEMA "public"`);
    expect(sql).toContain(`ALTER SCHEMA "public" OWNER TO "postgres"`);
    expect(sql).not.toContain(`OWNER TO "supabase_admin"`);
  });

  test("database-scope unlink reowns to options.defaultOwner", () => {
    const source = buildFactBase(
      [f(publicSchema)],
      [{ from: publicSchema, to: pgDatabaseOwner, kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    const desired = buildFactBase([f(publicSchema)], []);
    const sqls = plan(source, desired, {
      scope: "database",
      defaultOwner: "app_owner",
    }).actions.map((a) => a.sql);
    expect(sqls).toContain(`ALTER SCHEMA "public" OWNER TO "app_owner"`);
  });

  test("accepted rename + unlink-only still OWNER TO defaultOwner", () => {
    const oldT: StableId = { kind: "table", schema: "public", name: "old_t" };
    const newT: StableId = { kind: "table", schema: "public", name: "new_t" };
    const tablePayload = {
      persistence: "p",
      rowSecurity: false,
      forceRowSecurity: false,
      replicaIdentity: "d",
      replicaIdentityIndex: null,
      partitionKey: null,
      partitionBound: null,
      parentTable: null,
    };
    const source = buildFactBase(
      [
        f(publicSchema),
        { id: oldT, parent: publicSchema, payload: tablePayload },
      ],
      [{ from: oldT, to: pgDatabaseOwner, kind: "owner" }],
      "liveDb",
      new Set(),
      { allowDangling: retainOwnerRoleDangling },
    );
    const desired = buildFactBase(
      [
        f(publicSchema),
        { id: newT, parent: publicSchema, payload: tablePayload },
      ],
      [],
    );
    const sqls = plan(source, desired, {
      policy: implicitApplierPolicy,
      renames: "auto",
    }).actions.map((a) => a.sql);
    expect(sqls.some((s) => s.includes("RENAME TO"))).toBe(true);
    expect(sqls).toContain(`ALTER TABLE "public"."new_t" OWNER TO "postgres"`);
  });
});

describe("plan() — OWNER TO vs cascading ACL drop", () => {
  test("replaced object + owner change does not cycle", () => {
    const schema: StableId = { kind: "schema", name: "s" };
    const view: StableId = { kind: "view", schema: "s", name: "v" };
    const oldOwner: StableId = { kind: "role", name: "old_owner" };
    const newOwner: StableId = { kind: "role", name: "new_owner" };
    const oldAcl: StableId = {
      kind: "acl",
      target: view,
      grantee: "old_owner",
    };
    const viewFact = (def: string): Fact => ({
      id: view,
      parent: schema,
      payload: { def, reloptions: null },
    });
    const source = buildFactBase(
      [
        f(schema),
        f(oldOwner, { login: true }),
        viewFact(" SELECT 1;"),
        {
          id: oldAcl,
          parent: view,
          payload: { privileges: ["SELECT"], grantable: [] },
        },
      ],
      [{ from: view, to: oldOwner, kind: "owner" }],
    );
    const desired = buildFactBase(
      [f(schema), f(newOwner, { login: true }), viewFact(" SELECT 2;")],
      [{ from: view, to: newOwner, kind: "owner" }],
    );

    const sqls = plan(source, desired).actions.map((a) => a.sql);
    expect(sqls.some((s) => s.includes("OWNER TO"))).toBe(true);
    expect(sqls.some((s) => s.includes("DROP VIEW"))).toBe(true);
  });
});
