import { describe, expect, test } from "vitest";
import { renderScript } from "./fixtures.ts";

function extractSections(script: string, labels: string[]): string {
  const blocks = script.split(/\n\n(?=-- )/);
  const byLabel = new Map<string, string>();

  for (const block of blocks) {
    if (!block.startsWith("-- ")) continue;
    const firstNewline = block.indexOf("\n");
    const label = block.slice(3, firstNewline === -1 ? block.length : firstNewline).trim();
    byLabel.set(label, block);
  }

  return labels
    .map((label) => byLabel.get(label))
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

describe("sql formatting snapshots", () => {
  test("format-off", () => {
    const focused = extractSections(renderScript(undefined), [
      "schema.create",
      "collation.create",
      "rule.create",
      "function.create",
      "role.alter.set_options",
    ]);
    const output = ["-- format: off", focused].join("\n");

    expect(output).toMatchInlineSnapshot(`
      "-- format: off
      -- schema.create
      CREATE SCHEMA application_schema_with_very_long_name_for_wrapping_tests AUTHORIZATION admin;

      -- collation.create
      CREATE COLLATION public.test (LOCALE = 'en_US', LC_COLLATE = 'en_US', LC_CTYPE = 'en_US', PROVIDER = icu, DETERMINISTIC = false, RULES = '& A < a <<< à', VERSION = '1.0');

      -- rule.create
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;

      -- function.create
      CREATE FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name("p_schema_name_for_analytics" text, "p_table_name_for_metrics" text, "p_limit_count_default" integer DEFAULT 100) RETURNS TABLE(total bigint, average numeric) LANGUAGE plpgsql STABLE SECURITY DEFINER PARALLEL SAFE COST 100 ROWS 10 STRICT SET search_path TO 'pg_catalog', 'public' AS $function$ BEGIN RETURN QUERY SELECT count(*)::bigint, avg(value)::numeric FROM generate_series(1, p_limit_count_default); END; $function$;

      -- role.alter.set_options
      ALTER ROLE app_user WITH NOSUPERUSER CREATEDB;"
    `);
  });
});
