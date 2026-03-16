import { describe, expect, test } from "bun:test";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { Effect } from "effect";
import { parseSslConfig } from "./ssl-config.ts";

describe("parseSslConfig", () => {
  test("reads CA certificate content from injected runtime config", async () => {
    const result = await Effect.runPromise(
      parseSslConfig("postgresql://example/db?sslmode=verify-ca", "source", {
        getEnv: (name) =>
          name === "PGDELTA_SOURCE_SSLROOTCERT" ? "ca-cert-content" : undefined,
      }).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(result.cleanedUrl).toBe("postgresql://example/db");
    expect(result.ssl).toBeDefined();
    if (result.ssl) {
      expect(result.ssl.rejectUnauthorized).toBe(true);
      expect(result.ssl.ca).toBe("ca-cert-content");
    }
  });
});
