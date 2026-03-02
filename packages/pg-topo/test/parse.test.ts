import { describe, expect, test } from "bun:test";
import { parseSqlContent } from "../src/ingest/parse";

describe("parseSqlContent", () => {
  test("sourceOffset skips leading whitespace so statement id points to first character", async () => {
    const content = "  \n\t create table public.t(i int);";
    const result = await parseSqlContent(content, "test.sql");
    expect(result.statements.length).toBe(1);
    const stmt = result.statements[0];
    expect(stmt).toBeDefined();
    expect(stmt?.id.sourceOffset).toBeDefined();
    const offset = stmt?.id.sourceOffset ?? -1;
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(content.length);
    expect(/\s/.test(content[offset] ?? "")).toBe(false);
    expect(content.slice(offset).startsWith("create")).toBe(true);
  });
});
