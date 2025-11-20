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
  RevokeRoleDefaultPrivileges,
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

      // Debug specific sequence: auth.refresh_tokens_id_seq
      const sequenceGrants = filteredChangesAfter.filter((change) => {
        if (change.objectType !== "sequence") return false;
        const seq = change.sequence;
        return seq.name === "refresh_tokens_id_seq" && seq.schema === "auth";
      });
      if (sequenceGrants.length > 0) {
        const sequenceId = "sequence:auth.refresh_tokens_id_seq";
        const mainSeq = mainCatalogAfter.sequences[sequenceId];
        const branchSeq = branchCatalogAfter.sequences[sequenceId];

        indexDiffLog.push("## Sequence Debug: auth.refresh_tokens_id_seq\n");
        indexDiffLog.push("### Main Catalog (after migration)\n");
        indexDiffLog.push("```json");
        indexDiffLog.push(
          JSON.stringify(
            {
              owner: mainSeq?.owner,
              privileges: mainSeq?.privileges,
              owned_by: mainSeq?.owned_by_table
                ? `${mainSeq.owned_by_schema}.${mainSeq.owned_by_table}.${mainSeq.owned_by_column}`
                : null,
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
              owner: branchSeq?.owner,
              privileges: branchSeq?.privileges,
              owned_by: branchSeq?.owned_by_table
                ? `${branchSeq.owned_by_schema}.${branchSeq.owned_by_table}.${branchSeq.owned_by_column}`
                : null,
            },
            null,
            2,
          ),
        );
        indexDiffLog.push("```\n");

        // Check what the first migration did
        const firstMigrationGrants = changes.filter((change) => {
          if (change.objectType !== "sequence") return false;
          const seq = change.sequence;
          return (
            seq.name === "refresh_tokens_id_seq" &&
            seq.schema === "auth" &&
            change.operation === "alter" &&
            "grantee" in change
          );
        });
        indexDiffLog.push("### First Migration Grants\n");
        if (firstMigrationGrants.length > 0) {
          for (const change of firstMigrationGrants) {
            if (change.objectType !== "sequence") continue;
            const seq = change.sequence;
            if (seq.name === "refresh_tokens_id_seq" && seq.schema === "auth") {
              indexDiffLog.push(`- ${change.serialize()}\n`);
            }
          }
        } else {
          indexDiffLog.push("- No grants found in first migration\n");
        }

        indexDiffLog.push("### Remaining Changes\n");
        for (const change of sequenceGrants) {
          if (change.objectType !== "sequence") continue;
          const seq = change.sequence;
          if (seq.name === "refresh_tokens_id_seq" && seq.schema === "auth") {
            if ("grantee" in change) {
              indexDiffLog.push(
                `- ${change.serialize()} (grantee: ${change.grantee}, operation: ${change.operation})\n`,
              );
            } else {
              indexDiffLog.push(`- ${change.serialize()}\n`);
            }
          }
        }

        // Debug privilege diffing
        if (mainSeq && branchSeq) {
          const mainPrivsByGrantee = new Map<string, string[]>();
          for (const p of mainSeq.privileges) {
            const arr = mainPrivsByGrantee.get(p.grantee) || [];
            arr.push(p.privilege);
            mainPrivsByGrantee.set(p.grantee, arr);
          }
          const branchPrivsByGrantee = new Map<string, string[]>();
          for (const p of branchSeq.privileges) {
            const arr = branchPrivsByGrantee.get(p.grantee) || [];
            arr.push(p.privilege);
            branchPrivsByGrantee.set(p.grantee, arr);
          }

          indexDiffLog.push("### Privilege Comparison\n");
          indexDiffLog.push("**Main privileges by grantee:**\n");
          indexDiffLog.push("```json\n");
          indexDiffLog.push(
            JSON.stringify(Object.fromEntries(mainPrivsByGrantee), null, 2),
          );
          indexDiffLog.push("\n```\n");
          indexDiffLog.push("**Branch privileges by grantee:**\n");
          indexDiffLog.push("```json\n");
          indexDiffLog.push(
            JSON.stringify(Object.fromEntries(branchPrivsByGrantee), null, 2),
          );
          indexDiffLog.push("\n```\n");
          indexDiffLog.push(
            `**Owner:** ${branchSeq.owner} (filtering owner privileges)\n`,
          );

          // Direct database query to check what PostgreSQL actually stored
          const directAclQuery = await main`
            SELECT 
              c.relname,
              c.relacl::text as relacl_raw,
              c.relowner::regrole::text as owner,
              coalesce(
                (
                  select json_agg(
                    json_build_object(
                      'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                      'privilege', x.privilege_type,
                      'grantable', x.is_grantable
                    )
                    order by x.grantee, x.privilege_type
                  )
                  from lateral aclexplode(c.relacl) as x(grantor, grantee, privilege_type, is_grantable)
                ), '[]'
              ) as privileges_json
            FROM pg_catalog.pg_class c
            INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'auth'
              AND c.relname = 'refresh_tokens_id_seq'
              AND c.relkind = 'S'
          `;

          // Verify PostgreSQL behavior: superusers don't have explicit GRANTs stored in relacl
          const postgresIsSuperuserMain = await main`
            SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres'
          `;
          const isPostgresSuperuserMain =
            postgresIsSuperuserMain[0]?.rolsuper === true;

          // Check postgres superuser status in branch (remote Supabase)
          const postgresRoleBranch = branchCatalogAfter.roles["role:postgres"];
          const isPostgresSuperuserBranch =
            postgresRoleBranch?.is_superuser === true;

          const privilegesFromAcl = directAclQuery[0]?.privileges_json || [];
          const hasPostgresInAcl = privilegesFromAcl.some(
            (p: { grantee: string }) => p.grantee === "postgres",
          );

          indexDiffLog.push("### Direct PostgreSQL Query (relacl)\n");
          indexDiffLog.push("```json\n");
          indexDiffLog.push(
            JSON.stringify(
              directAclQuery.length > 0
                ? {
                    relname: directAclQuery[0].relname,
                    relacl_raw: directAclQuery[0].relacl_raw,
                    owner: directAclQuery[0].owner,
                    privileges: directAclQuery[0].privileges_json,
                    postgres_is_superuser_main: isPostgresSuperuserMain,
                    postgres_is_superuser_branch: isPostgresSuperuserBranch,
                    postgres_in_acl: hasPostgresInAcl,
                    explanation:
                      isPostgresSuperuserMain && !isPostgresSuperuserBranch
                        ? "✓ Issue: postgres is superuser in main but NOT in branch. Branch has postgres privileges in relacl, but main doesn't store them (superuser). Our fix filters superuser privileges from branch before comparing."
                        : isPostgresSuperuserMain && isPostgresSuperuserBranch
                          ? "✓ Both are superusers - privileges shouldn't be in relacl in either"
                          : !isPostgresSuperuserMain &&
                              !isPostgresSuperuserBranch
                            ? "✓ Both are NOT superusers - privileges should be in relacl in both"
                            : "⚠ postgres is superuser in branch but NOT in main (unusual)",
                  }
                : { error: "Sequence not found" },
              null,
              2,
            ),
          );
          indexDiffLog.push("\n```\n");

          // Assert the behavior
          if (isPostgresSuperuserMain && hasPostgresInAcl) {
            throw new Error(
              "PostgreSQL assertion failed: superuser 'postgres' should NOT have explicit GRANTs in relacl, but found them in ACL",
            );
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
