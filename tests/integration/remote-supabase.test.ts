import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { diffCatalogs } from "../../src/catalog.diff.ts";
import { extractCatalog } from "../../src/catalog.model.ts";
import type { MainOptions } from "../../src/main.ts";
import { postgresConfig } from "../../src/main.ts";
import { RevokeProcedurePrivileges } from "../../src/objects/procedure/changes/procedure.privilege.ts";
import { AlterRoleSetOptions } from "../../src/objects/role/changes/role.alter.ts";
import {
  GrantRoleDefaultPrivileges,
  GrantRoleMembership,
  RevokeRoleDefaultPrivileges,
  RevokeRoleMembership,
} from "../../src/objects/role/changes/role.privilege.ts";
import { sortChanges } from "../../src/sort/sort-changes.ts";
import { getTest } from "../utils.ts";

const test = getTest(17);

// Test to run manually.
// Don't forget to define the DATABASE_URL environment variable to connect to the remote Supabase instance.
test("dump empty remote supabase into vanilla postgres", async ({ db }) => {
  const { main } = db;

  // biome-ignore lint/style/noNonNullAssertion: DATABASE_URL is set in the environment
  const remote = postgres(process.env.DATABASE_URL!, postgresConfig);

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(main),
    extractCatalog(remote),
  ]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  const options: MainOptions = {
    filter: (_context, change) => {
      // ALTER ROLE postgres WITH NOSUPERUSER;
      const isAlterRolePostgresWithNosuperuser =
        change instanceof AlterRoleSetOptions &&
        change.role.name === "postgres" &&
        change.options.includes("NOSUPERUSER");
      // Extensions that are not built-in are not supported
      const isExtension =
        change.objectType === "extension" &&
        change.extension.name !== '"uuid-ossp"';
      const extensionRoleNames = [
        "pgsodium_keyiduser",
        "pgsodium_keyholder",
        "pgsodium_keymaker",
      ];
      // Filter out default privilege statements involving extension roles or extension schemas
      const extensionSchemaNames = ["pgsodium", "pgsodium_masks"];
      const isDefaultPrivilegeWithExtension =
        (change instanceof GrantRoleDefaultPrivileges ||
          change instanceof RevokeRoleDefaultPrivileges) &&
        (extensionRoleNames.includes(change.grantee) ||
          (change.inSchema !== null &&
            extensionSchemaNames.includes(change.inSchema)));

      return (
        !isAlterRolePostgresWithNosuperuser &&
        !isExtension &&
        !isDefaultPrivilegeWithExtension
      );
    },
  };

  let filteredChanges = options.filter
    ? changes.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!({ mainCatalog, branchCatalog }, change),
      )
    : changes;

  if (filteredChanges.length === 0) {
    return null;
  }

  // randomly sort the changes to test the logical sorting
  filteredChanges = filteredChanges.sort(() => {
    return Math.random() - 0.5;
  });

  const sortedChanges = sortChanges(
    { mainCatalog, branchCatalog },
    filteredChanges,
  );

  const hasRoutineChanges = sortedChanges.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
  const sessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const migrationScript = `${[
    ...sessionConfig,
    ...sortedChanges.map((change) => {
      return (
        options.serialize?.({ mainCatalog, branchCatalog }, change) ??
        change.serialize()
      );
    }),
  ].join(";\n\n")};`;

  const reportDir = join(__dirname, "diff-reports");
  await mkdir(reportDir, { recursive: true });

  try {
    await main.unsafe(migrationScript);

    // Verify that the migration was successful by diffing again
    const [mainCatalogAfter, branchCatalogAfter] = await Promise.all([
      extractCatalog(main),
      extractCatalog(remote),
    ]);

    const changesAfter = diffCatalogs(mainCatalogAfter, branchCatalogAfter);

    const filteredChangesAfter = options.filter
      ? changesAfter.filter((change) =>
          // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
          options.filter!(
            {
              mainCatalog: mainCatalogAfter,
              branchCatalog: branchCatalogAfter,
            },
            change,
          ),
        )
      : changesAfter;

    // Verify that there are no remaining changes
    if (filteredChangesAfter.length > 0) {
      // Log index differences for debugging
      const indexDrops = filteredChangesAfter.filter(
        (change) =>
          change.objectType === "index" && change.operation === "drop",
      );
      const indexCreates = filteredChangesAfter.filter(
        (change) =>
          change.objectType === "index" && change.operation === "create",
      );

      const indexDiffLog: string[] = [];
      if (indexDrops.length > 0 || indexCreates.length > 0) {
        indexDiffLog.push("## Index Catalog Differences\n");

        for (const dropChange of indexDrops) {
          if (dropChange.objectType !== "index") continue;
          const indexId = dropChange.index.stableId;
          const mainIndex = mainCatalogAfter.indexes[indexId];
          const branchIndex = branchCatalogAfter.indexes[indexId];

          indexDiffLog.push(`### Index: ${indexId}\n`);
          indexDiffLog.push("**Main Catalog (after migration):**\n");
          indexDiffLog.push("```json");
          indexDiffLog.push(
            JSON.stringify(
              {
                definition: mainIndex?.definition,
                storage_params: mainIndex?.storage_params,
                statistics_target: mainIndex?.statistics_target,
                tablespace: mainIndex?.tablespace,
                owner: mainIndex?.owner,
                index_type: mainIndex?.index_type,
                is_unique: mainIndex?.is_unique,
                nulls_not_distinct: mainIndex?.nulls_not_distinct,
                immediate: mainIndex?.immediate,
                key_columns: mainIndex?.key_columns,
                column_collations: mainIndex?.column_collations,
                operator_classes: mainIndex?.operator_classes,
                column_options: mainIndex?.column_options,
                index_expressions: mainIndex?.index_expressions,
                partial_predicate: mainIndex?.partial_predicate,
              },
              null,
              2,
            ),
          );
          indexDiffLog.push("```\n");

          indexDiffLog.push("**Branch Catalog (target):**\n");
          indexDiffLog.push("```json");
          indexDiffLog.push(
            JSON.stringify(
              {
                definition: branchIndex?.definition,
                storage_params: branchIndex?.storage_params,
                statistics_target: branchIndex?.statistics_target,
                tablespace: branchIndex?.tablespace,
                owner: branchIndex?.owner,
                index_type: branchIndex?.index_type,
                is_unique: branchIndex?.is_unique,
                nulls_not_distinct: branchIndex?.nulls_not_distinct,
                immediate: branchIndex?.immediate,
                key_columns: branchIndex?.key_columns,
                column_collations: branchIndex?.column_collations,
                operator_classes: branchIndex?.operator_classes,
                column_options: branchIndex?.column_options,
                index_expressions: branchIndex?.index_expressions,
                partial_predicate: branchIndex?.partial_predicate,
              },
              null,
              2,
            ),
          );
          indexDiffLog.push("```\n");
        }
      }

      // Debug specific function: storage.add_prefixes
      const procedureRevokes = filteredChangesAfter.filter((change) => {
        if (change.objectType !== "procedure") return false;
        const proc = change.procedure;
        return proc.name === "add_prefixes" && proc.schema === "storage";
      });
      if (procedureRevokes.length > 0) {
        const procedureId = "procedure:storage.add_prefixes(text, text)";
        const mainProc = mainCatalogAfter.procedures[procedureId];
        const branchProc = branchCatalogAfter.procedures[procedureId];

        indexDiffLog.push("## Procedure Debug: storage.add_prefixes\n");
        indexDiffLog.push("### Main Catalog (after migration)\n");
        indexDiffLog.push("```json");
        indexDiffLog.push(
          JSON.stringify(
            {
              owner: mainProc?.owner,
              privileges: mainProc?.privileges,
            },
            null,
            2,
          ),
        );
        indexDiffLog.push("```\n");

        indexDiffLog.push("### Branch Catalog (target)\n");
        indexDiffLog.push("```json");
        indexDiffLog.push(
          JSON.stringify(
            {
              owner: branchProc?.owner,
              privileges: branchProc?.privileges,
            },
            null,
            2,
          ),
        );
        indexDiffLog.push("```\n");

        indexDiffLog.push("### Remaining Changes\n");
        for (const change of procedureRevokes) {
          if (change.objectType !== "procedure") continue;
          const proc = change.procedure;
          if (proc.name === "add_prefixes" && proc.schema === "storage") {
            if (change instanceof RevokeProcedurePrivileges) {
              indexDiffLog.push(
                `- ${change.serialize()} (grantee: ${change.grantee}, privileges: ${JSON.stringify(change.privileges)})\n`,
              );
            } else {
              indexDiffLog.push(`- ${change.serialize()}\n`);
            }
          }
        }
      }

      // Generate second migration script for remaining changes
      const sortedChangesAfter = sortChanges(
        { mainCatalog: mainCatalogAfter, branchCatalog: branchCatalogAfter },
        filteredChangesAfter,
      );

      const hasRoutineChangesAfter = sortedChangesAfter.some(
        (change) =>
          change.objectType === "procedure" ||
          change.objectType === "aggregate",
      );
      const sessionConfigAfter = hasRoutineChangesAfter
        ? ["SET check_function_bodies = false"]
        : [];

      const secondMigrationScript = `${[
        ...sessionConfigAfter,
        ...sortedChangesAfter.map((change) => {
          return (
            options.serialize?.(
              {
                mainCatalog: mainCatalogAfter,
                branchCatalog: branchCatalogAfter,
              },
              change,
            ) ?? change.serialize()
          );
        }),
      ].join(";\n\n")};`;

      // Save error report with both migration scripts
      const errorFilename = `error-dump-empty-remote-supabase-into-vanilla-postgres.md`;
      const errorFilepath = join(reportDir, errorFilename);
      const errorContent = `
# Migration Error Report

## Error

\`\`\`
Migration verification failed: Found ${filteredChangesAfter.length} remaining changes after migration
\`\`\`

${indexDiffLog.length > 0 ? indexDiffLog.join("\n") : ""}

## First Migration Script

\`\`\`sql
${migrationScript}
\`\`\`

## Second Migration Script (Remaining Changes)

\`\`\`sql
${secondMigrationScript}
\`\`\`
`;
      await writeFile(errorFilepath, errorContent);

      throw new Error(
        `Migration verification failed: Found ${filteredChangesAfter.length} remaining changes after migration`,
      );
    }

    // Save success report
    const successFilename = `success-dump-empty-remote-supabase-into-vanilla-postgres.md`;
    const successFilepath = join(reportDir, successFilename);
    const successContent = `
# Migration Success Report

## Migration Script

\`\`\`sql
${migrationScript}
\`\`\`

## Verification

After running the migration, the databases were diffed again and verified to have no remaining changes.
`;
    await writeFile(successFilepath, successContent);
  } catch (error) {
    // Only save error report if it hasn't been saved already (i.e., migration execution failed)
    if (
      error instanceof Error &&
      !error.message.includes("Migration verification failed")
    ) {
      // Save error report
      const errorFilename = `error-dump-empty-remote-supabase-into-vanilla-postgres.md`;
      const errorFilepath = join(reportDir, errorFilename);
      const errorContent = `
# Migration Error Report

## Error

\`\`\`
${error.message}
\`\`\`

## First Migration Script

\`\`\`sql
${migrationScript}
\`\`\`
`;
      await writeFile(errorFilepath, errorContent);
    }
    throw error;
  } finally {
    await remote.end();
  }
});
