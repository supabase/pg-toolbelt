/**
 * `Action.subject` / `Action.change` on the statements where the first
 * element of `produces` / `destroys` / `consumes` named the wrong object:
 * an identity add, a default-privilege cleanup REVOKE and a merged GRANT,
 * next to a rename and an owner change, which say so in `change`.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { sharedCluster } from "./containers.ts";

describe("action subject and change", () => {
  test("name the fact each statement is about", async () => {
    const cluster = await sharedCluster();
    const tag = crypto.randomUUID().slice(0, 8);
    const roles = {
      reader: `subj_reader_${tag}`,
      writer: `subj_writer_${tag}`,
      barred: `subj_barred_${tag}`,
      owner: `subj_owner_${tag}`,
    };
    for (const role of Object.values(roles)) {
      await cluster.adminPool.query(`CREATE ROLE "${role}" NOLOGIN`);
    }
    const source = await cluster.createDb("subj_src");
    const desired = await cluster.createDb("subj_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id int PRIMARY KEY, n int NOT NULL);
        CREATE SCHEMA plain;
        CREATE TABLE plain.old_name (id int);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA app
          GRANT SELECT ON TABLES TO "${roles.barred}";
        CREATE TABLE app.t (
          id int PRIMARY KEY,
          n int NOT NULL GENERATED ALWAYS AS IDENTITY
        );
        ALTER TABLE app.t OWNER TO "${roles.owner}";
        ALTER TABLE app.t ENABLE ROW LEVEL SECURITY;
        CREATE SCHEMA plain;
        CREATE TABLE plain.new_name (id int);
        CREATE TABLE app.fresh (id int);
        REVOKE ALL ON app.fresh FROM "${roles.barred}";
        GRANT SELECT ON app.fresh TO "${roles.reader}", "${roles.writer}";
      `);
      const thePlan = plan(
        (await extract(source.pool)).factBase,
        (await extract(desired.pool)).factBase,
        {
          renames: "auto",
          capability: await probeApplierCapability(source.pool),
        },
      );
      const anonymize = (text: string): string =>
        Object.entries(roles).reduce(
          (out, [label, role]) => out.replaceAll(role, label),
          text,
        );
      const rows = thePlan.actions
        // The owners' own grants list every table privilege, which differs
        // per PostgreSQL version: keep the grants this test set up.
        .filter(
          (a) =>
            a.subject.kind !== "acl" ||
            [roles.reader, roles.writer, roles.barred].includes(
              a.subject.grantee,
            ),
        )
        .filter((a) => a.subject.kind !== "defaultPrivilege")
        .map((a) =>
          anonymize(
            [
              a.verb,
              encodeId(a.subject),
              a.change === undefined ? "-" : JSON.stringify(a.change),
              `lock=${a.lockClass}`,
              a.sql,
            ].join(" | "),
          ),
        );
      expect(rows).toMatchInlineSnapshot(`
        [
          "alter | column:app.t.n | {"kind":"attribute","name":"identity"} | lock=accessExclusive | ALTER TABLE "app"."t" ALTER COLUMN "n" ADD GENERATED ALWAYS AS IDENTITY",
          "create | table:app.fresh | - | lock=none | CREATE TABLE "app"."fresh" ("id" integer)",
          "alter | acl:(table:app.fresh).barred | {"kind":"defaultPrivileges"} | lock=none | REVOKE ALL ON TABLE "app"."fresh" FROM "barred"",
          "alter | table:app.t | {"kind":"attribute","name":"rowSecurity"} | lock=accessExclusive | ALTER TABLE "app"."t" ENABLE ROW LEVEL SECURITY",
          "alter | table:app.t | {"kind":"owner","to":"owner"} | lock=accessExclusive | ALTER TABLE "app"."t" OWNER TO "owner"",
          "alter | table:plain.new_name | {"kind":"rename","from":{"kind":"table","schema":"plain","name":"old_name"}} | lock=accessExclusive | ALTER TABLE "plain"."old_name" RENAME TO "new_name"",
          "create | acl:(table:app.fresh).reader | - | lock=none | GRANT SELECT ON TABLE "app"."fresh" TO "reader", "writer"",
          "create | acl:(table:app.t).barred | - | lock=none | REVOKE ALL ON TABLE "app"."t" FROM "barred"",
          "create | acl:(table:app.t).barred | - | lock=none | GRANT SELECT ON TABLE "app"."t" TO "barred"",
        ]
      `);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
      for (const role of Object.values(roles)) {
        await cluster.adminPool
          .query(`DROP ROLE IF EXISTS "${role}"`)
          .catch(() => {});
      }
    }
  }, 120_000);

  // A member that can SET ROLE to the new owner but does not inherit it stops
  // owning the table at OWNER TO, so the identity it adds must come first.
  test("an identity add runs before the table's OWNER TO", async () => {
    const cluster = await sharedCluster();
    if ((await cluster.pgMajor()) < 16) return; // INHERIT FALSE is PG16+
    const tag = crypto.randomUUID().slice(0, 8);
    const applier = `ident_applier_${tag}`;
    const owner = `ident_owner_${tag}`;
    await cluster.adminPool.query(`
      CREATE ROLE "${applier}" LOGIN PASSWORD 'pw' NOSUPERUSER;
      CREATE ROLE "${owner}" NOLOGIN;
      GRANT "${owner}" TO "${applier}" WITH INHERIT FALSE, SET TRUE;
    `);
    const source = await cluster.createDb("ident_src");
    const desired = await cluster.createDb("ident_dst");
    const url = new URL(source.uri);
    url.username = applier;
    url.password = "pw";
    const applierPool = new pg.Pool({ connectionString: url.toString() });
    try {
      await cluster.adminPool.query(
        `GRANT CONNECT, CREATE ON DATABASE "${source.name}" TO "${applier}"`,
      );
      await applierPool.query(`
        CREATE SCHEMA app;
        GRANT CREATE ON SCHEMA app TO "${owner}";
        CREATE TABLE app.t (id int PRIMARY KEY, n int NOT NULL);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app AUTHORIZATION "${applier}";
        GRANT CREATE ON SCHEMA app TO "${owner}";
        CREATE TABLE app.t (
          id int PRIMARY KEY,
          n int NOT NULL GENERATED ALWAYS AS IDENTITY
        );
        ALTER TABLE app.t OWNER TO "${owner}";
      `);
      const thePlan = plan(
        (await extract(source.pool)).factBase,
        (await extract(desired.pool)).factBase,
        {
          capability: await probeApplierCapability(applierPool),
          policy: {
            id: "no-grants",
            filter: [{ match: { kind: "acl" }, action: "exclude" }],
          },
        },
      );
      const report = await apply(thePlan, applierPool);
      expect({ status: report.status, sql: report.error?.sql }).toEqual({
        status: "applied",
        sql: undefined,
      });
    } finally {
      await applierPool.end();
      await Promise.all([source.drop(), desired.drop()]);
      await cluster.adminPool.query(
        `DROP ROLE IF EXISTS "${applier}"; DROP ROLE IF EXISTS "${owner}"`,
      );
    }
  }, 120_000);
});
