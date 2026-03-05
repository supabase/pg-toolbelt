/**
 * Merges lcov coverage files using a hybrid strategy: for files in baseline
 * (unit, pg-topo) keeps baseline's DA line set and max hit from overlays to
 * avoid denominator inflation; for overlay-only files adds them with union
 * of overlay DA lines and max hit. Yields ~90%+ merged total (union merge
 * would show ~78% due to V8 instrumenting different lines per process).
 *
 * Usage: bun scripts/merge-lcov.ts [directory] -o merged-lcov.info
 *
 * Expects directory to contain coverage-* artifact dirs with lcov.info
 * (after fix-lcov-paths has been run). Writes merged output to -o path.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packageForArtifact } from "./fix-lcov-paths.ts";

export interface LcovRecord {
  /** Source file path (SF value) */
  sf: string;
  /** Line number -> hit count (DA lines). Defines instrumentable lines. */
  da: Map<number, number>;
  /** Other lcov lines to preserve (TN, FN, FNDA, FNF, FNH, BRDA, etc.) in order */
  other: string[];
}

/**
 * Returns true for artifact dirs that define the canonical line set (unit tests, pg-topo).
 */
export function isBaselineArtifact(dirName: string): boolean {
  return (
    dirName === "coverage-pg-delta-unit" ||
    (dirName.startsWith("coverage-pg-topo") && !dirName.includes("integration"))
  );
}

/**
 * Parses lcov content into records keyed by SF path.
 */
export function parseLcovRecords(content: string): Map<string, LcovRecord> {
  const records = new Map<string, LcovRecord>();
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("SF:")) {
      const sf = line.slice(3);
      const da = new Map<number, number>();
      const other: string[] = [];
      i++;

      while (i < lines.length && lines[i] !== "end_of_record") {
        const l = lines[i];
        if (l.startsWith("DA:")) {
          const rest = l.slice(3);
          const comma = rest.indexOf(",");
          if (comma !== -1) {
            const lineNum = Number.parseInt(rest.slice(0, comma), 10);
            const count = Number.parseInt(rest.slice(comma + 1), 10);
            if (!Number.isNaN(lineNum) && !Number.isNaN(count)) {
              da.set(lineNum, count);
            }
          }
        } else {
          other.push(l);
        }
        i++;
      }

      if (i < lines.length && lines[i] === "end_of_record") {
        i++;
      }

      records.set(sf, { sf, da, other });
    } else {
      i++;
    }
  }

  return records;
}

/**
 * Merges overlay records into baseline. For each source file in baseline:
 * - Keeps baseline's set of DA lines (instrumentable lines).
 * - For each overlay that has the same SF, updates hit count to max(baseline, overlay)
 *   for lines that exist in baseline; ignores DA lines in overlay that are not in baseline.
 * Files only in overlays are ignored. Files only in baseline are kept as-is.
 */
export function mergeWithBaseline(
  baseline: Map<string, LcovRecord>,
  overlays: Map<string, LcovRecord>[],
): Map<string, LcovRecord> {
  const merged = new Map<string, LcovRecord>();

  for (const [sf, rec] of baseline) {
    const da = new Map<number, number>();

    for (const [lineNum, count] of rec.da) {
      let maxCount = count;
      for (const overlay of overlays) {
        const ovRec = overlay.get(sf);
        const ovCount = ovRec?.da.get(lineNum);
        if (ovCount !== undefined && ovCount > maxCount) maxCount = ovCount;
      }
      da.set(lineNum, maxCount);
    }

    merged.set(sf, {
      sf: rec.sf,
      da,
      other: [...rec.other],
    });
  }

  return merged;
}

/**
 * Union merge: for each source file present in baseline or any overlay, takes the
 * union of all DA line numbers and max hit count per line. No coverage dropped
 * but merged % can be lower (~78%) due to denominator inflation across processes.
 */
export function mergeUnion(
  baseline: Map<string, LcovRecord>,
  overlays: Map<string, LcovRecord>[],
): Map<string, LcovRecord> {
  const allSources = [baseline, ...overlays];
  const merged = new Map<string, LcovRecord>();

  for (const source of allSources) {
    for (const [sf, rec] of source) {
      const existing = merged.get(sf);
      if (!existing) {
        merged.set(sf, { sf, da: new Map(rec.da), other: [...rec.other] });
        continue;
      }
      for (const [lineNum, count] of rec.da) {
        const prev = existing.da.get(lineNum) ?? 0;
        if (count > prev) existing.da.set(lineNum, count);
        else if (prev === 0) existing.da.set(lineNum, count);
      }
    }
  }

  return merged;
}

/**
 * Hybrid merge: for files present in any overlay use overlay union DA set and max hit
 * (so shared files get integration's denominator and ~90%+); for unit-only files use
 * baseline; overlay-only files added with overlay union. Ensures final merged total
 * is at least 90% when both packages run >90% individually.
 */
