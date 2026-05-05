/**
 * Optional: emit SQL to stdout or a file (for debugging / inspection).
 * E2E bench calls `generateLargeSchemaSql()` in-process — no fixture file required.
 *
 * Usage:
 *   bun bench/generate-large-schema.ts
 *   BENCH_TABLE_COUNT=200 bun bench/generate-large-schema.ts --out /tmp/schema.sql
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateLargeSchemaSql } from "./large-schema-generator.ts";

const n = Number(process.env.BENCH_TABLE_COUNT ?? "400");
if (!Number.isInteger(n) || n < 1 || n > 50_000) {
  console.error(
    `BENCH_TABLE_COUNT must be integer 1..50000, got ${process.env.BENCH_TABLE_COUNT ?? "400"}`,
  );
  process.exit(1);
}
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

const sql = generateLargeSchemaSql({
  tableCount: n,
  includeSecurityLabels: process.env.BENCH_SECURITY_LABELS === "1",
});

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, sql, "utf-8");
  console.error(`Wrote ${outPath} (${n} tables)`);
} else {
  process.stdout.write(sql);
}
