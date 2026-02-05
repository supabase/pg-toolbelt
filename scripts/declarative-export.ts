import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { diffCatalogs } from "../src/core/catalog.diff.ts";
import { extractCatalog } from "../src/core/catalog.model.ts";
import { exportDeclarativeSchema } from "../src/core/export/index.ts";
import { createPool } from "../src/core/postgres-config.ts";
import { sortChanges } from "../src/core/sort/sort-changes.ts";

const sourceUrl = process.env.SOURCE_URL!;
const targetUrl = process.env.TARGET_URL!;
const outputDir = path.resolve("declarative-schemas");

const sourcePool = createPool(sourceUrl);
const targetPool = createPool(targetUrl);

try {
  const sourceCatalog = await extractCatalog(sourcePool);
  const targetCatalog = await extractCatalog(targetPool);
  const ctx = { mainCatalog: sourceCatalog, branchCatalog: targetCatalog };

  const changes = diffCatalogs(sourceCatalog, targetCatalog);
  const sortedChanges = sortChanges(ctx, changes);

  const output = exportDeclarativeSchema(ctx, sortedChanges);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const file of output.files) {
    const filePath = path.join(outputDir, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.sql);
  }

  const orderPath = path.join(outputDir, "order.json");
  const orderedFiles = output.files.map((file) => file.path);
  await writeFile(orderPath, `${JSON.stringify(orderedFiles, null, 2)}\n`);

  console.log(`Wrote ${output.files.length} files to ${outputDir}`);
} finally {
  await sourcePool.end();
  await targetPool.end();
}
