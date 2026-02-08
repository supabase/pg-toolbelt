import { describe, it, expect } from "vitest";
import { isWordChar, readDollarTag, walkSql } from "./sql-scanner.ts";

describe("isWordChar", () => {
  it("returns true for letters, digits, and underscore", () => {
    for (const ch of ["a", "z", "A", "Z", "0", "9", "_"]) {
      expect(isWordChar(ch)).toBe(true);
    }
  });

  it("returns false for spaces, parens, and symbols", () => {
    for (const ch of [" ", "(", ")", ",", ";", ".", "-", "+"]) {
      expect(isWordChar(ch)).toBe(false);
    }
  });
});

describe("readDollarTag", () => {
  it("reads $$ tag", () => {
    expect(readDollarTag("$$body$$", 0)).toBe("$$");
  });

  it("reads named tag like $fn$", () => {
    expect(readDollarTag("$fn$body$fn$", 0)).toBe("$fn$");
  });

  it("reads $body$ tag", () => {
    expect(readDollarTag("$body$content$body$", 0)).toBe("$body$");
  });

  it("returns null for non-tag like $1+2", () => {
    expect(readDollarTag("$1+2", 0)).toBeNull();
  });

  it("returns null when closing $ is missing", () => {
    expect(readDollarTag("$abc", 0)).toBeNull();
  });

  it("returns null when char at start is not $", () => {
    expect(readDollarTag("abc", 0)).toBeNull();
  });
});

describe("walkSql", () => {
  it("skips single-quoted strings", () => {
    const chars: string[] = [];
    walkSql("a 'hello' b", (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("skips single-quoted strings with '' escapes", () => {
    const chars: string[] = [];
    walkSql("a 'it''s' b", (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("skips double-quoted identifiers", () => {
    const chars: string[] = [];
    walkSql('a "col" b', (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("skips double-quoted identifiers with \"\" escapes", () => {
    const chars: string[] = [];
    walkSql('a "col""name" b', (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("skips line comments", () => {
    const chars: string[] = [];
    walkSql("a -- comment\nb", (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a b");
  });

  it("skips block comments", () => {
    const chars: string[] = [];
    walkSql("a /* block */ b", (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("skips dollar-quoted blocks", () => {
    const chars: string[] = [];
    walkSql("a $$body$$ b", (_, char) => { chars.push(char); });
    expect(chars.join("")).toBe("a  b");
  });

  it("tracks parenthesis depth correctly", () => {
    const depths: [string, number][] = [];
    walkSql("a(b(c)d)e", (_, char, depth) => {
      depths.push([char, depth]);
    }, { trackDepth: true });
    expect(depths).toEqual([
      ["a", 0],
      ["(", 0],
      ["b", 1],
      ["(", 1],
      ["c", 2],
      [")", 1],
      ["d", 1],
      [")", 0],
      ["e", 0],
    ]);
  });

  it("respects startIndex option", () => {
    const chars: string[] = [];
    walkSql("abcde", (_, char) => { chars.push(char); }, { startIndex: 2 });
    expect(chars.join("")).toBe("cde");
  });

  it("calls onSkipped for skipped content", () => {
    const skipped: string[] = [];
    walkSql("a 'x' b", () => {}, { onSkipped: (chunk) => { skipped.push(chunk); } });
    expect(skipped).toEqual(["'", "x", "'"]);
  });

  it("stops early when callback returns false", () => {
    const chars: string[] = [];
    walkSql("abcde", (_, char) => {
      chars.push(char);
      if (char === "c") return false;
    });
    expect(chars.join("")).toBe("abc");
  });
});
