import postgres from "postgres";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";

export async function main(
  masterDatabaseUrl: string,
  branchDatabaseUrl: string,
) {
  const masterSql = postgres(masterDatabaseUrl);
  const branchSql = postgres(branchDatabaseUrl);

  const [masterCatalog, branchCatalog] = await Promise.all([
    extractCatalog(masterSql),
    extractCatalog(branchSql),
  ]);

  await Promise.all([masterSql.end(), branchSql.end()]);

  const changes = diffCatalogs(masterCatalog, branchCatalog);

  const migrationScript = changes
    .map((change) => change.serialize())
    .join("\n\n");

  console.log(migrationScript);

  return migrationScript;
}
