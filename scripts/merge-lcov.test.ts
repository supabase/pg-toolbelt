import { expect, test } from "bun:test";
import {
  isBaselineArtifact,
  mergeHybrid,
  mergeWithBaseline,
  parseLcovRecords,
  serializeLcov,
} from "./merge-lcov.ts";

function lcovRecord(sf: string, da: [number, number][], other: string[] = []): string {
  const lines = ["TN:", `SF:${sf}`, ...other];
  for (const [lineNum, count] of da) {
    lines.push(`DA:${lineNum},${count}`);
  }
  lines.push(`LF:${da.length}`);
  lines.push(`LH:${da.filter(([, c]) => c > 0).length}`);
  lines.push("end_of_record");
  return lines.join("\n");
}

test("baseline-only merge (no overlays) preserves data exactly", () => {
  const lcov = lcovRecord("src/foo.ts", [
    [1, 1],
    [2, 0],
    [3, 5],
  ]);
  const baseline = parseLcovRecords(lcov);
  const merged = mergeWithBaseline(baseline, []);
  const out = serializeLcov(merged);
  const reparsed = parseLcovRecords(out);
  expect(reparsed.size).toBe(1);
  const rec = reparsed.get("src/foo.ts");
  expect(rec).toBeDefined();
  expect(rec?.da.get(1)).toBe(1);
  expect(rec?.da.get(2)).toBe(0);
  expect(rec?.da.get(3)).toBe(5);
  expect(rec?.da.size).toBe(3);
  expect(out).toContain("LF:3");
  expect(out).toContain("LH:2");
});

test("overlay adds hit counts for existing lines", () => {
  const base = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 0],
    ]),
  );
  const overlay = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 3],
    ]),
  );
  const merged = mergeWithBaseline(base, [overlay]);
  const rec = merged.get("src/a.ts");
  expect(rec?.da.get(1)).toBe(1);
  expect(rec?.da.get(2)).toBe(3);
});

test("overlay does NOT add new DA lines", () => {
  const base = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 0],
    ]),
  );
  const overlay = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 0],
      [3, 10],
      [4, 20],
    ]),
  );
  const merged = mergeWithBaseline(base, [overlay]);
  const rec = merged.get("src/a.ts");
  expect(rec?.da.size).toBe(2);
  expect(rec?.da.has(3)).toBe(false);
  expect(rec?.da.has(4)).toBe(false);
});

test("multiple overlays use max of all counts", () => {
  const base = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 2],
      [2, 0],
    ]),
  );
  const o1 = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 5],
      [2, 0],
    ]),
  );
  const o2 = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 3],
      [2, 7],
    ]),
  );
  const merged = mergeWithBaseline(base, [o1, o2]);
  const rec = merged.get("src/a.ts");
  expect(rec?.da.get(1)).toBe(5);
  expect(rec?.da.get(2)).toBe(7);
});

test("files in overlay but not in baseline are ignored", () => {
  const base = parseLcovRecords(lcovRecord("src/a.ts", [[1, 1]]));
  const overlay = parseLcovRecords(
    lcovRecord("src/b.ts", [
      [1, 99],
      [2, 99],
    ]),
  );
  const merged = mergeWithBaseline(base, [overlay]);
  expect(merged.size).toBe(1);
  expect(merged.has("src/a.ts")).toBe(true);
  expect(merged.has("src/b.ts")).toBe(false);
});

test("files in baseline but not in overlay keep baseline counts", () => {
  const baseMap = parseLcovRecords(
    lcovRecord("src/a.ts", [[1, 1]]) +
      "\n" +
      lcovRecord("src/b.ts", [
        [1, 2],
        [2, 0],
      ]),
  );
  const overlay = parseLcovRecords(lcovRecord("src/a.ts", [[1, 10]]));
  const merged = mergeWithBaseline(baseMap, [overlay]);
  expect(merged.get("src/a.ts")?.da.get(1)).toBe(10);
  const bRec = merged.get("src/b.ts");
  expect(bRec).toBeDefined();
  expect(bRec?.da.get(1)).toBe(2);
  expect(bRec?.da.get(2)).toBe(0);
});

test("LF/LH recomputation is correct", () => {
  const base = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 0],
      [2, 1],
      [3, 2],
    ]),
  );
  const overlay = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 1],
      [3, 0],
    ]),
  );
  const merged = mergeWithBaseline(base, [overlay]);
  const out = serializeLcov(merged);
  expect(out).toContain("LF:3");
  expect(out).toContain("LH:3");
});

test("non-DA fields from baseline are preserved", () => {
  const lcov =
    "TN:\nSF:src/fn.ts\nFNF:2\nFNH:1\nFN:1,foo\nFN:2,bar\nFNDA:5,foo\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nend_of_record";
  const baseline = parseLcovRecords(lcov);
  const merged = mergeWithBaseline(baseline, []);
  const out = serializeLcov(merged);
  expect(out).toContain("FNF:2");
  expect(out).toContain("FNH:1");
  expect(out).toContain("FN:1,foo");
  expect(out).toContain("FN:2,bar");
  expect(out).toContain("FNDA:5,foo");
});

test("isBaselineArtifact returns true for unit and pg-topo", () => {
  expect(isBaselineArtifact("coverage-pg-delta-unit")).toBe(true);
  expect(isBaselineArtifact("coverage-pg-topo")).toBe(true);
  expect(isBaselineArtifact("coverage-pg-topo-extra")).toBe(true);
});


test("isBaselineArtifact returns false for integration and others", () => {
  expect(isBaselineArtifact("coverage-integration-pg15-shard-0")).toBe(false);
  expect(isBaselineArtifact("coverage-pg-delta-integration")).toBe(false);
  expect(isBaselineArtifact("coverage-merged")).toBe(false);
  expect(isBaselineArtifact("coverage-html")).toBe(false);
});

test("mergeHybrid uses overlay DA set and max hit for shared files", () => {
  const base = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 1],
      [2, 0],
    ]),
  );
  const overlay = parseLcovRecords(
    lcovRecord("src/a.ts", [
      [1, 5],
      [2, 7],
      [3, 99],
    ]),
  );
  const merged = mergeHybrid(base, [overlay]);
  const rec = merged.get("src/a.ts");
  expect(rec).toBeDefined();
  expect(rec?.da.get(1)).toBe(5);
  expect(rec?.da.get(2)).toBe(7);
  expect(rec?.da.get(3)).toBe(99);
  expect(rec?.da.size).toBe(3);
});

test("mergeHybrid includes overlay-only file with union of overlay DA and max hit", () => {
  const base = parseLcovRecords(lcovRecord("src/a.ts", [[1, 1]]));
  const o1 = parseLcovRecords(
    lcovRecord("src/b.ts", [
      [1, 2],
      [2, 0],
    ]),
  );
  const o2 = parseLcovRecords(
    lcovRecord("src/b.ts", [
      [1, 1],
      [2, 3],
      [3, 10],
    ]),
  );
  const merged = mergeHybrid(base, [o1, o2]);
  expect(merged.has("src/a.ts")).toBe(true);
  expect(merged.has("src/b.ts")).toBe(true);
  const bRec = merged.get("src/b.ts");
  expect(bRec?.da.get(1)).toBe(2);
  expect(bRec?.da.get(2)).toBe(3);
  expect(bRec?.da.get(3)).toBe(10);
  expect(bRec?.da.size).toBe(3);
});
