/**
 * Declarative-schema scenarios driven through the Supabase CLI. See ../README.md for the format.
 */
import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const SCENARIOS_DIR = path.resolve(import.meta.dir, "..", "scenarios");
const CLI =
  process.env["SUPABASE_CLI"] ??
  path.resolve(import.meta.dir, "..", ".cli", "bin", "supabase");

const COMMAND_TIMEOUT_MS = 280_000;
// Covers a cold supabase/postgres image pull.
const STACK_START_TIMEOUT_MS = 480_000;
const SCENARIO_BASE_TIMEOUT_MS = 240_000;
const STEP_TIMEOUT_MS = 240_000;
const SUITE_MARGIN_MS = 300_000;

// The default run covers `smoke` scenarios on one major only.
const SMOKE_PG = 17;
// `init --use-orioledb` pins a 17.x OrioleDB image.
const ORIOLEDB_PG = 17;
const REMOTE_MIGRATION = "20260101000000_remote.sql";

const backendEnv = process.env["DECLARATIVE_BACKEND"] || "stack";
if (backendEnv !== "stack" && backendEnv !== "legacy") {
  throw new Error(
    `DECLARATIVE_BACKEND=${backendEnv} is not supported; use "stack" or "legacy"`,
  );
}
const BACKEND: "stack" | "legacy" = backendEnv;
const STACK_RUNTIME = process.env["DECLARATIVE_STACK_RUNTIME"] || "native";
// Databases per target; each runs its share of the scenarios.
const CONCURRENCY = Number(process.env["DECLARATIVE_CONCURRENCY"] || 3);
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
  throw new Error(
    `DECLARATIVE_CONCURRENCY=${process.env["DECLARATIVE_CONCURRENCY"]} is not a positive integer`,
  );
}
const DESTRUCTIVE_WARNING = "Found destructive changes";
const NO_CHANGES = "No schema changes found";

// Agent detection changes CLI rendering; keep aligned with supabase/cli tests/helpers/cli.ts.
const AGENT_ENV_KEYS = [
  "AI_AGENT",
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CODEX_THREAD_ID",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "OPENCODE_CLIENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "REPL_ID",
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
];

interface KnownIssue {
  readonly url: string;
  readonly failsAt: string;
  readonly message?: string | readonly string[];
  readonly target?: string;
}

interface StepConfig {
  readonly command?: "sync" | "generate";
  readonly delete?: readonly string[];
  readonly migration: "none" | "some";
  readonly contains?: readonly string[];
  readonly notContains?: readonly string[];
  readonly destructive?: boolean;
  readonly unchanged?: readonly string[];
  readonly rowCounts?: Readonly<Record<string, number>>;
}

interface Target {
  readonly pg: number;
  readonly orioledb: boolean;
}

interface Scenario {
  readonly name: string;
  readonly tags: readonly string[];
  readonly knownIssue: KnownIssue | undefined;
  readonly targets: readonly Target[];
  readonly flags: readonly string[];
  readonly remoteSql: string | undefined;
  readonly steps: readonly {
    name: string;
    schemasDir: string;
    config: StepConfig;
  }[];
}

/** A scenario check that did not hold, or (`unexpected`) any other error, at `step`. */
class ScenarioCheckError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly unexpected = false,
  ) {
    super(message);
  }
}

const targetLabel = (target: Target) =>
  `pg ${target.pg}${target.orioledb ? " orioledb" : ""}`;

type Shape = Record<string, (value: unknown) => boolean>;
const isString = (value: unknown) => typeof value === "string";
const isStrings = (value: unknown) =>
  Array.isArray(value) && value.every(isString);
const isBoolean = (value: unknown) => typeof value === "boolean";
const isInt = (value: unknown) => Number.isInteger(value);

