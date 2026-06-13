import { describe, test } from "bun:test";
import { discoverSupabaseProjectFixtures } from "./supabase-project-fixture.ts";
import { runSupabaseProjectProgressiveSmoke } from "./supabase-project-runners.ts";

const fixtures = await discoverSupabaseProjectFixtures();

for (const fixture of fixtures) {
  describe(`${fixture.displayName} progressive smoke (pg${fixture.supabasePostgresVersion})`, () => {
    test(
      "each migration prefix plans and applies cleanly against the fully migrated target",
      async () => {
        await runSupabaseProjectProgressiveSmoke(fixture);
      },
      30 * 60 * 1000,
    );
  });
}
