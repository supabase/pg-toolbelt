/**
 * Coverage audit: reads .coverage-artifacts/ and validates that the hybrid
 * merge does not regress coverage (baseline lines keep max hit; overlay-only
 * files are included with correct coverage). Run after `bun run coverage`
 * (or with --skip-tests). Skipped when artifacts are absent.
 *
 * Usage: bun test scripts/coverage-audit.test.ts
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";
import { packageForArtifact } from "./fix-lcov-paths.ts";
import type { LcovRecord } from "./merge-lcov.ts";
import { isBaselineArtifact, parseLcovRecords } from "./merge-lcov.ts";

const repoRoot = resolve(import.meta.dir, "..");
const artifactDir = join(repoRoot, ".coverage-artifacts");
const mergedPath = join(artifactDir, "merged-lcov.info");

const hasArtifacts =
  existsSync(artifactDir) &&
  existsSync(join(artifactDir, "coverage-pg-delta-unit", "lcov.info")) &&
  existsSync(mergedPath);

interface HitTotal {
  hit: number;
  total: number;
}

interface SourceCoverage {
  unit: HitTotal | null;
  integrationBest: HitTotal | null;
  merged: HitTotal;
  naive: HitTotal;
  lostLines: number;
}

/** Union of all DA lines across records; per line use max hit count. */
function naiveMergePerPackage(
  allRecords: Map<string, LcovRecord>[],
): Map<string, LcovRecord> {
  const bySf = new Map<string, LcovRecord>();
  for (const records of allRecords) {
    for (const [sf, rec] of records) {
      const existing = bySf.get(sf);
      if (!existing) {
        bySf.set(sf, { sf, da: new Map(rec.da), other: [...rec.other] });
        continue;
      }
      for (const [lineNum, count] of rec.da) {
        const prev = existing.da.get(lineNum) ?? 0;
        if (count > prev) existing.da.set(lineNum, count);
        else if (prev === 0) existing.da.set(lineNum, count);
      }
    }
  }
  return bySf;
}

function hitTotal(rec: LcovRecord): HitTotal {
  const total = rec.da.size;
  const hit = [...rec.da.values()].filter((c) => c > 0).length;
  return { hit, total };
}

async function loadArtifacts(): Promise<{
  baselineByPkg: Map<string, Map<string, LcovRecord>>;
  overlayMapsByPkg: Map<string, Map<string, LcovRecord>[]>;
  merged: Map<string, LcovRecord>;
  allArtifactRecordsByPkg: Map<string, Map<string, LcovRecord>[]>;
  overlayDirNames: string[];
}> {
  const entries = await readdir(artifactDir, { withFileTypes: true });
  const baselineDirs: string[] = [];
  const overlayDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkg = packageForArtifact(entry.name);
    if (!pkg) continue;
    const lcovPath = join(artifactDir, entry.name, "lcov.info");
    if (!existsSync(lcovPath)) continue;
    if (isBaselineArtifact(entry.name)) {
      baselineDirs.push(entry.name);
    } else {
      overlayDirs.push(entry.name);
    }
  }

  const baselineByPkg = new Map<string, Map<string, LcovRecord>>();
  const overlayMapsByPkg = new Map<string, Map<string, LcovRecord>[]>();
  const allArtifactRecordsByPkg = new Map<string, Map<string, LcovRecord>[]>();

  for (const name of baselineDirs) {
    const pkg = packageForArtifact(name);
    if (!pkg) continue;
    const content = await readFile(join(artifactDir, name, "lcov.info"), "utf-8");
    const records = parseLcovRecords(content);
    const existing = baselineByPkg.get(pkg);
    if (existing) {
      for (const [sf, rec] of records) {
        existing.set(sf, rec);
      }
    } else {
      baselineByPkg.set(pkg, new Map(records));
    }
    const list = allArtifactRecordsByPkg.get(pkg) ?? [];
    list.push(records);
    allArtifactRecordsByPkg.set(pkg, list);
  }

  for (const name of overlayDirs) {
    const pkg = packageForArtifact(name);
    if (!pkg) continue;
    const content = await readFile(join(artifactDir, name, "lcov.info"), "utf-8");
    const records = parseLcovRecords(content);
    let list = overlayMapsByPkg.get(pkg);
    if (!list) {
      list = [];
      overlayMapsByPkg.set(pkg, list);
    }
    list.push(records);
    const allList = allArtifactRecordsByPkg.get(pkg) ?? [];
    allList.push(records);
    allArtifactRecordsByPkg.set(pkg, allList);
  }

  const mergedContent = await readFile(mergedPath, "utf-8");
  const merged = parseLcovRecords(mergedContent);

  return {
    baselineByPkg,
    overlayMapsByPkg,
    merged,
    allArtifactRecordsByPkg,
    overlayDirNames: overlayDirs,
  };
}

