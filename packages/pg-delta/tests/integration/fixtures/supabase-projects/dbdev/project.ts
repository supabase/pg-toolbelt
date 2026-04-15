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
      onApplyError: "skip",
    },
    adjacent: {
      onApplyError: "skip",
    },
  },
});
