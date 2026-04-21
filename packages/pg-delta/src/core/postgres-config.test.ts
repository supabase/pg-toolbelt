import { describe, expect, test } from "bun:test";
import {
  connectWithRetry,
  isRetryableConnectError,
  poolConfigFromUrl,
} from "./postgres-config.ts";

function makeError(message: string, code?: string): Error {
  const err = new Error(message) as Error & { code?: string };
  if (code !== undefined) err.code = code;
  return err;
}

describe("isRetryableConnectError", () => {
  describe("non-retryable", () => {
    test("PG auth code 28P01", () => {
      expect(
        isRetryableConnectError(makeError("password auth failed", "28P01")),
      ).toBe(false);
    });

    test("PG auth code 28000", () => {
      expect(
        isRetryableConnectError(
          makeError("invalid authorization specification", "28000"),
        ),
      ).toBe(false);
    });

    test("ENOTFOUND (permanent DNS failure)", () => {
      expect(
        isRetryableConnectError(
          makeError("getaddrinfo ENOTFOUND bogus.host", "ENOTFOUND"),
        ),
      ).toBe(false);
    });

    test("TLS error via code (ERR_TLS_*)", () => {
      expect(
        isRetryableConnectError(
          makeError("TLS failure", "ERR_TLS_CERT_ALTNAME_INVALID"),
        ),
      ).toBe(false);
    });

    test("TLS error via message marker", () => {
      expect(
        isRetryableConnectError(
          makeError("self-signed certificate in certificate chain"),
        ),
      ).toBe(false);
    });

    test("SSL error via message marker", () => {
      expect(
        isRetryableConnectError(
          makeError("SSL connection has been closed unexpectedly"),
        ),
      ).toBe(false);
    });
  });

  describe("retryable", () => {
    test("ECONNRESET", () => {
      expect(
        isRetryableConnectError(makeError("socket hang up", "ECONNRESET")),
      ).toBe(true);
    });

    test("ECONNREFUSED", () => {
      expect(
        isRetryableConnectError(
          makeError("connect ECONNREFUSED", "ECONNREFUSED"),
        ),
      ).toBe(true);
    });

    test("ETIMEDOUT", () => {
      expect(
        isRetryableConnectError(makeError("connect ETIMEDOUT", "ETIMEDOUT")),
      ).toBe(true);
    });

    test("EAI_AGAIN (transient DNS)", () => {
      expect(
        isRetryableConnectError(
          makeError("getaddrinfo EAI_AGAIN db.host", "EAI_AGAIN"),
        ),
      ).toBe(true);
    });

    test("our own eager-connect timeout wrapper", () => {
      expect(
        isRetryableConnectError(
          new Error(
            "Connection to target database timed out after 2500ms. " +
              "The server may require SSL, use an invalid certificate, or be unreachable.",
          ),
        ),
      ).toBe(true);
    });

    test("unknown generic Error is transient-by-default", () => {
      expect(isRetryableConnectError(new Error("something weird"))).toBe(true);
    });

    test("non-Error values are transient-by-default", () => {
      expect(isRetryableConnectError("string error")).toBe(true);
      expect(isRetryableConnectError({ reason: "x" })).toBe(true);
      expect(isRetryableConnectError(undefined)).toBe(true);
    });
  });
});

