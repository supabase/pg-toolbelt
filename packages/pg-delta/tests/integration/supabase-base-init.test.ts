import { describe, expect, test } from "bun:test";
import { SUPABASE_POSTGRES_VERSIONS } from "../constants.ts";
import { withDbSupabaseIsolated } from "../utils.ts";

for (const pgVersion of SUPABASE_POSTGRES_VERSIONS) {
  describe(`supabase base init baseline (pg${pgVersion})`, () => {
    test(
      "replays the full-stack base init before test code runs",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        // `storage.buckets` does not exist on the raw image alone. This is a
        // cheap end-to-end smoke test that proves the generated base-init SQL
        // ran before the test body and exposed service-managed Supabase tables.
        await db.main.query(`
          INSERT INTO storage.buckets (id, name)
          VALUES ('avatars', 'avatars');
        `);

        const result = await db.main.query(`
          SELECT id, name
          FROM storage.buckets
          WHERE id = 'avatars';
        `);

        expect(result.rows).toMatchInlineSnapshot(`
          [
            {
              "id": "avatars",
              "name": "avatars",
            },
          ]
        `);
      }),
      120_000,
    );
  });
}
