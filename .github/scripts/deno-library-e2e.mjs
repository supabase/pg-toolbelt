import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PUBLISH_FACING_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

const repoRoot = resolve(import.meta.dirname, "..", "..");
const tempDir = mkdtempSync(join(tmpdir(), "pg-toolbelt-deno-e2e-"));

function run(cmd, args, cwd = repoRoot) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function packPackage(packageDir, packDestination) {
  const result = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", packDestination],
    {
      cwd: packageDir,
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
    },
  );

  if (result.status !== 0) {
    throw new Error(`npm pack failed in ${packageDir}`);
  }

  const [{ filename }] = JSON.parse(result.stdout.toString("utf8"));
  return join(packDestination, filename);
}

function validatePackedMetadata(tarball, extractDir) {
  mkdirSync(extractDir, { recursive: true });
  const tar = spawnSync("tar", ["-xzf", tarball, "-C", extractDir], {
    stdio: "inherit",
  });
  if (tar.status !== 0) {
    throw new Error(`tar extract failed for ${tarball}`);
  }

  const manifest = JSON.parse(
    readFileSync(join(extractDir, "package", "package.json"), "utf8"),
  );
  const violations = [];
  for (const field of PUBLISH_FACING_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        violations.push(`${field}.${name}=${version}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Packed ${manifest.name} contains workspace protocol in publish-facing dependencies:\n  ${violations.join("\n  ")}`,
    );
  }
  console.log(`Metadata OK: ${manifest.name} has no workspace: protocols.`);
}

try {
  run("bun", ["run", "--filter", "@supabase/pg-topo", "build"]);
  run("bun", ["run", "--filter", "@supabase/pg-delta", "build"]);

  const pgTopoTarball = packPackage(join(repoRoot, "packages", "pg-topo"), tempDir);
  const pgDeltaTarball = packPackage(join(repoRoot, "packages", "pg-delta"), tempDir);

  validatePackedMetadata(pgTopoTarball, join(tempDir, "extract-pg-topo"));
  validatePackedMetadata(pgDeltaTarball, join(tempDir, "extract-pg-delta"));

  const projectDir = join(tempDir, "project");
  mkdirSync(projectDir, { recursive: true });

  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({ name: "deno-e2e", private: true }, null, 2),
  );

  run("npm", ["install", "--silent", "--no-package-lock", pgTopoTarball, pgDeltaTarball], projectDir);

  const fixtureSrc = join(repoRoot, ".github", "scripts", "fixtures", "deno-golden-path.ts");
  const fixtureDest = join(projectDir, "deno-golden-path.ts");
  cpSync(fixtureSrc, fixtureDest);

  run(
    "deno",
    ["run", "--allow-env", "--allow-read", "--node-modules-dir=manual", fixtureDest],
    projectDir,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