test.skipIf(!hasArtifacts)(
  "hybrid merge: no regression on baseline lines, overlay-only files included",
  async () => {
    const { baselineByPkg, merged, allArtifactRecordsByPkg } = await loadArtifacts();

    const missingFiles: { sf: string; pkg: string }[] = [];
    const regressions: { sf: string; lineNum: number; expected: number; got: number; pkg: string }[] = [];

    for (const [pkg, allRecords] of allArtifactRecordsByPkg) {
      const baseline = baselineByPkg.get(pkg);
      const naive = naiveMergePerPackage(allRecords);

      for (const [sf, naiveRec] of naive) {
        const mergedRec = merged.get(sf);
        const inBaseline = baseline?.has(sf);
        const baselineRec = baseline?.get(sf);
        const lineSetToCheck = inBaseline && baselineRec ? baselineRec.da : naiveRec.da;

        if (!mergedRec) {
          const hasHits = [...naiveRec.da.values()].some((c) => c > 0);
          if (hasHits) missingFiles.push({ sf, pkg });
          continue;
        }

        for (const [lineNum, count] of lineSetToCheck) {
          if (count === 0) continue;
          const mergedCount = mergedRec.da.get(lineNum) ?? 0;
          if (mergedCount < count) {
            regressions.push({ sf, lineNum, expected: count, got: mergedCount, pkg });
          }
        }
      }
    }

    if (missingFiles.length > 0) {
      console.log("\n--- Overlay-only files missing from merged ---");
      for (const { sf, pkg } of missingFiles) {
        console.log(`  [${pkg}] ${sf}`);
      }
      console.log("");
    }
    if (regressions.length > 0) {
      console.log("\n--- Baseline-line regressions (merged hit < max from sources) ---");
      for (const { sf, lineNum, expected, got, pkg } of regressions.slice(0, 20)) {
        console.log(`  [${pkg}] ${sf}:${lineNum} expected >= ${expected}, got ${got}`);
      }
      if (regressions.length > 20) {
        console.log(`  ... and ${regressions.length - 20} more`);
      }
      console.log("");
    }

    expect(missingFiles.length).toBe(0);
    expect(regressions.length).toBe(0);
  },
);

test.skipIf(!hasArtifacts)(
  "all source files from overlays with hits appear in merged output",
  async () => {
    const { baselineByPkg, overlayMapsByPkg, merged } = await loadArtifacts();

    const overlayOnlyWithHits: { sf: string; pkg: string; hit: number }[] = [];
    for (const [pkg, overlayList] of overlayMapsByPkg) {
      const baseline = baselineByPkg.get(pkg);
      const baselineHasSf = (sf: string) => baseline?.has(sf) ?? false;
      for (const recs of overlayList) {
        for (const [sf, rec] of recs) {
          const hit = [...rec.da.values()].filter((c) => c > 0).length;
          if (hit > 0 && !baselineHasSf(sf) && !merged.has(sf)) {
            overlayOnlyWithHits.push({ sf, pkg, hit });
          }
        }
      }
    }
    const unique = Array.from(
      new Map(overlayOnlyWithHits.map((o) => [o.sf, o])).values(),
    );

    if (unique.length > 0) {
      console.log("\n--- Overlay-only files (coverage completely lost) ---");
      for (const { sf, pkg, hit } of unique) {
        console.log(`  [${pkg}] ${sf}: ${hit} lines hit in overlays, 0 in merged`);
      }
      console.log("");
    }

    expect(unique.length).toBe(0);
  },
);

