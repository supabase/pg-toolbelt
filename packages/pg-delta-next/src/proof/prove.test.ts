/**
 * Unit tests for the pure proof verdict logic (src/proof/prove.ts
 * detectViolations). No Docker / database required.
 *
 * Hardening Item 2 / review #3: row-count preservation is not content
 * preservation. A content change on a table the plan did NOT touch is a
 * data-preservation violation; on a table the plan alters it is expected. The
 * proof reports honest per-table coverage instead of a bare boolean.
 */
import { describe, expect, test } from "bun:test";
import { detectViolations } from "./prove.ts";

// TableStat is module-internal; the tests only need its shape.
type Stat = {
  rows: number;
  relfilenode: string;
  schemaSig: string;
  content?: string;
};

const ctx = (over: Partial<Parameters<typeof detectViolations>[2]> = {}) => ({
  recreatedTables: new Set<string>(),
  declaredRewriteTables: new Set<string>(),
  ...over,
});

const m = (entries: Record<string, Stat>) =>
  new Map<string, Stat>(Object.entries(entries));

const SIG = "id:23"; // a stable column signature

describe("detectViolations — content + coverage (review #3)", () => {
  test("row count change is a data violation", () => {
    const before = m({
      "public.t": { rows: 3, relfilenode: "1", schemaSig: SIG, content: "a" },
    });
    const after = m({
      "public.t": { rows: 2, relfilenode: "1", schemaSig: SIG, content: "b" },
    });
    const v = detectViolations(before, after, ctx());
    expect(v.dataViolations).toEqual([
      { table: "public.t", before: 3, after: 2 },
    ]);
  });

  test("content change with UNCHANGED schema is a violation (count held)", () => {
    const before = m({
      "public.t": { rows: 2, relfilenode: "1", schemaSig: SIG, content: "a" },
    });
    const after = m({
      "public.t": { rows: 2, relfilenode: "1", schemaSig: SIG, content: "b" },
    });
    const v = detectViolations(before, after, ctx());
    expect(v.dataViolations).toEqual([
      { table: "public.t", before: 2, after: 2, contentChanged: true },
    ]);
  });

  test("content change under a SCHEMA change is expected, not a violation", () => {
    // e.g. a column propagated from a partitioned parent: whole-row text
    // changes but no data was lost — schemaSig differs, so only count is trusted
    const before = m({
      "public.t": { rows: 2, relfilenode: "1", schemaSig: SIG, content: "a" },
    });
    const after = m({
      "public.t": {
        rows: 2,
        relfilenode: "2",
        schemaSig: `${SIG},note:25`,
        content: "b",
      },
    });
    const v = detectViolations(
      before,
      after,
      ctx({ declaredRewriteTables: new Set(["public.t"]) }),
    );
    expect(v.dataViolations).toEqual([]);
    expect(v.rewriteViolations).toEqual([]);
  });

  test("coverage classifies content modes honestly", () => {
    const before = m({
      "public.checked": {
        rows: 1,
        relfilenode: "1",
        schemaSig: SIG,
        content: "x",
      }, // non-empty, schema stable → fingerprint
      "public.altered": {
        rows: 1,
        relfilenode: "1",
        schemaSig: SIG,
        content: "y",
      }, // non-empty, schema changed → count
      "public.empty": { rows: 0, relfilenode: "1", schemaSig: SIG }, // empty → none
    });
    const after = m({
      "public.checked": {
        rows: 1,
        relfilenode: "1",
        schemaSig: SIG,
        content: "x",
      },
      "public.altered": {
        rows: 1,
        relfilenode: "1",
        schemaSig: `${SIG},note:25`,
        content: "y2",
      },
      "public.empty": { rows: 0, relfilenode: "1", schemaSig: SIG },
    });
    const v = detectViolations(before, after, ctx());
    const mode = (t: string) =>
      v.coverage.perTable.find((p) => p.table === t)?.contentMode;
    expect(v.coverage.tablesChecked).toBe(3);
    expect(mode("public.checked")).toBe("fingerprint");
    expect(mode("public.altered")).toBe("count");
    expect(mode("public.empty")).toBe("none");
  });

  test("recreated tables are skipped with a reason, not checked", () => {
    const before = m({
      "public.t": { rows: 5, relfilenode: "1", schemaSig: SIG, content: "a" },
    });
    const after = m({
      "public.t": { rows: 0, relfilenode: "9", schemaSig: SIG, content: "" },
    });
    const v = detectViolations(
      before,
      after,
      ctx({ recreatedTables: new Set(["public.t"]) }),
    );
    expect(v.dataViolations).toEqual([]); // recreated → row/content change expected
    expect(v.coverage.tablesChecked).toBe(0);
    expect(v.coverage.tablesSkipped).toEqual([
      { table: "public.t", reason: "recreated by the plan" },
    ]);
  });
});
