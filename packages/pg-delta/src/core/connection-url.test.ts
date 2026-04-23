import { describe, expect, test } from "bun:test";
import {
  isIPv6,
  normalizeConnectionUrl,
  safeDecodeURIComponent,
} from "./connection-url.ts";

describe("isIPv6", () => {
  describe("accepted", () => {
    const accepted = [
      "::",
      "::1",
      "1::",
      "1:2:3:4:5:6:7:8",
      "2406:da18:243:740f:abda:9a5c:a92d:b3c9",
      "::ffff:192.0.2.1",
      "fe80::AbCd",
      "fe80::1%eth0",
    ];
    for (const value of accepted) {
      test(`accepts "${value}"`, () => {
        expect(isIPv6(value)).toBe(true);
      });
    }
  });

  describe("rejected", () => {
    const rejected = [
      "",
      "2406:da18:243:740f", // only 4 groups
      "1:2:3:4:5:6:7:8:9", // 9 groups
      "1::2::3", // double compression
      "gggg::1", // invalid hex
      "1.2.3.4", // pure IPv4
      "[::1]", // bracketed
      "localhost",
      "example.com",
      ":::", // malformed
    ];
    for (const value of rejected) {
      test(`rejects ${JSON.stringify(value)}`, () => {
        expect(isIPv6(value)).toBe(false);
      });
    }
  });
});

describe("normalizeConnectionUrl", () => {
  describe("normalizes percent-encoded IPv6 hosts", () => {
    test("full 8-group IPv6 becomes bracketed", () => {
      const input =
        "postgresql://user:pass@2406%3Ada18%3A243%3A740f%3Aabda%3A9a5c%3Aa92d%3Ab3c9:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[2406:da18:243:740f:abda:9a5c:a92d:b3c9]:5432/db",
      );
    });

    test("compressed ::1 form", () => {
      const input = "postgresql://user:pass@%3A%3A1:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[::1]:5432/db",
      );
    });

    test("IPv4-mapped ::ffff:192.0.2.1", () => {
      const input = "postgresql://user:pass@%3A%3Affff%3A192.0.2.1:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[::ffff:192.0.2.1]:5432/db",
      );
    });

    test("mixed-case percent triples (%3a and %3A)", () => {
      const input =
        "postgresql://user:pass@2406%3ada18%3A243%3a740f%3Aabda%3A9a5c%3Aa92d%3Ab3c9:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[2406:da18:243:740f:abda:9a5c:a92d:b3c9]:5432/db",
      );
    });

    test("preserves URL-encoded password and query string", () => {
      const input =
        "postgresql://user:p%40ss%2Fword@%3A%3A1:5432/db?sslmode=require&application_name=pgdelta";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:p%40ss%2Fword@[::1]:5432/db?sslmode=require&application_name=pgdelta",
      );
    });

    test("preserves fragment", () => {
      const input = "postgresql://user:pass@%3A%3A1:5432/db#frag";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[::1]:5432/db#frag",
      );
    });

    test("works without a port", () => {
      const input = "postgresql://user:pass@%3A%3A1/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user:pass@[::1]/db",
      );
    });

    test("works without userinfo", () => {
      const input = "postgresql://%3A%3A1:5432/db";
      expect(normalizeConnectionUrl(input)).toBe("postgresql://[::1]:5432/db");
    });

    test("works with username only (no password)", () => {
      const input = "postgresql://user@%3A%3A1:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(
        "postgresql://user@[::1]:5432/db",
      );
    });
  });

  describe("leaves URL unchanged (guardrail)", () => {
    test("already-bracketed IPv6", () => {
      const input = "postgresql://user:pass@[::1]:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("IPv4 host", () => {
      const input = "postgresql://user:pass@127.0.0.1:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("DNS hostname", () => {
      const input = "postgresql://user:pass@db.example.com:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("percent-encoded colons that do not decode to a valid IPv6 (4 groups only)", () => {
      const input = "postgresql://user:pass@2406%3Ada18%3A243%3A740f:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("non-colon percent-encoded character in hostname", () => {
      const input = "postgresql://user:pass@host%2Dname:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("garbage host `%3A%3Azzz` decodes to `::zzz`, not valid IPv6", () => {
      const input = "postgresql://user:pass@%3A%3Azzz:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });

    test("hostname with %3A and a bare % does not throw URIError", () => {
      // Regression: `decodeURIComponent` would crash on a malformed percent
      // sequence even when the hostname pre-filter matched `%3A`. Expected
      // behaviour: swallow the decode failure and leave the URL unchanged,
      // letting downstream get its usual ENOTFOUND/connect error.
      const input = "postgresql://user:pass@2406%3Ada18%:5432/db";
      expect(normalizeConnectionUrl(input)).toBe(input);
    });
  });
});

describe("safeDecodeURIComponent", () => {
  test("decodes a valid percent-encoded string", () => {
    expect(safeDecodeURIComponent("p%40ss%2Fword")).toBe("p@ss/word");
  });

  test("returns a string with a bare % unchanged", () => {
    expect(safeDecodeURIComponent("pass%word")).toBe("pass%word");
  });

  test("returns a truncated percent escape unchanged", () => {
    expect(safeDecodeURIComponent("pa%xx")).toBe("pa%xx");
  });

  test("returns a trailing bare % unchanged", () => {
    expect(safeDecodeURIComponent("secret%")).toBe("secret%");
  });

  test("returns empty string as-is", () => {
    expect(safeDecodeURIComponent("")).toBe("");
  });
});