describe("connectWithRetry", () => {
  const noSleep = async (_ms: number) => {
    // no-op sleep to keep tests fast
  };

  test("resolves on first attempt without retrying", async () => {
    let attempts = 0;
    const result = await connectWithRetry({
      connect: async () => {
        attempts++;
        return "ok" as const;
      },
      sleep: noSleep,
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  test("retries a retryable error until success", async () => {
    let attempts = 0;
    const result = await connectWithRetry({
      connect: async () => {
        attempts++;
        if (attempts < 3) {
          throw makeError("connect ECONNREFUSED", "ECONNREFUSED");
        }
        return "ok" as const;
      },
      maxAttempts: 5,
      sleep: noSleep,
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("honours maxAttempts and throws the last error", async () => {
    let attempts = 0;
    const boom = makeError("connect ECONNREFUSED", "ECONNREFUSED");
    await expect(
      connectWithRetry({
        connect: async () => {
          attempts++;
          throw boom;
        },
        maxAttempts: 4,
        sleep: noSleep,
      }),
    ).rejects.toBe(boom);
    expect(attempts).toBe(4);
  });

  test("stops immediately on a non-retryable error", async () => {
    let attempts = 0;
    const authError = makeError("password authentication failed", "28P01");
    await expect(
      connectWithRetry({
        connect: async () => {
          attempts++;
          throw authError;
        },
        maxAttempts: 10,
        sleep: noSleep,
      }),
    ).rejects.toBe(authError);
    expect(attempts).toBe(1);
  });

  test("uses exponential backoff: 250ms, 500ms (3 attempts)", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await expect(
      connectWithRetry({
        connect: async () => {
          attempts++;
          throw makeError("connect ECONNREFUSED", "ECONNREFUSED");
        },
        maxAttempts: 3,
        baseBackoffMs: 250,
        maxBackoffMs: 1000,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toBeDefined();
    expect(attempts).toBe(3);
    // Sleep is invoked once after attempt 1 and once after attempt 2;
    // the final failure throws without sleeping.
    expect(delays).toEqual([250, 500]);
  });

  test("caps backoff at maxBackoffMs", async () => {
    const delays: number[] = [];
    await expect(
      connectWithRetry({
        connect: async () => {
          throw makeError("connect ECONNREFUSED", "ECONNREFUSED");
        },
        maxAttempts: 5,
        baseBackoffMs: 250,
        maxBackoffMs: 600,
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toBeDefined();
    // Uncapped would be [250, 500, 1000, 2000]; the 1000/2000 values are
    // both capped to 600.
    expect(delays).toEqual([250, 500, 600, 600]);
  });

  test("injected isRetryable overrides the default predicate", async () => {
    let attempts = 0;
    const err = new Error("custom transient");
    const neverRetry = () => false;
    await expect(
      connectWithRetry({
        connect: async () => {
          attempts++;
          throw err;
        },
        maxAttempts: 5,
        isRetryable: neverRetry,
        sleep: noSleep,
      }),
    ).rejects.toBe(err);
    expect(attempts).toBe(1);
  });
});

describe("poolConfigFromUrl", () => {
  describe("non-IPv6 URLs pass through as connectionString", () => {
    test("DNS hostname", () => {
      const url = "postgresql://user:pass@db.example.com:5432/mydb";
      expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
    });

    test("IPv4 host", () => {
      const url = "postgresql://user:pass@127.0.0.1:5432/mydb";
      expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
    });

    test("DNS hostname with query params", () => {
      const url =
        "postgresql://user:pass@db.example.com:5432/mydb?application_name=test";
      expect(poolConfigFromUrl(url)).toEqual({ connectionString: url });
    });
  });

  describe("bracketed IPv6 URLs expand to explicit fields with no brackets", () => {
    test("full 8-group IPv6 — host has no brackets and no connectionString", () => {
      const url =
        "postgresql://user:pass@[2600:1f16:1cd0:3340:f92e:f4cb:7a52:10a1]:5432/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.connectionString).toBeUndefined();
      expect(config.host).toBe("2600:1f16:1cd0:3340:f92e:f4cb:7a52:10a1");
      expect(config.port).toBe(5432);
      expect(config.user).toBe("user");
      expect(config.password).toBe("pass");
      expect(config.database).toBe("mydb");
    });

    test("compressed ::1 form", () => {
      const url = "postgresql://user:pass@[::1]:5432/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.host).toBe("::1");
      expect(config.port).toBe(5432);
    });

    test("host bracket strip survives percent-decoded username/password", () => {
      const url = "postgresql://user:p%40ss%2Fword@[::1]:5432/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.host).toBe("::1");
      expect(config.user).toBe("user");
      expect(config.password).toBe("p@ss/word");
    });

    test("works without port", () => {
      const url = "postgresql://user:pass@[::1]/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.host).toBe("::1");
      expect(config.port).toBeUndefined();
    });

    test("works without database (pathname='/')", () => {
      const url = "postgresql://user:pass@[::1]:5432/";
      const config = poolConfigFromUrl(url);
      expect(config.host).toBe("::1");
      expect(config.database).toBeUndefined();
    });

    test("works without userinfo", () => {
      const url = "postgresql://[::1]:5432/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.host).toBe("::1");
      expect(config.user).toBeUndefined();
      expect(config.password).toBeUndefined();
    });

    test("query params are forwarded as top-level config keys", () => {
      const url =
        "postgresql://user:pass@[::1]:5432/mydb?application_name=pgdelta&connect_timeout=5";
      const config = poolConfigFromUrl(url) as unknown as Record<
        string,
        unknown
      >;
      expect(config.application_name).toBe("pgdelta");
      expect(config.connect_timeout).toBe("5");
      expect(config.host).toBe("::1");
    });

    test("IPv4-mapped IPv6 is stripped of brackets (WHATWG canonicalisation is fine)", () => {
      // WHATWG URL canonicalises `::ffff:192.0.2.1` to `::ffff:c000:201`;
      // either form resolves to the same IPv6 address, and the point of this
      // test is purely that no brackets escape to pg.
      const url = "postgresql://user:pass@[::ffff:192.0.2.1]:5432/mydb";
      const config = poolConfigFromUrl(url);
      expect(config.host).not.toContain("[");
      expect(config.host).not.toContain("]");
      expect(config.host).toBe("::ffff:c000:201");
    });
  });
});