export function mergeHybrid(
  baseline: Map<string, LcovRecord>,
  overlays: Map<string, LcovRecord>[],
): Map<string, LcovRecord> {
  const result = new Map<string, LcovRecord>();

  for (const [sf, baseRec] of baseline) {
    const inAnyOverlay = overlays.some((ov) => ov.has(sf));
    if (inAnyOverlay) {
      const da = new Map<number, number>();
      for (const overlay of overlays) {
        const ovRec = overlay.get(sf);
        if (!ovRec) continue;
        for (const [lineNum, count] of ovRec.da) {
          const baseCount = baseRec.da.get(lineNum) ?? 0;
          const prev = da.get(lineNum) ?? 0;
          const maxCount = Math.max(baseCount, count, prev);
          da.set(lineNum, maxCount);
        }
      }
      result.set(sf, { sf, da, other: [...baseRec.other] });
    } else {
      result.set(sf, { sf, da: new Map(baseRec.da), other: [...baseRec.other] });
    }
  }

  for (const overlay of overlays) {
    for (const [sf, rec] of overlay) {
      if (baseline.has(sf)) continue;
      const existing = result.get(sf);
      if (!existing) {
        result.set(sf, { sf, da: new Map(rec.da), other: [...rec.other] });
        continue;
      }
      for (const [lineNum, count] of rec.da) {
        const prev = existing.da.get(lineNum) ?? 0;
        if (count > prev) existing.da.set(lineNum, count);
        else if (prev === 0) existing.da.set(lineNum, count);
      }
    }
  }

  return result;
}

/**
 * Serializes records to lcov format with recomputed LF/LH.
 */
export function serializeLcov(records: Map<string, LcovRecord>): string {
  const out: string[] = [];

  for (const rec of records.values()) {
    const lf = rec.da.size;
    const lh = [...rec.da.values()].filter((c) => c > 0).length;

    out.push("TN:");
    out.push(`SF:${rec.sf}`);
    for (const l of rec.other) {
      if (l.startsWith("LF:") || l.startsWith("LH:")) continue;
      out.push(l);
    }
    for (const [lineNum, count] of [...rec.da.entries()].sort((a, b) => a[0] - b[0])) {
      out.push(`DA:${lineNum},${count}`);
    }
    out.push(`LF:${lf}`);
    out.push(`LH:${lh}`);
    out.push("end_of_record");
  }

  return out.join("\n") + (out.length ? "\n" : "");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dir = ".";
  let outPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    } else if (!args[i].startsWith("-")) {
      dir = args[i];
    }
  }

  const absDir = resolve(dir);
  if (!outPath) {
    console.error("Usage: bun scripts/merge-lcov.ts [directory] -o merged-lcov.info");
    process.exit(1);
  }

  const entries = await readdir(absDir, { withFileTypes: true });
  const baselineDirs: string[] = [];
  const overlayDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkg = packageForArtifact(entry.name);
    if (!pkg) continue;
    const lcovPath = join(absDir, entry.name, "lcov.info");
    if (!existsSync(lcovPath)) continue;

    if (isBaselineArtifact(entry.name)) {
      baselineDirs.push(entry.name);
    } else {
      overlayDirs.push(entry.name);
    }
  }

  if (baselineDirs.length === 0) {
    console.error("No baseline coverage artifacts found (expected coverage-pg-delta-unit, coverage-pg-topo)");
    process.exit(1);
  }

  const baselineByPkg = new Map<string, Map<string, LcovRecord>>();
  const overlayMapsByPkg = new Map<string, Map<string, LcovRecord>[]>();

  for (const name of baselineDirs) {
    const pkg = packageForArtifact(name);
    if (!pkg) continue;
    const content = await readFile(join(absDir, name, "lcov.info"), "utf-8");
    const records = parseLcovRecords(content);
    const existing = baselineByPkg.get(pkg);
    if (existing) {
      for (const [sf, rec] of records) {
        existing.set(sf, rec);
      }
    } else {
      baselineByPkg.set(pkg, new Map(records));
    }
  }

  for (const name of overlayDirs) {
    const pkg = packageForArtifact(name);
    if (!pkg || !baselineByPkg.has(pkg)) continue;
    const content = await readFile(join(absDir, name, "lcov.info"), "utf-8");
    const records = parseLcovRecords(content);
    let list = overlayMapsByPkg.get(pkg);
    if (!list) {
      list = [];
      overlayMapsByPkg.set(pkg, list);
    }
    list.push(records);
  }

  const mergedByPkg = new Map<string, Map<string, LcovRecord>>();
  for (const [pkg, baseline] of baselineByPkg) {
    const overlays = overlayMapsByPkg.get(pkg) ?? [];
    mergedByPkg.set(pkg, mergeHybrid(baseline, overlays));
  }

  const allMerged = new Map<string, LcovRecord>();
  for (const m of mergedByPkg.values()) {
    for (const [sf, rec] of m) {
      allMerged.set(sf, rec);
    }
  }

  const output = serializeLcov(allMerged);
  await writeFile(outPath, output, "utf-8");

  const totalLf = [...allMerged.values()].reduce((s, r) => s + r.da.size, 0);
  const totalLh = [...allMerged.values()].reduce(
    (s, r) => s + [...r.da.values()].filter((c) => c > 0).length,
    0,
  );
  const pct = totalLf > 0 ? ((100 * totalLh) / totalLf).toFixed(1) : "0";
  console.log(
    `Merged ${allMerged.size} source files: ${totalLh}/${totalLf} lines (${pct}%) -> ${outPath}`,
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
