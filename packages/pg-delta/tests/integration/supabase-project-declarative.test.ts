import { describe, test } from "bun:test";
import { discoverSupabaseProjectFixtures } from "./supabase-project-fixture.ts";
import { runSupabaseProjectDeclarativeRoundtrip } from "./supabase-project-runners.ts";

const fixtures = await discoverSupabaseProjectFixtures();

for (const fixture of fixtures) {
  describe(
    `${fixture.displayName} declarative roundtrip (pg${fixture.supabasePostgresVersion})`,
    () => {
      test(
        "exported schema roundtrips to 0 remaining changes with supabase integration",
        async () => {
          await runSupabaseProjectDeclarativeRoundtrip(fixture);
        },
        5 * 60 * 1000,
      );
    },
  );
}