test.skipIf(!hasArtifacts)(
  "per-source-type coverage breakdown",
  async () => {
    const {
      baselineByPkg,
      overlayMapsByPkg,
      merged,
      allArtifactRecordsByPkg,
    } = await loadArtifacts();

    const unitArtifactNames = new Set<string>();
    const entries = await readdir(artifactDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && isBaselineArtifact(e.name)) {
        unitArtifactNames.add(e.name);
      }
    }

    const breakdown = new Map<string, SourceCoverage>();
    const allSfs = new Set<string>();
    for (const recs of merged.values()) {
      allSfs.add(recs.sf);
    }
    for (const [, allRecords] of allArtifactRecordsByPkg) {
      const naive = naiveMergePerPackage(allRecords);
      for (const sf of naive.keys()) {
        allSfs.add(sf);
      }
    }

    for (const sf of allSfs) {
      const pkg = sf.startsWith("packages/pg-delta")
        ? "pg-delta"
        : sf.startsWith("packages/pg-topo")
          ? "pg-topo"
          : null;
      if (!pkg) continue;

      const baseline = baselineByPkg.get(pkg);
      const unitRec = baseline?.get(sf);
      const overlays = overlayMapsByPkg.get(pkg) ?? [];
      let integrationBest: HitTotal | null = null;
      for (const ov of overlays) {
        const rec = ov.get(sf);
        if (rec) {
          const ht = hitTotal(rec);
          if (
            !integrationBest ||
            ht.hit > integrationBest.hit ||
            (ht.hit === integrationBest.hit && ht.total > integrationBest.total)
          ) {
            integrationBest = ht;
          }
        }
      }

      const mergedRec = merged.get(sf);
      const mergedHt = mergedRec ? hitTotal(mergedRec) : { hit: 0, total: 0 };

      const allRecords = allArtifactRecordsByPkg.get(pkg) ?? [];
      const naiveMap = naiveMergePerPackage(allRecords);
      const naiveRec = naiveMap.get(sf);
      const naiveHt = naiveRec ? hitTotal(naiveRec) : { hit: 0, total: 0 };

      let lostLines = 0;
      if (naiveRec && mergedRec) {
        for (const [lineNum, count] of naiveRec.da) {
          if (count > 0 && (mergedRec.da.get(lineNum) ?? 0) === 0) {
            lostLines++;
          }
        }
      } else if (naiveRec) {
        lostLines = [...naiveRec.da.values()].filter((c) => c > 0).length;
      }

      breakdown.set(sf, {
        unit: unitRec ? hitTotal(unitRec) : null,
        integrationBest,
        merged: mergedHt,
        naive: naiveHt,
        lostLines,
      });
    }

    const sorted = [...breakdown.entries()]
      .filter(([, v]) => v.lostLines > 0)
      .sort((a, b) => b[1].lostLines - a[1].lostLines);

    console.log("\n--- Per-source coverage breakdown (top 20 by lost lines) ---");
    console.log(
      "  sf | unit hit/total | integrationBest hit/total | merged | naive | lost",
    );
    for (const [sf, v] of sorted.slice(0, 20)) {
      const u = v.unit ? `${v.unit.hit}/${v.unit.total}` : "-";
      const i = v.integrationBest
        ? `${v.integrationBest.hit}/${v.integrationBest.total}`
        : "-";
      console.log(
        `  ${sf} | ${u} | ${i} | ${v.merged.hit}/${v.merged.total} | ${v.naive.hit}/${v.naive.total} | ${v.lostLines}`,
      );
    }
    if (sorted.length > 20) {
      console.log(`  ... and ${sorted.length - 20} more files with lost lines`);
    }
    console.log("");

    expect(breakdown.size).toBeGreaterThan(0);
  },
);
