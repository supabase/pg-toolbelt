import { describe, test } from "bun:test";
import { discoverSupabaseProjectFixtures } from "./supabase-project-fixture.ts";
import { runSupabaseProjectAdjacentSmoke } from "./supabase-project-runners.ts";

const fixtures = await discoverSupabaseProjectFixtures();

for (const fixture of fixtures) {
  describe(
    `${fixture.displayName} adjacent smoke (pg${fixture.supabasePostgresVersion})`,
    () => {
      test(
        "each individual migration step plans and applies cleanly against the next prefix",
        async () => {
          await runSupabaseProjectAdjacentSmoke(fixture);
        },
        30 * 60 * 1000,
      );
    },
  );
}
