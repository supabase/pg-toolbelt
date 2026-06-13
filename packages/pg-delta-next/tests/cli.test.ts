/**
 * CLI integration tests (stage-9 deliverable 5/7/8).
 * Spawns the CLI with Bun.spawn and asserts observable behaviour.
 *
 * All tests use the sharedCluster() fixture from containers.ts.
 */
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadSnapshot } from "../src/frontends/snapshot-file.ts";
import { sharedCluster } from "./containers.ts";

const PKG_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(PKG_DIR, "src/cli/main.ts");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: PKG_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

const SCHEMA_SQL = `
  CREATE SCHEMA clitest;
  CREATE TABLE clitest.items (
    id serial PRIMARY KEY,
    name text NOT NULL
  );
  CREATE INDEX items_name_idx ON clitest.items (name);
`;

describe("CLI: snapshot", () => {
  test("snapshot writes a loadable file whose rootHash round-trips", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_snap_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      const outFile = join(
        tmpdir(),
        `pg-delta-next-snapshot-${Date.now()}.json`,
      );
      const result = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        outFile,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Snapshot saved");

      // round-trip: loadSnapshot should give the same rootHash
      const { factBase } = loadSnapshot(outFile);
      expect(factBase.facts().length).toBeGreaterThan(0);

      // verify the hash is stable (the file is a valid snapshot)
      const { factBase: factBase2 } = loadSnapshot(outFile);
      expect(factBase2.rootHash).toBe(factBase.rootHash);
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("CLI: diff", () => {
  test("diff between two prepared DBs prints expected kinds", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_diff_src");
    const desired = await cluster.createDb("cli_diff_dst");
    try {
      await source.pool.query(SCHEMA_SQL);
      // desired has one extra table
      await desired.pool.query(`
          ${SCHEMA_SQL}
          CREATE TABLE clitest.extras (id serial PRIMARY KEY);
        `);

      const result = await runCli([
        "diff",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
      ]);

      expect(result.exitCode).toBe(0);
      // extras table is an add delta
      expect(result.stdout).toContain("ADD");
      expect(result.stdout).toContain("table");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("CLI: drift", () => {
  test("drift exits 0 when env matches snapshot, exits 1 after mutation", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_drift_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      // take a snapshot of the current state
      const snapshotFile = join(
        tmpdir(),
        `pg-delta-next-drift-${Date.now()}.json`,
      );
      const snapResult = await runCli([
        "snapshot",
        "--source",
        source.uri,
        "--out",
        snapshotFile,
      ]);
      expect(snapResult.exitCode).toBe(0);

      // drift against the same DB — should be no drift
      const nodrif = await runCli([
        "drift",
        "--env",
        source.uri,
        "--snapshot",
        snapshotFile,
      ]);
      expect(nodrif.exitCode).toBe(0);
      expect(nodrif.stdout).toContain("No drift");

      // mutate the DB
      await source.pool.query(`CREATE TABLE clitest.new_table (id integer);`);

      // drift again — should detect the new table
      const hasdrift = await runCli([
        "drift",
        "--env",
        source.uri,
        "--snapshot",
        snapshotFile,
      ]);
      expect(hasdrift.exitCode).toBe(1);
      expect(hasdrift.stdout).toContain("Drift detected");
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("CLI: plan", () => {
  test("plan writes a parseable artifact whose actions are non-empty", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_plan_src");
    const desired = await cluster.createDb("cli_plan_dst");
    try {
      // source is empty; desired has a schema
      await desired.pool.query(SCHEMA_SQL);

      const planFile = join(tmpdir(), `pg-delta-next-plan-${Date.now()}.json`);
      const result = await runCli([
        "plan",
        "--source",
        source.uri,
        "--desired",
        desired.uri,
        "--out",
        planFile,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("actions:");

      // parse the artifact
      const { readFileSync } = await import("node:fs");
      const { parsePlan } = await import("../src/plan/artifact.ts");
      const json = readFileSync(planFile, "utf8");
      const thePlan = parsePlan(json);

      expect(thePlan.actions.length).toBeGreaterThan(0);
      expect(thePlan.formatVersion).toBe(1);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("CLI: schema export", () => {
  test("schema export writes files to disk including schemas/<s>/tables/<t>.sql", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("cli_export_src");
    try {
      await source.pool.query(SCHEMA_SQL);

      const outDir = join(tmpdir(), `pg-delta-next-export-${Date.now()}`);
      mkdirSync(outDir, { recursive: true });

      const result = await runCli([
        "schema",
        "export",
        "--source",
        source.uri,
        "--out-dir",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Exported");

      // verify expected file exists
      const { existsSync } = await import("node:fs");
      expect(existsSync(join(outDir, "schemas/clitest/tables/items.sql"))).toBe(
        true,
      );
    } finally {
      await source.drop();
    }
  }, 60_000);
});
