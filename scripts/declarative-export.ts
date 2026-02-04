import { Pool } from "pg";
import { diffCatalogs } from "../src/core/catalog.diff.ts";
import { extractCatalog } from "../src/core/catalog.model.ts";
import { exportDeclarativeSchema } from "../src/core/export/index.ts";
import { sortChanges } from "../src/core/sort/sort-changes.ts";

const sourceUrl = process.env.SOURCE_URL!;
const targetUrl = process.env.TARGET_URL!;

const sourcePool = new Pool({ connectionString: sourceUrl });
const targetPool = new Pool({ connectionString: targetUrl });

const sourceCatalog = await extractCatalog(sourcePool);
const targetCatalog = await extractCatalog(targetPool);
const ctx = { mainCatalog: sourceCatalog, branchCatalog: targetCatalog };

const changes = diffCatalogs(sourceCatalog, targetCatalog);
const sortedChanges = sortChanges(ctx, changes);

const output = exportDeclarativeSchema(ctx, sortedChanges);
console.log(output.files.map((f) => f.path));

// Optional: execute into a fresh database for validation
// const destPool = new Pool({ connectionString: process.env.DEST_URL! });
// for (const file of output.files) {
//   if (file.sql.trim()) await destPool.query(file.sql);
// }
// await destPool.end();

await sourcePool.end();
await targetPool.end();
