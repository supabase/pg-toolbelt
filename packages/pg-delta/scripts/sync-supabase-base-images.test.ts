import { describe, expect, test } from "bun:test";
import {
  buildPgdeltaPlanCommand,
  ensureSupabaseDbMajorVersion,
  getSupabaseBaseInitFixtureRelativePath,
} from "./sync-supabase-base-images.ts";

describe("ensureSupabaseDbMajorVersion", () => {
  test("updates the db major version in an existing db section", () => {
    const config = `
[api]
enabled = true

[db]
port = 54322
major_version = 15
shadow_port = 54320

[studio]
enabled = true
`.trim();

    expect(ensureSupabaseDbMajorVersion(config, 17)).toMatchInlineSnapshot(`
      "[api]
      enabled = true

      [db]
      port = 54322
      major_version = 17
      shadow_port = 54320

      [studio]
      enabled = true"
    `);
  });

  test("adds the db major version when the db section does not declare one", () => {
    const config = `
[db]
port = 54322
shadow_port = 54320

[studio]
enabled = true
`.trim();

    expect(ensureSupabaseDbMajorVersion(config, 15)).toMatchInlineSnapshot(`
      "[db]
      major_version = 15
      port = 54322
      shadow_port = 54320

      [studio]
      enabled = true"
    `);
  });
});

describe("buildPgdeltaPlanCommand", () => {
  test("builds a sql plan command with formatting and output", () => {
    expect(
      buildPgdeltaPlanCommand({
        source: "postgres://source",
        target: "postgres://target",
        output:
          "tests/integration/fixtures/supabase-base-init/17_fullstack_container_init.sql",
        sqlFormat: true,
      }),
    ).toMatchInlineSnapshot(`
      [
        "bun",
        "run",
        "pgdelta",
        "plan",
        "--source",
        "postgres://source",
        "--target",
        "postgres://target",
        "--output",
        "tests/integration/fixtures/supabase-base-init/17_fullstack_container_init.sql",
        "--sql-format",
      ]
    `);
  });

  test("builds a validation command without an output file", () => {
    expect(
      buildPgdeltaPlanCommand({
        source: "postgres://validated",
        target: "postgres://fullstack",
        format: "sql",
        sqlFormat: true,
      }),
    ).toMatchInlineSnapshot(`
      [
        "bun",
        "run",
        "pgdelta",
        "plan",
        "--source",
        "postgres://validated",
        "--target",
        "postgres://fullstack",
        "--format",
        "sql",
        "--sql-format",
      ]
    `);
  });
});

describe("getSupabaseBaseInitFixtureRelativePath", () => {
  test("stores generated fixtures in the dedicated versioned directory", () => {
    expect(getSupabaseBaseInitFixtureRelativePath(17)).toBe(
      "tests/integration/fixtures/supabase-base-init/17_fullstack_container_init.sql",
    );
  });
});