/** Parses a JSON object, rejecting unknown keys, missing required keys, and wrong types. */
async function readConfig<T>(
  file: string,
  shape: Shape,
  required: readonly string[],
): Promise<T> {
  const value: unknown = JSON.parse(await Bun.file(file).text());
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file}: expected an object`);
  }
  for (const [key, field] of Object.entries(value)) {
    const valid = shape[key];
    if (valid === undefined) throw new Error(`${file}: unknown field "${key}"`);
    if (!valid(field)) throw new Error(`${file}: invalid "${key}"`);
  }
  for (const key of required) {
    if (!(key in value)) throw new Error(`${file}: missing "${key}"`);
  }
  return value as T;
}

const knownIssueShape: Shape = {
  url: isString,
  failsAt: isString,
  message: (value) => isString(value) || isStrings(value),
  target: isString,
};

const scenarioShape: Shape = {
  issue: isString,
  knownIssue: (value) =>
    typeof value === "object" &&
    value !== null &&
    Object.entries(value).every(
      ([key, field]) => knownIssueShape[key]?.(field) === true,
    ) &&
    "url" in value &&
    "failsAt" in value,
  tags: isStrings,
  pg: (value) => Array.isArray(value) && value.length > 0 && value.every(isInt),
  orioledb: isBoolean,
  flags: isStrings,
};

const stepShape: Shape = {
  command: (value) => value === "sync" || value === "generate",
  delete: isStrings,
  migration: (value) => value === "none" || value === "some",
  contains: isStrings,
  notContains: isStrings,
  destructive: isBoolean,
  unchanged: isStrings,
  rowCounts: (value) =>
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(isInt),
};

async function subdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function loadScenario(name: string): Promise<Scenario> {
  const dir = path.join(SCENARIOS_DIR, name);
  const config = await readConfig<{
    knownIssue?: KnownIssue;
    tags?: string[];
    pg?: number[];
    orioledb?: boolean;
    flags?: string[];
  }>(path.join(dir, "scenario.json"), scenarioShape, []);
  const stepsDir = path.join(dir, "steps");
  const steps = [];
  for (const step of await subdirectories(stepsDir)) {
    const stepConfig = await readConfig<StepConfig>(
      path.join(stepsDir, step, "step.json"),
      stepShape,
      ["migration"],
    );
    const migrationChecks = ["contains", "notContains", "destructive"].filter(
      (key) => key in stepConfig,
    );
    if (
      stepConfig.command === "generate" &&
      (stepConfig.migration !== "none" || migrationChecks.length > 0)
    ) {
      throw new Error(
        `step ${name}/${step}: a generate step writes no migration; expect migration "none" without contains/notContains/destructive`,
      );
    }
    steps.push({
      name: step,
      schemasDir: path.join(stepsDir, step, "schemas"),
      config: stepConfig,
    });
  }
  const remoteFile = Bun.file(path.join(dir, "remote.sql"));
  const remoteSql = (await remoteFile.exists())
    ? await remoteFile.text()
    : undefined;
  if (remoteSql === undefined && steps.length === 0) {
    throw new Error(`scenario ${name} has neither remote.sql nor steps`);
  }
  const targets: Target[] = [
    ...(config.pg ?? [17]).map((pg) => ({ pg, orioledb: false })),
    ...(config.orioledb === true ? [{ pg: ORIOLEDB_PG, orioledb: true }] : []),
  ];
  const knownTarget = config.knownIssue?.target;
  if (
    knownTarget !== undefined &&
    !targets.some((target) => targetLabel(target) === knownTarget)
  ) {
    throw new Error(
      `scenario ${name}: knownIssue.target "${knownTarget}" is not one of ${targets.map(targetLabel).join(", ")}`,
    );
  }
  return {
    name,
    tags: config.tags ?? [],
    knownIssue: config.knownIssue,
    // The stack backend rejects db.orioledb_version until supabase/cli#6934 lands.
    targets:
      BACKEND === "stack"
        ? targets.filter((target) => !target.orioledb)
        : targets,
    flags: config.flags ?? [],
    remoteSql,
    steps,
  };
}

async function selectScenarios(): Promise<{
  label: string;
  scenarios: Scenario[];
}> {
  const only = process.env["DECLARATIVE_SCENARIO"] || undefined;
  const which = process.env["DECLARATIVE_SCENARIOS"] || undefined;
  if (which !== undefined && which !== "all") {
    throw new Error(
      `DECLARATIVE_SCENARIOS=${which} is not supported; use "all"`,
    );
  }
  const loaded = await Promise.all(
    (await subdirectories(SCENARIOS_DIR)).map(loadScenario),
  );
  if (only !== undefined) {
    return {
      label: `DECLARATIVE_SCENARIO=${only}`,
      scenarios: loaded.filter((scenario) => scenario.name === only),
    };
  }
  if (which === "all")
    return { label: "DECLARATIVE_SCENARIOS=all", scenarios: loaded };
  return {
    label: `smoke scenarios on pg ${SMOKE_PG}`,
    scenarios: loaded.flatMap((scenario) =>
      scenario.tags.includes("smoke") &&
      scenario.targets.some(
        (target) => target.pg === SMOKE_PG && !target.orioledb,
      )
        ? [{ ...scenario, targets: [{ pg: SMOKE_PG, orioledb: false }] }]
        : [],
    ),
  };
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function cliEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !AGENT_ENV_KEYS.includes(key)) env[key] = value;
  }
  env["SUPABASE_NO_UPDATE_NOTIFIER"] = "1";
  env["SUPABASE_TELEMETRY_DISABLED"] = "1";
  // Each project's config.toml selects the backend, names its containers, and picks its ports;
  // inherited overrides would mask that, and shared ids or ports collide across parallel databases.
  for (const key of [
    "SUPABASE_EXPERIMENTAL_STACK",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_DB_PORT",
    "SUPABASE_DB_SHADOW_PORT",
  ])
    delete env[key];
  return env;
}

async function supabase(
  cwd: string,
  args: readonly string[],
  { timeoutMs = COMMAND_TIMEOUT_MS, env = {} as Record<string, string> } = {},
): Promise<CommandResult> {
  const child = Bun.spawn([CLI, ...args], {
    cwd,
    env: { ...cliEnv(), ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const commandOutput = (result: CommandResult) =>
  `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

