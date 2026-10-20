/**
 * Pure guards for declarative schema files (empty/comment-only refusal,
 * database-scope cluster-DDL preflight, manifest reconciliation).
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import {
  planSchemaFiles,
  type PrepareSchemaFilesOptions,
  prepareSchemaFiles,
  reconcileSchemaManifest,
  SchemaFrontendError,
} from "./schema-plan.ts";
import type { ExportManifest } from "./export-manifest.ts";
import type { SqlFile } from "./load-sql-files.ts";
import { rawProfile } from "../integrations/profile.ts";
import { flattenPolicy } from "../policy/policy.ts";
import { supabasePolicy } from "../policy/supabase.ts";

function files(entries: Record<string, string>): SqlFile[] {
  return Object.entries(entries).map(([name, sql]) => ({ name, sql }));
}

describe("prepareSchemaFiles", () => {
  test("refuses empty / comment-only input (would drop-all)", () => {
    const r = prepareSchemaFiles(files({ "c.sql": "-- just a comment\n" }), {
      scope: "database",
      skipClusterDdl: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("no executable SQL found");
  });

  test("refuses cluster DDL in database scope without skipClusterDdl", () => {
    const r = prepareSchemaFiles(
      files({
        "roles.sql": "CREATE ROLE app;\n",
        "t.sql": "CREATE TABLE public.t (id int);\n",
      }),
      { scope: "database", skipClusterDdl: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("cluster DDL");
  });

  test("refuses an all-cluster-DDL dir after skipClusterDdl", () => {
    const r = prepareSchemaFiles(
      files({ "roles.sql": "CREATE ROLE app;\nALTER ROLE app WITH LOGIN;\n" }),
      { scope: "database", skipClusterDdl: true },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("no executable database-scope SQL remains");
    }
  });

  test("keeps non-cluster SQL when skipClusterDdl leaves real statements", () => {
    const r = prepareSchemaFiles(
      files({
        "1.sql": "CREATE ROLE app;\nCREATE TABLE public.t (id int);\n",
      }),
      { scope: "database", skipClusterDdl: true },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skipped.length).toBeGreaterThan(0);
      expect(r.files.map((f) => f.sql).join("")).toContain("CREATE TABLE");
    }
  });

  test("managed role settings: ALTER ROLE passes the static guard only for an isolated shadow (#476)", () => {
    const set = `ALTER ROLE "authenticator" SET "pgrst.db_schemas" = 'api';\n`;
    const prep = (
      sql: string,
      options: Partial<PrepareSchemaFilesOptions> = {},
    ) =>
      prepareSchemaFiles(
        files({ "t.sql": "CREATE TABLE public.t (id int);\n", "r.sql": sql }),
        {
          scope: "database",
          managedRoleSettings:
            flattenPolicy(supabasePolicy).managedRoleSettings,
          isolatedShadow: true,
          ...options,
        },
      );
    const message = (r: ReturnType<typeof prep>) => (r.ok ? "" : r.message);
    const skipped = (r: ReturnType<typeof prep>) =>
      r.ok ? r.skipped.map((s) => s.stmt) : r.message;

    expect(prep(set).ok).toBe(true);
    for (const stmt of [
      "CREATE ROLE app;",
      "DROP ROLE app;",
      "GRANT anon TO authenticator;",
      "COMMENT ON ROLE anon IS 'x';",
    ]) {
      expect({ stmt, ok: prep(stmt).ok }).toEqual({ stmt, ok: false });
    }
    // skipClusterDdl skips every ALTER ROLE, except in the export's own
    // role-settings file
    const timeout = `ALTER ROLE anon SET statement_timeout = '5s';\n`;
    expect(
      skipped(
        prep(`${set}${timeout}CREATE ROLE app;\n`, { skipClusterDdl: true }),
      ),
    ).toEqual([
      `ALTER ROLE "authenticator" SET "pgrst.db_schemas" = 'api'`,
      "ALTER ROLE anon SET statement_timeout = '5s'",
      "CREATE ROLE app",
    ]);
    expect(
      skipped(
        prep(`${set}CREATE ROLE app;\n`, {
          skipClusterDdl: true,
          roleSettingsFiles: ["r.sql"],
        }),
      ),
    ).toEqual(["CREATE ROLE app"]);
    expect(message(prep(set, { isolatedShadow: false }))).toContain(
      "r.sql: ALTER ROLE\nUse scope cluster (with an isolated shadow) to manage roles, or skipClusterDdl to skip these statements.\n" +
        "The profile manages role settings (ALTER ROLE … SET) in database scope only against an isolated shadow.",
    );
    // without an isolated shadow the export's role-settings file is dropped
    const dropped = prep(set, {
      isolatedShadow: false,
      roleSettingsFiles: ["r.sql"],
    });
    expect(
      dropped.ok && {
        files: dropped.files.map((f) => f.name),
        warnings: dropped.warnings,
      },
    ).toEqual({
      files: ["t.sql"],
      warnings: [
        "skipped r.sql: it holds the export's role settings (ALTER ROLE … SET), which database scope manages only against an isolated shadow.",
      ],
    });
    // the raw profile manages none: refused with no hint
    const raw = message(prep(set, { managedRoleSettings: [] }));
    expect(raw).toContain("r.sql: ALTER ROLE");
    expect(raw).not.toContain("role settings");
  });

  test("accepts a normal database-scope dir", () => {
    expect(
      prepareSchemaFiles(
        files({ "t.sql": "CREATE TABLE public.t (id int);\n" }),
        {
          scope: "database",
          skipClusterDdl: false,
        },
      ).ok,
    ).toBe(true);
  });
});

describe("reconcileSchemaManifest", () => {
  test("rejects profile / scope / redaction / baseline / default-owner mismatches", () => {
    const manifest: ExportManifest = {
      profile: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
      defaultOwner: "postgres",
    };

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "raw",
        scope: "database",
        redactSecrets: true,
        baselineDigest: "aaaa",
      }),
    ).toThrow(SchemaFrontendError);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "cluster",
        redactSecrets: true,
        baselineDigest: "aaaa",
      }),
    ).toThrow(/scope/);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "database",
        redactSecrets: false,
        baselineDigest: "aaaa",
      }),
    ).toThrow(/redact/);

    expect(() =>
      reconcileSchemaManifest(manifest, {
        profileId: "supabase",
        scope: "database",
        redactSecrets: true,
        baselineDigest: "bbbb",
      }),
    ).toThrow(/baseline/);

    // Matching values succeed and return the reconciled options.
    const ok = reconcileSchemaManifest(manifest, {
      profileId: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
    });
    expect(ok).toMatchObject({
      profileId: "supabase",
      scope: "database",
      redactSecrets: true,
      baselineDigest: "aaaa",
      defaultOwner: "postgres",
    });
  });

  test("defaults scope/profile/redaction from the manifest when flags are omitted", () => {
    const ok = reconcileSchemaManifest(
      {
        profile: "supabase",
        scope: "cluster",
        redactSecrets: false,
        baselineDigest: "digest1",
      },
      {},
    );
    expect(ok.profileId).toBe("supabase");
    expect(ok.scope).toBe("cluster");
    expect(ok.redactSecrets).toBe(false);
    expect(ok.baselineDigest).toBe("digest1");
  });
});

describe("planSchemaFiles identity preflight", () => {
  test("reports target identity permission failures before querying the shadow", async () => {
    let shadowQueries = 0;
    const target = {
      query: async () => {
        throw Object.assign(new Error("permission denied"), { code: "42501" });
      },
    } as unknown as Pool;
    const shadow = {
      query: async () => {
        shadowQueries += 1;
        throw new Error("shadow must not be queried");
      },
    } as unknown as Pool;

    expect(
      planSchemaFiles(
        target,
        shadow,
        [{ name: "schema.sql", sql: "CREATE SCHEMA identity_probe;" }],
        { profile: rawProfile, scope: "database" },
      ),
    ).rejects.toThrow(
      /planSchemaFiles target safety.*GRANT EXECUTE ON FUNCTION pg_catalog\.pg_control_system\(\)/i,
    );
    expect(shadowQueries).toBe(0);
  });
});
