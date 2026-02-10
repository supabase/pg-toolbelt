import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Change } from "../src/core/change.types.ts";
import { exportDeclarativeSchema } from "../src/core/export/index.ts";
import { evaluatePattern } from "../src/core/integrations/filter/dsl.ts";
import { createPlan } from "../src/core/plan/index.ts";

const sourceUrl = process.env.SOURCE_URL!;
const targetUrl = process.env.TARGET_URL!;
const outputDir = path.resolve("declarative-schemas");

try {
  // Optional: platform-db compatibility filter. Exclude extensions that
  // require shared_preload_libraries in postgresql.conf, since the target
  // database may not have them pre-loaded. Also exclude functions/procedures
  // written in languages provided by those extensions (e.g. plv8).
  const platformDbExclusions = {
    or: [
      {
        type: "extension" as const,
        extension: ["pgaudit", "pg_cron", "plv8", "pg_stat_statements"],
      },
      { procedureLanguage: ["plv8"] },
    ],
  };
  const filter = (change: Change) =>
    !evaluatePattern(platformDbExclusions, change);

  const planResult = await createPlan(sourceUrl, targetUrl, { filter });

  if (!planResult) {
    console.log("No changes detected.");
    process.exit(0);
  }

  const output = exportDeclarativeSchema(planResult, {
    orderPrefix: true,
    mode: "simple",
  });

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

  // Generate a single combined SQL file with all statements in the correct order.
  // This is useful for tools that apply files alphabetically and don't support
  // custom ordering.
  const combinedSql = output.files
    .map((file) => `-- File: ${file.path}\n${file.sql}`)
    .join("\n\n");
  await writeFile(path.join(outputDir, "combined.sql"), combinedSql);

  console.log(
    `Wrote ${planResult.sortedChanges.length} changes to ${output.files.length} files to ${outputDir}`,
  );
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
