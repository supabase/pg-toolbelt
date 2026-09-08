/**
 * Round-trip budget regression: extraction should probe the server's version
 * ONCE per run, not once per family that happens to need a version gate.
 *
 * Before the fix, `SHOW server_version` (extract.ts) and four independent
 * `current_setting('server_version_num')` probes (types.ts, publications.ts
 * x2, unmodeled.ts) each cost their own sequential round trip inside the same
 * REPEATABLE READ transaction — see `ExtractContext.serverVersion` /
 * `.serverVersionNum` / `.pgMajor` in scope.ts for the combined replacement.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import {
  createTestDb,
  withServerVersionProbeCount,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("extract() server-version probe count", () => {
  test("probes server_version exactly once per extraction", async () => {
    const db = await createTestDb("extract_roundtrips");
    dbs.push(db);

    const { count } = await withServerVersionProbeCount(db.pool, () =>
      extract(db.pool),
    );

    expect(count).toBe(1);
  }, 120_000);
});
