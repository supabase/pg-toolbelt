/**
 * Overlay assumedDefaultGrants: REVOKE injectees the desired ACL does not keep.
 * No Docker — hand-built fact bases.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import type { AssumedDefaultGrant } from "../policy/policy.ts";
import { plan } from "./plan.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const fnId: StableId = {
  kind: "function",
  schema: "public",
  name: "get_account",
  args: [],
};
const tableId: StableId = { kind: "table", schema: "public", name: "t" };

const overlayFn: AssumedDefaultGrant[] = (
  ["anon", "authenticated", "service_role"] as const
).map((grantee) => ({
  creatingRole: "postgres",
  schema: "public",
  objtype: "f",
  grantee,
}));

const overlayTable: AssumedDefaultGrant[] = (
  ["anon", "authenticated", "service_role"] as const
).map((grantee) => ({
  creatingRole: "postgres",
  schema: "public",
  objtype: "r",
  grantee,
}));

const assumedRoles = ["anon", "authenticated", "postgres", "service_role"];

const schemaFact: Fact = { id: schemaPublic, payload: {} };

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

const tableOwnerDefault = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

function acl(
  target: StableId,
  grantee: string,
  privileges: string[],
  ownerDefault?: string[],
): Fact {
  return {
    id: { kind: "acl", target, grantee },
    parent: target,
    payload: {
      privileges,
      grantable: [],
      ...(ownerDefault !== undefined ? { _ownerDefault: ownerDefault } : {}),
    },
  };
}

const fnFact: Fact = {
  id: fnId,
  parent: schemaPublic,
  payload: {
    def: `CREATE FUNCTION "public"."get_account"() RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT 1$$`,
  },
};

const source = buildFactBase([schemaFact], []);

describe("assumedDefaultGrants overlay", () => {
  test("absent overlay grantee gets a REVOKE ALL, merged with PUBLIC", () => {
    const desired = buildFactBase(
      [
        schemaFact,
        fnFact,
        acl(fnId, "PUBLIC", []),
        acl(fnId, "authenticated", ["EXECUTE"]),
        acl(fnId, "postgres", ["EXECUTE"], ["EXECUTE"]),
        acl(fnId, "service_role", ["EXECUTE"]),
      ],
      [{ from: fnId, to: { kind: "role", name: "postgres" }, kind: "owner" }],
    );
    const p = plan(source, desired, {
      assumedRoles,
      assumedDefaultGrants: overlayFn,
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION "public"."get_account"() FROM PUBLIC, "anon"`,
    );
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION "public"."get_account"() TO "authenticated", "postgres", "service_role"`,
    );
    expect(sql).not.toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_account"\(\) FROM "authenticated"/,
    );
    expect(sql).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon"`,
    );
  });

  test("without overlay, absence of anon is not a revoke", () => {
    const desired = buildFactBase(
      [
        schemaFact,
        fnFact,
        acl(fnId, "PUBLIC", []),
        acl(fnId, "authenticated", ["EXECUTE"]),
        acl(fnId, "postgres", ["EXECUTE"], ["EXECUTE"]),
        acl(fnId, "service_role", ["EXECUTE"]),
      ],
      [{ from: fnId, to: { kind: "role", name: "postgres" }, kind: "owner" }],
    );
    const p = plan(source, desired, { assumedRoles });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).not.toContain(`FROM "anon"`);
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION "public"."get_account"() FROM PUBLIC`,
    );
  });

  test("SELECT-only holder keeps wipe-then-grant; absent overlay grantee is revoked", () => {
    const desired = buildFactBase(
      [
        schemaFact,
        {
          id: tableId,
          parent: schemaPublic,
          payload: tablePayload(),
        },
        acl(tableId, "authenticated", ["SELECT"]),
        acl(tableId, "postgres", tableOwnerDefault, tableOwnerDefault),
      ],
      [
        {
          from: tableId,
          to: { kind: "role", name: "postgres" },
          kind: "owner",
        },
      ],
    );
    const p = plan(source, desired, {
      assumedRoles,
      assumedDefaultGrants: overlayTable,
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE "public"\."t" FROM "authenticated"/,
    );
    expect(sql).toContain(
      `GRANT SELECT ON TABLE "public"."t" TO "authenticated"`,
    );
    expect(sql).toMatch(/REVOKE ALL ON TABLE "public"\."t" FROM .*"anon"/);
  });

  test("full-set overlay holders still GRANT DML; ADP is wipe-then-grant", () => {
    const dml = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    const dp = (grantee: string): Fact => ({
      id: {
        kind: "defaultPrivilege",
        role: "postgres",
        schema: "public",
        objtype: "r",
        grantee,
      },
      payload: { privileges: dml, grantable: [] },
    });
    const desired = buildFactBase(
      [
        schemaFact,
        {
          id: tableId,
          parent: schemaPublic,
          payload: tablePayload(),
        },
        dp("anon"),
        dp("authenticated"),
        dp("service_role"),
        acl(tableId, "anon", dml),
        acl(tableId, "authenticated", dml),
        acl(tableId, "service_role", dml),
      ],
      [
        {
          from: tableId,
          to: { kind: "role", name: "postgres" },
          kind: "owner",
        },
      ],
    );
    const p = plan(source, desired, {
      assumedRoles,
      assumedDefaultGrants: overlayTable,
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon"`,
    );
    expect(sql).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "anon"`,
    );
    expect(sql).toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."t" TO "anon"`,
    );
  });

  test("subset desired ADP still wipes then GRANTs", () => {
    const dpSelect: Fact = {
      id: {
        kind: "defaultPrivilege",
        role: "postgres",
        schema: "public",
        objtype: "r",
        grantee: "anon",
      },
      payload: { privileges: ["SELECT"], grantable: [] },
    };
    const desired = buildFactBase(
      [
        schemaFact,
        {
          id: tableId,
          parent: schemaPublic,
          payload: tablePayload(),
        },
        dpSelect,
        acl(tableId, "anon", ["SELECT"]),
        acl(tableId, "postgres", tableOwnerDefault, tableOwnerDefault),
      ],
      [
        {
          from: tableId,
          to: { kind: "role", name: "postgres" },
          kind: "owner",
        },
      ],
    );
    const p = plan(source, desired, {
      assumedRoles,
      assumedDefaultGrants: overlayTable,
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon"`,
    );
    expect(sql).toContain(
      `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "anon"`,
    );
    expect(sql).toMatch(/REVOKE ALL ON TABLE "public"\."t" FROM "anon"/);
    expect(sql).toContain(`GRANT SELECT ON TABLE "public"."t" TO "anon"`);
  });

  const policyOverlayDesired = buildFactBase(
    [
      schemaFact,
      fnFact,
      acl(fnId, "PUBLIC", []),
      acl(fnId, "authenticated", ["EXECUTE"]),
      acl(fnId, "postgres", ["EXECUTE"], ["EXECUTE"]),
      acl(fnId, "service_role", ["EXECUTE"]),
    ],
    [{ from: fnId, to: { kind: "role", name: "postgres" }, kind: "owner" }],
  );

  test("policy overlay does not REVOKE overlay roles absent from the source extract", () => {
    const p = plan(source, policyOverlayDesired, {
      assumedRoles,
      policy: { id: "overlay-policy", assumedDefaultGrants: overlayFn },
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).not.toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_account"\(\) FROM .*"anon"/,
    );
    expect(sql).not.toContain("ALTER DEFAULT PRIVILEGES");
  });

  test("policy overlay REVOKEs overlay roles present in the source extract; ADP wipes stay options-only", () => {
    const dest = buildFactBase(
      [
        schemaFact,
        { id: { kind: "role", name: "anon" }, payload: {} },
        { id: { kind: "role", name: "authenticated" }, payload: {} },
        { id: { kind: "role", name: "service_role" }, payload: {} },
        { id: { kind: "role", name: "postgres" }, payload: {} },
      ],
      [],
    );
    // Database scope drops role facts from the resolved view; overlay
    // hygiene must still see them on the raw extract.
    const p = plan(dest, policyOverlayDesired, {
      assumedRoles,
      scope: "database",
      policy: { id: "overlay-policy", assumedDefaultGrants: overlayFn },
    });
    const sql = p.actions.map((a) => a.sql).join("\n");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_account"\(\) FROM .*"anon"/,
    );
    expect(sql).not.toContain("ALTER DEFAULT PRIVILEGES");
  });
});
