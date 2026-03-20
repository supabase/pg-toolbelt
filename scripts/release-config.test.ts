import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = import.meta.dir.endsWith("/scripts")
  ? join(import.meta.dir, "..")
  : import.meta.dir;

test("@supabase/bun-istanbul-coverage stays private and out of prerelease publish tracking", () => {
  const packageJson = JSON.parse(
    readFileSync(
      join(repoRoot, "packages/bun-istanbul-coverage/package.json"),
      "utf8",
    ),
  );
  const changesetConfig = JSON.parse(
    readFileSync(join(repoRoot, ".changeset/config.json"), "utf8"),
  );
  const prereleaseConfig = JSON.parse(
    readFileSync(join(repoRoot, ".changeset/pre.json"), "utf8"),
  );

  expect(packageJson.private).toBe(true);
  expect(changesetConfig.ignore).not.toContain(
    "@supabase/bun-istanbul-coverage",
  );
  expect(prereleaseConfig.initialVersions).not.toHaveProperty(
    "@supabase/bun-istanbul-coverage",
  );
});
