/**
 * Prepares a Supabase CLI checkout that runs from source against this repo's pg-delta.
 *
 * Clones supabase/cli at SUPABASE_CLI_REF (default `develop`) into SUPABASE_CLI_DIR
 * (default `.cli/cli`), installs the working tree's pg-delta as a packed tarball in place
 * of the CLI's pinned version, and writes `.cli/bin/supabase`. A later run force-resets
 * that checkout (local edits and untracked files are lost), so it only reuses a directory
 * this script cloned and refuses any other existing checkout.
 *
 * Requires git, pnpm, npm, and bun on PATH.
 */
import { $ } from "bun";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const packageDir = path.resolve(import.meta.dir, "..");
const pgDeltaDir = path.resolve(packageDir, "..", "pg-delta");
const cliDir = path.resolve(
  process.env["SUPABASE_CLI_DIR"] ?? path.join(packageDir, ".cli", "cli"),
);
const cliRef = process.env["SUPABASE_CLI_REF"] ?? "develop";
const binPath = path.join(packageDir, ".cli", "bin", "supabase");

const exists = async (file: string) => Bun.file(file).exists();

// Inside .git/, so neither `git clean` nor the checkout's own files can remove or fake it.
const managedMarker = path.join(cliDir, ".git", "declarative-e2e-managed");

if (await exists(path.join(cliDir, ".git", "HEAD"))) {
  if (!(await exists(managedMarker))) {
    throw new Error(
      `${cliDir} is a git checkout this script did not create; refusing to force-reset it. Point SUPABASE_CLI_DIR at a new directory.`,
    );
  }
  await $`git -C ${cliDir} fetch --depth 1 origin ${cliRef}`;
  await $`git -C ${cliDir} checkout --force FETCH_HEAD`;
  await $`git -C ${cliDir} clean -fdx -e node_modules`;
} else {
  await mkdir(path.dirname(cliDir), { recursive: true });
  await $`git clone --depth 1 --branch ${cliRef} https://github.com/supabase/cli.git ${cliDir}`;
  await writeFile(
    managedMarker,
    "created by packages/declarative-e2e/scripts/setup-cli.ts\n",
  );
}
const cliSha = (await $`git -C ${cliDir} rev-parse HEAD`.text()).trim();

const packDir = await mkdtemp(path.join(tmpdir(), "pg-delta-pack-"));
await $`bun pm pack --destination ${packDir} --quiet`.cwd(pgDeltaDir);
const tarball = (await readdir(packDir)).find((name) => name.endsWith(".tgz"));
if (tarball === undefined)
  throw new Error(`bun pm pack wrote no tarball to ${packDir}`);
const tarballPath = path.join(packDir, tarball);

const cliPackagePath = path.join(cliDir, "apps", "cli", "package.json");
const cliPackage = JSON.parse(await readFile(cliPackagePath, "utf8"));
const pinned = cliPackage.devDependencies?.["@supabase/pg-delta"];
if (pinned === undefined) {
  throw new Error(
    `${cliPackagePath} no longer declares @supabase/pg-delta in devDependencies`,
  );
}
cliPackage.devDependencies["@supabase/pg-delta"] = `file:${tarballPath}`;
await writeFile(cliPackagePath, `${JSON.stringify(cliPackage, null, 2)}\n`);
// The checkout ships a mise.toml; mise refuses untrusted configs, so skip it rather than trust it.
await $`pnpm install --no-frozen-lockfile`.cwd(cliDir).env({
  ...process.env,
  MISE_IGNORED_CONFIG_PATHS: path.join(cliDir, "mise.toml"),
});

/** Hashes every file under `dir`, keyed by relative path. */
async function treeDigest(dir: string): Promise<string> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
  const hasher = new Bun.CryptoHasher("sha256");
  for (const file of files) {
    hasher.update(file);
    hasher.update(await readFile(path.join(dir, file)));
  }
  return hasher.digest("hex");
}

// Same version strings are common (the pin often equals the workspace version); compare sources.
const installedDir = path.join(
  cliDir,
  "apps",
  "cli",
  "node_modules",
  "@supabase",
  "pg-delta",
);
if (
  (await treeDigest(path.join(installedDir, "src"))) !==
  (await treeDigest(path.join(pgDeltaDir, "src")))
) {
  throw new Error(
    `${installedDir}/src does not match the workspace pg-delta sources`,
  );
}
const workspace = JSON.parse(
  await readFile(path.join(pgDeltaDir, "package.json"), "utf8"),
);

// Run the CLI on the Bun release it pins, independent of this repo's Bun.
const bunVersionFile = Bun.file(path.join(cliDir, ".bun-version"));
const bunVersion = (await bunVersionFile.exists())
  ? (await bunVersionFile.text()).trim()
  : "latest";
const runtimeDir = path.join(packageDir, ".cli", "bun-runtime");
await $`npm install --prefix ${runtimeDir} --no-save --no-audit --no-fund bun@${bunVersion}`.quiet();
const bunBin = path.join(runtimeDir, "node_modules", ".bin", "bun");

await mkdir(path.dirname(binPath), { recursive: true });
await writeFile(
  binPath,
  `#!/usr/bin/env bash\nexec ${JSON.stringify(bunBin)} ${JSON.stringify(path.join(cliDir, "apps", "cli", "src", "main.ts"))} "$@"\n`,
);
await chmod(binPath, 0o755);

console.log(
  `supabase/cli ${cliRef} @ ${cliSha} (pinned pg-delta ${pinned}) now uses workspace pg-delta ${workspace.version} on bun ${bunVersion}\n${binPath}`,
);