function requireSuccess(result: CommandResult, what: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${what} failed (exit ${result.exitCode})\n${commandOutput(result)}`,
    );
  }
}

function check(condition: boolean, step: string, message: string): void {
  if (!condition) throw new ScenarioCheckError(step, message);
}

/** Runs `body`, reporting any non-check error as an unexpected failure of `step`. */
async function asStep(step: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (error instanceof ScenarioCheckError) throw error;
    throw new ScenarioCheckError(
      step,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      true,
    );
  }
}

const normalizeSql = (sql: string) =>
  sql.toLowerCase().replaceAll('"', "").replace(/\s+/gu, " ");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port assigned")),
      );
    });
  });
}

async function migrationFiles(projectDir: string): Promise<string[]> {
  const dir = path.join(projectDir, "supabase", "migrations");
  return (await readdir(dir).catch(() => [] as string[]))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** Runs a CLI command and returns it with the SQL of every migration file it added. */
async function runAndCollectMigrations(
  projectDir: string,
  args: readonly string[],
) {
  const before = new Set(await migrationFiles(projectDir));
  const result = await supabase(projectDir, args);
  const added = (await migrationFiles(projectDir)).filter(
    (file) => !before.has(file),
  );
  const sql = (
    await Promise.all(
      added.map((file) =>
        Bun.file(path.join(projectDir, "supabase", "migrations", file)).text(),
      ),
    )
  ).join("\n");
  return { result, added, sql };
}

async function expectConverged(
  projectDir: string,
  flags: readonly string[],
  label: string,
) {
  const { result, added, sql } = await runAndCollectMigrations(projectDir, [
    "db",
    "schema",
    "declarative",
    "sync",
    "--no-apply",
    "--experimental",
    ...flags,
  ]);
  check(
    result.exitCode === 0 &&
      added.length === 0 &&
      `${result.stdout}${result.stderr}`.includes(NO_CHANGES),
    label,
    `sync did not converge (exit ${result.exitCode})\n${commandOutput(result)}\nnew migration SQL:\n${sql}`,
  );
}

async function overlayDirectory(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { recursive: true }).catch(
    () => [] as string[],
  );
  for (const relative of entries) {
    const source = path.join(from, relative);
    if (!(await stat(source)).isFile()) continue;
    const target = path.join(to, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function countRows(projectDir: string, table: string): Promise<number> {
  const quoted = table
    .split(".")
    .map((part) => `"${part}"`)
    .join(".");
  const result = await supabase(projectDir, [
    "db",
    "query",
    "--local",
    "-o",
    "json",
    `select count(*)::int as n from ${quoted}`,
  ]);
  requireSuccess(result, `db query ${table}`);
  // Outside agent mode, `db query -o json` prints the bare row array.
  const rows: unknown = JSON.parse(result.stdout);
  const n =
    Array.isArray(rows) && rows.length === 1
      ? (rows[0] as { n?: unknown }).n
      : undefined;
  if (!Number.isInteger(n))
    throw new Error(`unexpected db query output: ${result.stdout}`);
  return n as number;
}

// Shared so concurrent legacy projects never pick the same host port.
const assignedPorts = new Set<number>();

/** Initializes a project for `target` and starts its database; scenarios reset it in turn. */
async function startStack(projectDir: string, target: Target): Promise<void> {
  requireSuccess(
    await supabase(
      projectDir,
      target.orioledb ? ["init", "--use-orioledb"] : ["init"],
      // Writes `[experimental] stack = true`, which routes every later command.
      BACKEND === "stack" ? { env: { SUPABASE_EXPERIMENTAL_STACK: "1" } } : {},
    ),
    "init",
  );
  const configFile = Bun.file(path.join(projectDir, "supabase", "config.toml"));
  const config = await configFile.text();
  if (!config.includes("[experimental.pgdelta]\nenabled = true")) {
    throw new Error("init did not enable experimental pg-delta in config.toml");
  }
  if (/^stack = true$/mu.test(config) !== (BACKEND === "stack")) {
    throw new Error(
      `init config.toml does not match the ${BACKEND} backend (experimental.stack)`,
    );
  }
  const majorVersionLine = /^major_version = \d+$/mu;
  if (!majorVersionLine.test(config))
    throw new Error("init wrote no [db] major_version");
  if (target.orioledb && !/^orioledb_version = "[^"]+"$/mu.test(config)) {
    throw new Error("init --use-orioledb wrote no [db] orioledb_version");
  }
  const lines: string[] = [];
  for (const line of config
    .replace(majorVersionLine, `major_version = ${target.pg}`)
    .replace(
      '# declarative_schema_path = "./schemas"',
      'declarative_schema_path = "./schemas"',
    )
    .split("\n")) {
    const match =
      /^(\s*(?:port|smtp_port|pop3_port|inspector_port|shadow_port) = )\d+$/.exec(
        line,
      );
    if (match === null) {
      lines.push(line);
      continue;
    }
    let port = await freePort();
    while (assignedPorts.has(port)) port = await freePort();
    assignedPorts.add(port);
    lines.push(`${match[1]}${port}`);
  }
  await Bun.write(configFile, lines.join("\n"));
  if (BACKEND === "stack") {
    // `db start` has no runtime flag; it reuses the runtime saved by the stack prepare creates.
    requireSuccess(
      await supabase(
        projectDir,
        [
          "stack",
          "prepare",
          "--runtime",
          STACK_RUNTIME,
          "--capability",
          "database",
        ],
        { timeoutMs: STACK_START_TIMEOUT_MS },
      ),
      "stack prepare",
    );
  }
  requireSuccess(
    await supabase(projectDir, ["db", "start"], {
      timeoutMs: STACK_START_TIMEOUT_MS,
    }),
    "db start",
  );
}

/** Empties the project's schemas and migrations, then rebuilds the database from `remote.sql`. */
async function resetProject(
  projectDir: string,
  scenario: Scenario,
): Promise<void> {
  for (const dir of ["schemas", "migrations"]) {
    const target = path.join(projectDir, "supabase", dir);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
  }
  if (scenario.remoteSql !== undefined) {
    await Bun.write(
      path.join(projectDir, "supabase", "migrations", REMOTE_MIGRATION),
      scenario.remoteSql,
    );
  }
  requireSuccess(
    await supabase(projectDir, ["db", "reset", "--local", "--no-seed"]),
    "db reset",
  );
}

async function runStep(
  projectDir: string,
  scenario: Scenario,
  step: Scenario["steps"][number],
) {
  const schemasDir = path.join(projectDir, "supabase", "schemas");
  const { config } = step;

  const unchanged = new Map<string, string>();
  for (const relative of config.unchanged ?? []) {
    const file = Bun.file(path.join(schemasDir, relative));
    check(
      await file.exists(),
      step.name,
      `unchanged path ${relative} does not exist`,
    );
    unchanged.set(relative, await file.text());
  }
  for (const relative of config.delete ?? []) {
    const target = path.join(schemasDir, relative);
    const present = await stat(target).then(
      () => true,
      () => false,
    );
    check(present, step.name, `delete path ${relative} does not exist`);
    await rm(target, { recursive: true });
  }
  await overlayDirectory(step.schemasDir, schemasDir);

  const args =
    config.command === "generate"
      ? ["db", "schema", "declarative", "generate", "--local", "--overwrite"]
      : ["db", "schema", "declarative", "sync", "--apply", "--name", step.name];
  const { result, added, sql } = await runAndCollectMigrations(projectDir, [
    ...args,
    "--experimental",
    ...scenario.flags,
  ]);
  const output = `${result.stdout}${result.stderr}`;
  const detail = `${commandOutput(result)}\nnew migration SQL:\n${sql}`;
  check(result.exitCode === 0, step.name, `exit ${result.exitCode}\n${detail}`);
  check(
    config.migration === "none" ? added.length === 0 : added.length > 0,
    step.name,
    `expected migration "${config.migration}", got ${added.length} new file(s)\n${detail}`,
  );
  if (config.command !== "generate" && config.migration === "none") {
    check(
      output.includes(NO_CHANGES),
      step.name,
      `expected "${NO_CHANGES}"\n${detail}`,
    );
  }
  const normalized = normalizeSql(sql);
  for (const fragment of config.contains ?? []) {
    check(
      normalized.includes(normalizeSql(fragment)),
      step.name,
      `migration lacks "${fragment}"\n${detail}`,
    );
  }
  for (const fragment of config.notContains ?? []) {
    check(
      !normalized.includes(normalizeSql(fragment)),
      step.name,
      `migration contains "${fragment}"\n${detail}`,
    );
  }
  const destructive = config.destructive ?? false;
  check(
    output.includes(DESTRUCTIVE_WARNING) === destructive,
    step.name,
    `expected destructive ${destructive}\n${detail}`,
  );
  for (const [relative, before] of unchanged) {
    const file = Bun.file(path.join(schemasDir, relative));
    const after = (await file.exists()) ? await file.text() : undefined;
    check(
      after === before,
      step.name,
      `${relative} changed\nafter:\n${after ?? "<removed>"}`,
    );
  }
  for (const [table, expected] of Object.entries(config.rowCounts ?? {})) {
    const actual = await countRows(projectDir, table);
    check(
      actual === expected,
      step.name,
      `${table} has ${actual} rows, expected ${expected}`,
    );
  }
}

async function runScenario(
  projectDir: string,
  scenario: Scenario,
): Promise<void> {
  await asStep("reset", () => resetProject(projectDir, scenario));
  if (scenario.remoteSql !== undefined) {
    await asStep("bootstrap", async () =>
      requireSuccess(
        await supabase(projectDir, [
          "db",
          "schema",
          "declarative",
          "generate",
          "--local",
          "--overwrite",
          "--experimental",
          ...scenario.flags,
        ]),
        "bootstrap generate",
      ),
    );
    const label = "bootstrap (converge)";
    await asStep(label, () =>
      expectConverged(projectDir, scenario.flags, label),
    );
  }
  for (const step of scenario.steps) {
    await asStep(step.name, () => runStep(projectDir, scenario, step));
    // A sync that planned nothing already proved convergence.
    if (step.config.command !== "generate" && step.config.migration === "none")
      continue;
    const label = `${step.name} (converge)`;
    await asStep(label, () =>
      expectConverged(projectDir, scenario.flags, label),
    );
  }
}

/** Runs `scenario` and returns its failure report, or undefined when it passed or failed as its knownIssue expects. */
async function scenarioFailure(
  projectDir: string,
  scenario: Scenario,
  label: string,
): Promise<string | undefined> {
  const known =
    scenario.knownIssue?.target === undefined ||
    scenario.knownIssue.target === label
      ? scenario.knownIssue
      : undefined;
  let error: unknown;
  try {
    await runScenario(projectDir, scenario);
  } catch (caught) {
    error = caught;
  }
  if (error === undefined) {
    console.error(`scenario ${scenario.name} (${label}): pass`);
    return known === undefined
      ? undefined
      : `${scenario.name}: passed; remove knownIssue from ${scenario.name} (${known.url})`;
  }
  const report =
    error instanceof ScenarioCheckError
      ? `${scenario.name} [${error.step}]: ${error.message}`
      : `${scenario.name}: ${error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error)}`;
  const isKnown =
    known !== undefined &&
    error instanceof ScenarioCheckError &&
    !error.unexpected &&
    error.step === known.failsAt &&
    [known.message ?? []]
      .flat()
      .every((fragment) => error.message.includes(fragment));
  if (isKnown) {
    console.error(
      `scenario ${scenario.name} (${label}): known issue ${known.url}`,
    );
    return undefined;
  }
  console.error(`scenario ${scenario.name} (${label}): FAIL`);
  return known === undefined
    ? report
    : `${report}\n(knownIssue expects a check failure at "${known.failsAt}"${
        known.message === undefined
          ? ""
          : ` containing ${JSON.stringify([known.message].flat())}`
      })`;
}

/** Starts a database for `target` in a fresh project, runs `body` on it, then tears it down. */
async function withDatabase(
  target: Target,
  body: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "pg-toolbelt-declarative-e2e-"),
  );
  try {
    await startStack(projectDir, target);
    await body(projectDir);
  } finally {
    // The stack backend rejects `stop --no-backup`; plain `stop` would keep its data.
    const teardown =
      BACKEND === "stack"
        ? ["stack", "destroy", "--yes"]
        : ["stop", "--no-backup"];
    const stop = await supabase(projectDir, teardown).catch(
      (error: unknown): CommandResult => ({
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : JSON.stringify(error),
      }),
    );
    // The project directory is what teardown needs to find the stack again.
    if (stop.exitCode === 0) {
      await rm(projectDir, { recursive: true, force: true });
    } else {
      console.error(
        `supabase ${teardown.join(" ")} failed (exit ${stop.exitCode}); kept ${projectDir}. Retry with: ${CLI} ${teardown.join(" ")} --workdir ${projectDir}\n${commandOutput(stop)}`,
      );
    }
  }
}

/** Runs every scenario across up to CONCURRENCY databases and returns every failure. */
async function runTarget(
  target: Target,
  selected: readonly Scenario[],
): Promise<string[]> {
  const label = targetLabel(target);
  // Longest first, so the scenarios that start last are short.
  const queue = [...selected].sort((a, b) => b.steps.length - a.steps.length);
  const failures = new Map<string, string>();
  const databases = await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () =>
      withDatabase(target, async (projectDir) => {
        for (
          let scenario = queue.shift();
          scenario !== undefined;
          scenario = queue.shift()
        ) {
          const failure = await scenarioFailure(projectDir, scenario, label);
          if (failure !== undefined) failures.set(scenario.name, failure);
        }
      }),
    ),
  );
  return [
    ...selected.flatMap((scenario) => failures.get(scenario.name) ?? []),
    ...databases.flatMap((database) => {
      if (database.status === "fulfilled") return [];
      const report = `database (${label}): ${database.reason instanceof Error ? database.reason.message : JSON.stringify(database.reason)}`;
      // The assertion diff can drop long multi-line CLI output; the log keeps all of it.
      console.error(report);
      return [report];
    }),
  ];
}

const selection = await selectScenarios();
const targets = [
  ...new Map(
    selection.scenarios
      .flatMap((scenario) => scenario.targets)
      .map((target) => [targetLabel(target), target] as const),
  ).values(),
].sort((a, b) => a.pg - b.pg || Number(a.orioledb) - Number(b.orioledb));

describe(`declarative schema scenarios (${BACKEND} backend)`, () => {
  test("selects at least one scenario", () => {
    expect(
      selection.scenarios.map((scenario) => scenario.name),
      `${selection.label} selected no scenario; check the env vars and scenarios/*/scenario.json`,
    ).not.toEqual([]);
  });

  for (const target of targets) {
    const label = targetLabel(target);
    const selected = selection.scenarios.filter((scenario) =>
      scenario.targets.some((candidate) => targetLabel(candidate) === label),
    );
    const budget = selected.reduce(
      (total, scenario) =>
        total +
        SCENARIO_BASE_TIMEOUT_MS +
        scenario.steps.length * STEP_TIMEOUT_MS,
      STACK_START_TIMEOUT_MS + SUITE_MARGIN_MS,
    );
    test(
      `scenarios (${label})`,
      async () => {
        expect(
          await Bun.file(CLI).exists(),
          `${CLI} not found; run \`bun run setup-cli\``,
        ).toBe(true);
        const failures = await runTarget(target, selected);
        expect(failures, `${failures.length} failure(s) on ${label}`).toEqual(
          [],
        );
      },
      budget,
    );
  }
});
