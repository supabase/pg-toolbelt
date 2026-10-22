/**
 * Corpus-wide export fidelity gate: `load(export(db)) ≡ db` for every corpus
 * scenario side (a.sql, b.sql) and every export layout.
 *
 * The proof loop (`engine.test.ts`) gates plan/apply but never round-trips
 * `exportSqlFiles` → `loadSqlFiles`, which is the path the Supabase CLI
 * declarative workflow takes (and where #438, #475, #512, #520, #527 landed).
 *
 * Each worker owns a fresh stock cluster pair (source, shadow) and loads in
 * `isolatedCluster` mode so role files replay for real; roles and databases
 * are reset between cases. Honours PGDELTA_NEXT_SHARD / PGDELTA_NEXT_ONLY and
 * PGDELTA_NEXT_CONCURRENCY (workers, one cluster pair each).
 *
 * Docker required.
 */
import { writeSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import {
  exportSqlFiles,
  type ExportOptions,
} from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { settleDesired } from "../src/frontends/settle-desired.ts";
import { type Cluster, startStockCluster } from "./containers.ts";
import {
  ensureCreateroleApplier,
  grantDatabaseToCreateroleApplier,
  poolAsCreateroleApplier,
} from "./createrole-applier.ts";
import { loadCorpus, type Scenario } from "./corpus.ts";

const LAYOUTS: NonNullable<ExportOptions["layout"]>[] = [
  "by-object",
  "ordered",
  "grouped",
];

/** `<scenario>/<a|b>` → tracking reference. A listed case must still fail, so a
 *  fix that makes it pass forces the entry's removal. */
const HASH_MISMATCH = "rootHash differs after reload";
const FOLLOW_UPS =
  "docs/roadmap/pg-delta-next-follow-ups.md#pr-550--export-round-trip-gate-known-gaps";
const KNOWN_GAPS = new Map<string, string>([
  [
    "partitioned-table-operations--subpartition-index-own-options/a",
    FOLLOW_UPS,
  ],
  [
    "partitioned-table-operations--subpartition-index-own-options/b",
    FOLLOW_UPS,
  ],
]);

interface Case {
  scenario: Scenario;
  side: "a" | "b";
}

const CORPUS = loadCorpus();
const CASES: Case[] = CORPUS.flatMap((scenario) => [
  { scenario, side: "a" as const },
  { scenario, side: "b" as const },
]);

const CONCURRENCY = Math.max(
  1,
  Math.floor(Number(process.env["PGDELTA_NEXT_CONCURRENCY"] ?? "1")) || 1,
);

// The container superuser, and the CREATEROLE applier login the harness
// provisions on both clusters, exist on every shadow already.
function dropHarnessRoles(sql: string): string {
  return sql
    .split("\n")
    .filter(
      (line) =>
        !/^CREATE ROLE "?(test|crl_applier)"?[\s;]/.test(line) &&
        !line.startsWith('GRANT "crl_applier" TO "test";'),
    )
    .join("\n");
}

async function roundTrip(
  source: Cluster,
  shadow: Cluster,
  c: Case,
): Promise<string[]> {
  const failures: string[] = [];
  const src = await source.createDb("src");
  try {
    // Match engine.test.ts: a non-superuser CREATEROLE applier produces the
    // implicit bootstrap ADMIN memberships the scenario exists to cover.
    if (c.scenario.meta.createroleApplier === true) {
      await ensureCreateroleApplier(source);
      await ensureCreateroleApplier(shadow);
      await grantDatabaseToCreateroleApplier(src);
      const applier = poolAsCreateroleApplier(src);
      try {
        await applier.query(c.scenario[c.side]);
      } finally {
        await applier.end();
      }
    } else {
      await src.pool.query(c.scenario[c.side]);
    }
    const sourceFb = (await extract(src.pool)).factBase;
    for (const layout of LAYOUTS) {
      const baseRoles = await shadow.listRoles();
      const dst = await shadow.createDb("shadow");
      try {
        const files = exportSqlFiles(sourceFb, { layout }).map((f) =>
          /cluster[_/]roles/.test(f.name)
            ? { ...f, sql: dropHarnessRoles(f.sql) }
            : f,
        );
        const loaded = await loadSqlFiles(files, dst.pool, {
          mode: "isolatedCluster",
        });
        let fb = loaded.factBase;
        if (c.scenario.meta.settleDesired === true) {
          fb = (await settleDesired(dst.pool, sourceFb, fb)).factBase;
        }
        if (fb.rootHash !== sourceFb.rootHash) {
          failures.push(`${layout}: ${HASH_MISMATCH}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failures.push(`${layout}: ${msg.split("\n").slice(0, 5).join("\n")}`);
      } finally {
        await dst.drop();
        await shadow.dropRolesExcept(baseRoles, { strict: true });
      }
    }
  } finally {
    await src.drop();
    await shadow.adminPool.query('DROP ROLE IF EXISTS "crl_applier"');
  }
  return failures;
}

describe("export: corpus round-trip fidelity (all layouts)", () => {
  test(`${CASES.length} scenario sides x ${LAYOUTS.length} layouts`, async () => {
    const report: string[] = [];
    const unexpectedPass: string[] = [];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      const [source, shadow] = await Promise.all([
        startStockCluster(),
        startStockCluster(),
      ]);
      try {
        const major = await source.pgMajor();
        const baseRoles = await source.listRoles();
        for (let i = cursor++; i < CASES.length; i = cursor++) {
          const c = CASES[i] as Case;
          const minVersion = c.scenario.meta.minVersion;
          if (minVersion !== undefined && major < minVersion) continue;
          const key = `${c.scenario.name}/${c.side}`;
          let failures: string[];
          try {
            failures = await roundTrip(source, shadow, c);
          } finally {
            await source.dropRolesExcept(baseRoles, { strict: true });
          }
          const known = KNOWN_GAPS.get(key);
          if (known !== undefined) {
            // A pinned gap must still fail exactly as recorded on every
            // layout; any other outcome is a fix or a new regression.
            const pinned = LAYOUTS.map((l) => `${l}: ${HASH_MISMATCH}`);
            if (failures.length === 0) {
              unexpectedPass.push(`${key} (${known})`);
              continue;
            }
            if (failures.join("\n") === pinned.join("\n")) continue;
          }
          if (failures.length > 0) {
            const detail = `${key}\n  ${failures.join("\n  ")}`;
            report.push(detail);
            writeSync(2, `\nFAIL ${detail}\n`);
          }
        }
      } finally {
        await Promise.all([source.stop(), shadow.stop()]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, CASES.length) }, worker),
    );
    expect(unexpectedPass).toEqual([]);
    expect(report).toEqual([]);
  }, 3_600_000);
});
