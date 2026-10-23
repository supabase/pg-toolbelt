import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectionEndpointHash,
  databaseIdentityStamp,
  observeDatabaseIdentity,
} from "../src/cli/connection-safety.ts";
import { cmdProve } from "../src/cli/commands/prove.ts";
import { UsageError } from "../src/cli/flags.ts";
import { buildFactBase, type FactBase } from "../src/core/fact.ts";
import { serializeSnapshot } from "../src/core/snapshot.ts";
import { extract } from "../src/extract/extract.ts";
import { serializePlan } from "../src/plan/artifact.ts";
import { plan } from "../src/plan/plan.ts";
import type { Policy } from "../src/policy/policy.ts";
import type { ManagementScope } from "../src/policy/view.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

async function proofArtifacts(
  source: TestDb,
  desired: TestDb | ((source: FactBase) => FactBase),
  scope?: ManagementScope,
  policy?: Policy,
): Promise<{ planPath: string; snapshotPath: string }> {
  const [sourceState, observed] = await Promise.all([
    extract(source.pool),
    observeDatabaseIdentity(source.pool),
  ]);
  const desiredFb =
    typeof desired === "function"
      ? desired(sourceState.factBase)
      : (await extract(desired.pool)).factBase;
  const thePlan = plan(sourceState.factBase, desiredFb, {
    ...(scope !== undefined ? { scope } : {}),
    ...(policy !== undefined ? { policy } : {}),
    profile: { id: "raw" },
    redactSecrets: true,
  });
  thePlan.source.endpointHash = connectionEndpointHash(source.uri);
  thePlan.source.identity = databaseIdentityStamp(observed);

  const dir = mkdtempSync(join(tmpdir(), "pgdelta-proof-clone-safety-"));
  const planPath = join(dir, "plan.json");
  const snapshotPath = join(dir, "desired.snapshot");
  writeFileSync(planPath, serializePlan(thePlan), "utf8");
  writeFileSync(
    snapshotPath,
    serializeSnapshot(desiredFb, {
      pgVersion: "17",
      profile: "raw",
      redactSecrets: true,
    }),
    "utf8",
  );
  return { planPath, snapshotPath };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to reject");
}

test("prove rejects a source URL alias by observed database identity before mutation", async () => {
  const cluster = await sharedCluster();
  const source = await cluster.createDb("proof_guard_alias_source");
  const desired = await cluster.createDb("proof_guard_alias_desired");
  try {
    await desired.pool.query("CREATE SCHEMA must_not_reach_source");
    const artifacts = await proofArtifacts(source, desired, "database");
    const alias = new URL(source.uri);
    alias.hostname = alias.hostname === "localhost" ? "127.0.0.1" : "localhost";

    const error = await captureError(
      cmdProve([
        "--plan",
        artifacts.planPath,
        "--clone",
        alias.toString(),
        "--desired-snapshot",
        artifacts.snapshotPath,
        "--allow-unverified-source-identity",
      ]),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toMatch(/same observed database/i);
    expect(
      await source.pool.query(
        "SELECT to_regnamespace('must_not_reach_source') IS NULL AS absent",
      ),
    ).toMatchObject({ rows: [{ absent: true }] });
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}, 60_000);

test("prove rejects same-lineage siblings at cluster scope but allows explicit database scope", async () => {
  const cluster = await sharedCluster();
  const source = await cluster.createDb("proof_guard_lineage_source");
  const desired = await cluster.createDb("proof_guard_lineage_desired");
  const clone = await cluster.createDb("proof_guard_lineage_clone");
  try {
    await desired.pool.query("CREATE SCHEMA database_scope_proof");
    const clusterArtifacts = await proofArtifacts(source, desired);
    const clusterError = await captureError(
      cmdProve([
        "--plan",
        clusterArtifacts.planPath,
        "--clone",
        clone.uri,
        "--desired-snapshot",
        clusterArtifacts.snapshotPath,
      ]),
    );
    expect(clusterError).toBeInstanceOf(UsageError);
    expect((clusterError as Error).message).toMatch(/same PostgreSQL lineage/i);
    expect(
      await clone.pool.query(
        "SELECT to_regnamespace('database_scope_proof') IS NULL AS absent",
      ),
    ).toMatchObject({ rows: [{ absent: true }] });

    const databaseArtifacts = await proofArtifacts(source, desired, "database");
    await cmdProve([
      "--plan",
      databaseArtifacts.planPath,
      "--clone",
      clone.uri,
      "--desired-snapshot",
      databaseArtifacts.snapshotPath,
    ]);
    expect(
      await clone.pool.query(
        "SELECT to_regnamespace('database_scope_proof') IS NOT NULL AS present",
      ),
    ).toMatchObject({ rows: [{ present: true }] });
  } finally {
    await Promise.all([source.drop(), desired.drop(), clone.drop()]);
  }
}, 120_000);

test("prove refuses a same-lineage clone for a database-scope plan that changes role settings", async () => {
  const cluster = await sharedCluster();
  const source = await cluster.createDb("proof_guard_rs_source");
  const clone = await cluster.createDb("proof_guard_rs_clone");
  const roleName = `proof_guard_rs_${process.pid}`;
  await cluster.adminPool.query(`CREATE ROLE "${roleName}"`);
  try {
    // Role settings are cluster-global, so the desired state is the source with
    // one managed setting added rather than a second database.
    const artifacts = await proofArtifacts(
      source,
      (fb) =>
        buildFactBase(
          fb.facts().map((fact) =>
            fact.id.kind === "role" && fact.id.name === roleName
              ? {
                  ...fact,
                  payload: {
                    ...fact.payload,
                    config: ["pgrst.db_schemas=must_not_reach_cluster"],
                  },
                }
              : fact,
          ),
          [...fb.edges],
        ),
      "database",
      {
        id: "proof-guard-role-settings",
        assumedRoles: [roleName],
        managedRoleSettings: [{ roles: [roleName], names: ["pgrst.*"] }],
      },
    );
    const error = await captureError(
      cmdProve([
        "--plan",
        artifacts.planPath,
        "--clone",
        clone.uri,
        "--desired-snapshot",
        artifacts.snapshotPath,
      ]),
    );
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toMatch(
      /same PostgreSQL lineage[^]*role settings/i,
    );
    expect(
      await cluster.adminPool.query(
        `SELECT count(*)::int AS n FROM pg_catalog.pg_db_role_setting s
         JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
         WHERE r.rolname = $1`,
        [roleName],
      ),
    ).toMatchObject({ rows: [{ n: 0 }] });
  } finally {
    await Promise.all([source.drop(), clone.drop()]);
    await cluster.adminPool.query(`DROP ROLE IF EXISTS "${roleName}"`);
  }
}, 120_000);
