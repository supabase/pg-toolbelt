/**
 * Verifies that `buildPostgresTestImage` short-circuits when the
 * `pg-delta-test:<major>` image is already present in the local daemon.
 *
 * The short-circuit is what lets CI prebuild the image once on GHCR
 * (see `pg-delta-build-test-images` in `.github/workflows/tests.yml`)
 * and have every integration shard skip the rebuild — without this
 * test, a regression of the short-circuit would silently send all 45
 * shards back to building locally and CI would just get slower.
 */

import { describe, expect, test } from "bun:test";
import { POSTGRES_VERSIONS } from "./constants.ts";
import {
  buildPostgresTestImage,
  getBuildInvocationCount,
} from "./postgres-alpine.ts";

const [version] = POSTGRES_VERSIONS;
if (version === undefined) {
  throw new Error(
    "POSTGRES_VERSIONS is empty — cannot run postgres-alpine.test.ts",
  );
}

describe(`buildPostgresTestImage (pg${version})`, () => {
  test("returns the same tag and skips the docker build on a second call", async () => {
    // Global setup has already invoked buildPostgresTestImage for every
    // version in POSTGRES_VERSIONS, so the image is guaranteed to exist
    // by the time this test runs.
    const before = getBuildInvocationCount();

    const tag = await buildPostgresTestImage(version);
    expect(tag).toBe(`pg-delta-test:${version}`);

    const after = getBuildInvocationCount();
    expect(after).toBe(before);
  });
});
