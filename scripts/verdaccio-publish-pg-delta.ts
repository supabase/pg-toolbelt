/**
 * Build pg-delta and publish it to the locally-running Verdaccio with a fresh
 * `0.0.0-local.<unix-ts>` version, then restore the working-copy version so the
 * repo stays clean. Pair with `bun run verdaccio:start`.
 *
 * Usage:
 *   bun run pg-delta:publish-local
 *   bun run pg-delta:publish-local --write-version-to=/path/to/proj/supabase/.temp/pgdelta-version
 *   bun run pg-delta:publish-local --registry=http://localhost:4873/
 *
 * Options:
 *   --write-version-to=<path>  Write the published version to <path> so the
 *                              Supabase CLI's `EffectivePgDeltaNpmVersion`
 *                              picks it up automatically. Parent dirs are
 *                              created. When omitted, the version is printed.
 *   --registry=<url>           Override Verdaccio URL (default: http://localhost:4873/).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const pgDeltaRoot = join(repoRoot, "packages", "pg-delta");
const pgDeltaPkgJson = join(pgDeltaRoot, "package.json");
const defaultRegistry = "http://localhost:4873/";

function log(msg: string) {
  console.log(`\n=== ${msg} ===`);
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

interface CliArgs {
  writeVersionTo: string | null;
  registry: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let writeVersionTo: string | null = null;
  let registry = defaultRegistry;
  for (const arg of args) {
    if (arg.startsWith("--write-version-to=")) {
      writeVersionTo = arg.slice("--write-version-to=".length);
    } else if (arg.startsWith("--registry=")) {
      registry = arg.slice("--registry=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun run pg-delta:publish-local [--write-version-to=<path>] [--registry=<url>]",
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return { writeVersionTo, registry };
}

// npm refuses to POST a publish without an auth token configured for the
// target registry, even when the registry would accept anonymous. Derive the
// per-registry config key (`//<host>[:<port>][<path>]/:_authToken`) from the
// URL so we can pass `--<key>=<dummy>` to `npm publish` and let the request
// through. Verdaccio with `publish: $all` ignores the token value.
function authTokenFlag(registry: string): string {
  const stripped = registry.replace(/^https?:/i, "").replace(/\/+$/, "");
  return `--${stripped}/:_authToken=local-anon-token`;
}

async function run(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface PkgJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const { writeVersionTo, registry } = parseArgs();

  const pkg = await readJson<PkgJson>(pgDeltaPkgJson);
  const originalVersion = pkg.version;
  const localVersion = `0.0.0-local.${Math.floor(Date.now() / 1000)}`;

  log(
    `Publishing ${pkg.name} as ${localVersion} (working copy will be restored to ${originalVersion})`,
  );

  // Bump version in-place so npm pack/publish picks it up.
  pkg.version = localVersion;
  await writeJson(pgDeltaPkgJson, pkg);

  try {
    log("Building pg-delta");
    const buildExit = await run(
      ["bun", "run", "--filter", "@supabase/pg-delta", "build"],
      { cwd: repoRoot },
    );
    if (buildExit !== 0) fail("pg-delta build failed");

    log(`Publishing to ${registry}`);
    // Use `npm publish` (not `bun publish`) because Verdaccio handles npm's
    // protocol most reliably for anonymous local registries.
    const publishExit = await run(
      [
        "npm",
        "publish",
        "--registry",
        registry,
        "--tag",
        "local",
        "--access",
        "public",
        authTokenFlag(registry),
      ],
      { cwd: pgDeltaRoot },
    );
    if (publishExit !== 0) fail("npm publish failed");
  } finally {
    // Always restore the working-copy version, even on failure, so the repo
    // stays clean.
    const restored = await readJson<PkgJson>(pgDeltaPkgJson);
    restored.version = originalVersion;
    await writeJson(pgDeltaPkgJson, restored);
  }

  if (writeVersionTo) {
    const absPath = resolve(writeVersionTo);
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, `${localVersion}\n`);
    log(`Wrote ${localVersion} to ${absPath}`);
  } else {
    log(`Published version: ${localVersion}`);
    console.log(
      "\nTo activate in a Supabase project, run:\n" +
        `  echo '${localVersion}' > <project>/supabase/.temp/pgdelta-version\n` +
        `  PGDELTA_NPM_REGISTRY=${registry} supabase db <command>`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
