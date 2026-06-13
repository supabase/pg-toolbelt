import { supabase } from "../../../../../src/core/integrations/supabase.ts";
import { defineSupabaseProjectFixture } from "../../../supabase-project-fixture.ts";

export default defineSupabaseProjectFixture({
  id: "dbdev",
  displayName: "dbdev",
  supabasePostgresVersion: 15,
  integration: supabase,
  migrationsDir: new URL("./migrations/", import.meta.url),
  setRole: "postgres",
  skipDefaultPrivilegeSubtraction: true,
  candidateRegressionNote:
    "Reduce the failing prefix to the smallest migration slice that reproduces the issue, then turn the generated SQL or remaining diff into a focused pg-delta integration test.",
  scenarios: {
    declarative: {
      include: (filename) => filename.startsWith("20220117"),
      onApplyError: "fail",
    },
    progressive: {
      // The runner compares stepping main against a *fully* migrated branch. With
      // the full history, the plan is a "catch up" to head that cannot be
      // applied as one plan (statements like ADD COLUMN without migration-time
      // DEFAULT/backfill from later files). Scope to the same prefix as
      // declarative so the target branch and incremental main can converge.
      include: (filename) => filename.startsWith("20220117"),
      onApplyError: "skip",
    },
    adjacent: {
      onApplyError: "skip",
      // Migration uses DEFAULT + UPDATE + DROP DEFAULT; the final column has no
      // default, so plan/apply from catalog diff cannot replay on non-empty tables.
      skipAdjacentPlanApply: (filename) =>
        filename === "20231205051816_add_default_version.sql",
    },
  },
});
