/**
 * Test configuration and utilities for pg-delta integration tests.
 */

import { inspect } from "node:util";
import debug from "debug";
import type { Pool } from "pg";
import { expect } from "vitest";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { type Catalog, extractCatalog } from "../../src/core/catalog.model.ts";
import type { Change } from "../../src/core/change.types.ts";
import { extractVersion } from "../../src/core/context.ts";
import type { PgDepend } from "../../src/core/depend.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import type { DeclarativeSchemaOutput } from "../../src/core/export/types.ts";
import {
  buildPlanScopeFingerprint,
  hashStableIds,
} from "../../src/core/fingerprint.ts";
import type { Integration } from "../../src/core/integrations/integration.types.ts";
import { applyPlan } from "../../src/core/plan/apply.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  type PostgresVersion,
} from "../constants.ts";
import { containerManager } from "../container-manager.js";

const debugTest = debug("pg-delta:test");
const debugDependencies = debug("pg-delta:dependencies");

interface RoundtripTestOptions {
  mainSession: Pool;
  branchSession: Pool;
  name?: string;
  initialSetup?: string;
  testSql?: string;
  description?: string;
  // Forcing the changes order to be deterministic.
  sortChangesCallback?: (a: Change, b: Change) => number;
  // List of terms that must appear in the generated SQL.
  // If not provided, we expect the generated SQL to match the testSql.
  // When defined, random sorting of changes is skipped to ensure deterministic order.
  expectedSqlTerms?: string[] | "same-as-test-sql";
  // List of dependencies that must be present in main catalog.
  expectedMainDependencies?: PgDepend[];
  // List of dependencies that must be present in branch catalog.
  expectedBranchDependencies?: PgDepend[];
  // List of stable_ids in the order they should appear in the generated changes.
  // This validates dependency resolution ordering.
  expectedOperationOrder?: Change[];
  // Integration to use for filtering and serialization
  integration?: Integration;
}

export interface DeclarativeExportTestOptions {
  mainSession: Pool;
  branchSession: Pool;
  initialSetup?: string;
  testSql?: string;
  integration?: Integration;
}

/**
 * Test that schema extraction, SQL generation, and re-execution produces
 * functionally identical pg_catalog data.
 *
 * This validates the core roundtrip fidelity:
 * 1. Extract catalog from main database (mainSession)
 * 2. Extract catalog from branch database (branchSession)
 * 3. Generate migration from main to branch
 * 4. Apply migration to main database
 * 5. Verify main and branch catalogs are now semantically identical
 */
export async function roundtripFidelityTest(
  options: RoundtripTestOptions,
): Promise<void> {
  const {
    mainSession,
    branchSession,
    initialSetup,
    testSql,
    expectedSqlTerms,
    expectedMainDependencies,
    expectedBranchDependencies,
    expectedOperationOrder,
    sortChangesCallback,
    integration,
  } = options;
  // Silent warnings from PostgreSQL such as subscriptions created without a slot.
  const sessionConfig = ["SET LOCAL client_min_messages = error"];
  // Set up initial schema in BOTH databases
  if (initialSetup) {
    await expect(
      mainSession.query([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
    await expect(
      branchSession.query([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
  }

  // Execute the test SQL in the BRANCH database only
  if (testSql) {
    await expect(
      branchSession.query([...sessionConfig, testSql].join(";\n\n")),
    ).resolves.not.toThrow();
  }

  // Extract catalogs from both databases
  debugTest("mainCatalog: ");
  const mainCatalog = await extractCatalog(mainSession);
  debugTest("branchCatalog: ");
  const branchCatalog = await extractCatalog(branchSession);

  if (expectedMainDependencies && expectedBranchDependencies) {
    validateDependencies(
      mainCatalog,
      branchCatalog,
      expectedMainDependencies,
      expectedBranchDependencies,
    );
  }

  // Generate plan using core workflow
  const planResult = await createPlan(mainSession, branchSession, {
    filter: integration?.filter,
    serialize: integration?.serialize,
  });
  if (!planResult) {
    return;
  }

  let { plan, sortedChanges } = planResult;
  const integrationFilter = integration?.filter;

  // Optional pre-sort for deterministic tie-breaking in tests
  if (sortChangesCallback) {
    sortedChanges = [...sortedChanges].sort(sortChangesCallback);
  }

  debugDependencies("\n==== Sorted Changes ====");
  for (let i = 0; i < sortedChanges.length; i++) {
    const change = sortedChanges[i];
    debugDependencies(
      "[%d] %s creates: %O requires: %O",
      i,
      change.constructor.name,
      change.creates,
      change.requires ?? [],
    );
  }
  debugDependencies("==== End Sorted Changes ====\n");

  if (expectedOperationOrder) {
    validateOperationOrder(sortedChanges, expectedOperationOrder);
  }

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const { hash: targetFingerprint, stableIds } = buildPlanScopeFingerprint(
    branchCatalog,
    sortedChanges,
  );
  const migrationSessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const sqlStatements = plan.statements;
  const migrationScript = `${[...migrationSessionConfig, ...sqlStatements].join(
    ";\n\n",
  )};`;

  // Verify expected terms are the same as the generated SQL
  if (expectedSqlTerms) {
    if (expectedSqlTerms === "same-as-test-sql") {
      expect(migrationScript).toStrictEqual(testSql);
    } else {
      expect(sqlStatements).toStrictEqual(expectedSqlTerms);
    }
  }

  debugTest("migrationScript: %s", migrationScript);

  // Apply migration using core apply
  const applyResult = await applyPlan(plan, mainSession, branchSession, {
    verifyPostApply: true,
  });
  if (applyResult.status !== "applied") {
    const prettyApplyResult = inspect(applyResult, {
      depth: null,
      colors: false,
      compact: false,
      breakLength: 120,
    });
    throw new Error(`Apply failed:\n${prettyApplyResult}`, {
      cause: applyResult,
    });
  }

  const debugMainCatalogAfter = await extractCatalog(mainSession);
  const postApplyFingerprint = hashStableIds(debugMainCatalogAfter, stableIds);

  if (applyResult.warnings?.length) {
    console.error(
      "[roundtrip] apply warnings: %o\n[targetFingerprint=%s postApplyFingerprint=%s]",
      applyResult.warnings,
      targetFingerprint,
      postApplyFingerprint,
    );
  }

  if (postApplyFingerprint !== targetFingerprint) {
    const remainingChanges = diffCatalogs(debugMainCatalogAfter, branchCatalog);
    const sortedRemaining = sortChanges(
      { mainCatalog: debugMainCatalogAfter, branchCatalog },
      remainingChanges,
    );
    const remainingSql = sortedRemaining.map((c) => c.serialize()).join(";\n");
    const remainingSummary = sortedRemaining.map((c) => ({
      change: c.constructor.name,
      op: c.operation,
      objectType: c.objectType,
      scope: (c as { scope?: string }).scope ?? "object",
      creates: c.creates,
      drops: c.drops,
      requires: c.requires,
    }));
    console.error(
      "[roundtrip] fingerprint mismatch\n target=%s\n post=%s\n remainingSummary=%o\n remainingSql=%s",
      targetFingerprint,
      postApplyFingerprint,
      remainingSummary,
      remainingSql,
    );
  }

  expect(postApplyFingerprint).toStrictEqual(targetFingerprint);
  expect(applyResult.warnings ?? []).toEqual([]);

  await verifyNoRemainingChanges(
    mainSession,
    branchCatalog,
    integrationFilter,
    migrationScript,
  );
}

export async function testDeclarativeExport(
  options: DeclarativeExportTestOptions,
): Promise<DeclarativeSchemaOutput> {
  const { mainSession, branchSession, initialSetup, testSql, integration } =
    options;
  // Silent warnings from PostgreSQL such as subscriptions created without a slot.
  const sessionConfig = ["SET LOCAL client_min_messages = error"];

  if (initialSetup) {
    await expect(
      mainSession.query([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
    await expect(
      branchSession.query([...sessionConfig, initialSetup].join(";\n\n")),
    ).resolves.not.toThrow();
  }

  if (testSql) {
    await expect(
      branchSession.query([...sessionConfig, testSql].join(";\n\n")),
    ).resolves.not.toThrow();
  }

  const mainCatalog = await extractCatalog(mainSession);
  const branchCatalog = await extractCatalog(branchSession);
  const ctx = { mainCatalog, branchCatalog };

  const changes = diffCatalogs(mainCatalog, branchCatalog);
  const integrationFilter = integration?.filter;
  const filteredChanges = integrationFilter
    ? changes.filter((change) => integrationFilter(change))
    : changes;
  const sortedChanges = sortChanges(ctx, filteredChanges);

  const output = exportDeclarativeSchema(ctx, sortedChanges, { integration });

  expect(output.version).toBe(1);
  expect(output.mode).toBe("declarative");
  expect(output.files).toBeInstanceOf(Array);
  expect(output.source.fingerprint).toBeTruthy();
  expect(output.target.fingerprint).toBeTruthy();

  const pgVersion = await getPostgresMajorVersion(mainSession);
  const { main: testPool, cleanup } =
    await containerManager.getDatabasePair(pgVersion);

  try {
    await testPool.query("SET client_min_messages = error");

    if (initialSetup) {
      await expect(
        testPool.query([...sessionConfig, initialSetup].join(";\n\n")),
      ).resolves.not.toThrow();
    }

    const hasRoutineChanges = sortedChanges.some(
      (change) =>
        change.objectType === "procedure" || change.objectType === "aggregate",
    );
    if (hasRoutineChanges) {
      await expect(
        testPool.query("SET check_function_bodies = false"),
      ).resolves.not.toThrow();
    }

    for (const file of output.files) {
      if (!file.sql.trim()) {
        continue;
      }
      try {
        await testPool.query(file.sql);
      } catch (error) {
        throw new Error(
          `Declarative export execution failed for ${file.path} (order ${file.order})`,
          { cause: error },
        );
      }
    }

    const finalCatalog = await extractCatalog(testPool);
    const exportChanges = sortedChanges.filter(
      (change) => change.operation !== "drop",
    );
    const { hash: finalFingerprint } = buildPlanScopeFingerprint(
      finalCatalog,
      exportChanges,
    );

    if (finalFingerprint !== output.target.fingerprint) {
      const remainingChanges = diffCatalogs(finalCatalog, branchCatalog);
      const remainingFiltered = integrationFilter
        ? remainingChanges.filter((change) => integrationFilter(change))
        : remainingChanges;
      const sortedRemaining = sortChanges(
        { mainCatalog: finalCatalog, branchCatalog },
        remainingFiltered,
      );
      const remainingSql = sortedRemaining
        .map((c) => c.serialize())
        .join(";\n");
      const remainingSummary = sortedRemaining.map((c) => ({
        change: c.constructor.name,
        op: c.operation,
        objectType: c.objectType,
        scope: (c as { scope?: string }).scope ?? "object",
        creates: c.creates,
        drops: c.drops,
        requires: c.requires,
      }));
      console.error(
        "[declarative-export] fingerprint mismatch\n target=%s\n post=%s\n remainingSummary=%o\n remainingSql=%s",
        output.target.fingerprint,
        finalFingerprint,
        remainingSummary,
        remainingSql,
      );
    }

    expect(finalFingerprint).toStrictEqual(output.target.fingerprint);
  } finally {
    await cleanup();
  }

  return output;
}

async function verifyNoRemainingChanges(
  mainSession: Pool,
  branchCatalog: Catalog,
  integrationFilter: Integration["filter"] | undefined,
  migrationScript: string,
): Promise<void> {
  debugTest("mainCatalogAfter: ");
  const mainCatalogAfter = await extractCatalog(mainSession);

  // Verify semantic equality by diffing the catalogs again
  // This ensures the migration produced a database state identical to the target
  const changesAfter = diffCatalogs(mainCatalogAfter, branchCatalog);

  const filteredChangesAfter = integrationFilter
    ? changesAfter.filter((change) => integrationFilter(change))
    : changesAfter;

  if (filteredChangesAfter.length === 0) {
    return;
  }

  // Sort the remaining changes for better debugging
  const sortedChangesAfter = sortChanges(
    { mainCatalog: mainCatalogAfter, branchCatalog },
    filteredChangesAfter,
  );

  const remainingSqlStatements = sortedChangesAfter.map((change) =>
    change.serialize(),
  );
  const remainingMigrationScript = remainingSqlStatements.join(";\n\n");

  // Build detailed error message
  const changeDetails = sortedChangesAfter.map((change, idx) => {
    const parts = [
      `${idx + 1}. ${change.constructor.name}`,
      `   Operation: ${change.operation}`,
      `   Object Type: ${change.objectType}`,
      `   Scope: ${change.scope || "object"}`,
    ];

    if (change.creates.length > 0) {
      parts.push(`   Creates: ${change.creates.join(", ")}`);
    }
    if (change.drops.length > 0) {
      parts.push(`   Drops: ${change.drops.join(", ")}`);
    }
    if (change.requires.length > 0) {
      parts.push(`   Requires: ${change.requires.join(", ")}`);
    }

    return parts.join("\n");
  });

  const errorMessage = [
    `Migration verification failed: Found ${changesAfter.length} remaining changes after migration`,
    "",
    "=== Remaining Changes ===",
    ...changeDetails,
    "",
    "=== SQL for Remaining Changes ===",
    remainingMigrationScript || "(no SQL generated)",
    "",
    "=== Original Migration Script ===",
    migrationScript || "(no migration script)",
  ].join("\n");

  throw new Error(errorMessage);
}

async function getPostgresMajorVersion(
  session: Pool,
): Promise<PostgresVersion> {
  const versionNum = await extractVersion(session);
  const major = Math.floor(versionNum / 10000) as PostgresVersion;
  if (!POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[major]) {
    throw new Error(
      `Unsupported PostgreSQL version: ${versionNum} (major=${major})`,
    );
  }
  return major;
}

function getDependencyStableId(depend: PgDepend): string {
  return `${depend.dependent_stable_id} -> ${depend.referenced_stable_id} :: ${depend.deptype}`;
}

function validateDependencies(
  mainCatalog: Catalog,
  branchCatalog: Catalog,
  expectedMainDependencies: PgDepend[],
  expectedBranchDependencies: PgDepend[],
) {
  const mainDependencies = new Set(
    mainCatalog.depends.reduce((acc, depend) => {
      if (
        !depend.dependent_stable_id.startsWith("unknown") &&
        !depend.referenced_stable_id.startsWith("unknown")
      ) {
        acc.add(getDependencyStableId(depend));
      }
      return acc;
    }, new Set<string>()),
  );
  const branchDependencies = new Set(
    branchCatalog.depends.reduce((acc, depend) => {
      if (
        !depend.dependent_stable_id.startsWith("unknown") &&
        !depend.referenced_stable_id.startsWith("unknown")
      ) {
        acc.add(getDependencyStableId(depend));
      }
      return acc;
    }, new Set<string>()),
  );

  const filteredMainDeps = Array.from(mainDependencies).filter(
    (dep) =>
      !dep.includes("pg_") &&
      !dep.includes("information_schema") &&
      !dep.includes("pg_toast") &&
      !dep.includes("storage") &&
      !dep.includes("auth") &&
      !dep.includes("secrets") &&
      !dep.includes("vault") &&
      !dep.includes("extensions") &&
      !dep.includes("realtime") &&
      !dep.includes("graphql") &&
      !dep.includes("defaultAcl"),
  );
  const filteredBranchDeps = Array.from(branchDependencies).filter(
    (dep) =>
      !dep.includes("pg_") &&
      !dep.includes("information_schema") &&
      !dep.includes("pg_toast") &&
      !dep.includes("storage") &&
      !dep.includes("auth") &&
      !dep.includes("secrets") &&
      !dep.includes("vault") &&
      !dep.includes("extensions") &&
      !dep.includes("realtime") &&
      !dep.includes("graphql") &&
      !dep.includes("defaultAcl"),
  );
  debugTest("mainDependencies: %O", filteredMainDeps);
  debugTest("branchDependencies: %O", filteredBranchDeps);

  // Extract dependencies from main catalog
  const expectedMainSet = new Set(
    expectedMainDependencies.map(getDependencyStableId),
  );
  const expectedBranchSet = new Set(
    expectedBranchDependencies.map(getDependencyStableId),
  );
  // Validate main dependencies
  const mainMissing = expectedMainSet.difference(mainDependencies);
  const branchMissing = expectedBranchSet.difference(branchDependencies);

  expect(mainMissing).toEqual(new Set());
  expect(branchMissing).toEqual(new Set());
}

function validateOperationOrder(
  changes: Change[],
  expectedOperationOrder: Change[],
) {
  expect(changes).toStrictEqual(expectedOperationOrder);
}
