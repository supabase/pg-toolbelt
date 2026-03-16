/**
 * SSL configuration parsing for PostgreSQL connection URLs.
 *
 * Supports sslmode and certificate paths (URL params or env). Used by plan,
 * apply, and catalog-export when connecting to source/target databases.
 */

import { Effect, FileSystem } from "effect";
import type { PgRuntimeConfigApi } from "./runtime-config.ts";

type SslConfig = {
  ssl?:
    | boolean
    | {
        rejectUnauthorized: boolean;
        ca?: string;
        cert?: string;
        key?: string;
        checkServerIdentity?: () => undefined;
      };
  cleanedUrl: string;
};

export const parseSslConfig = Effect.fn("parseSslConfig")(function* (
  url: string,
  connectionType: "source" | "target",
  runtimeConfig: Pick<PgRuntimeConfigApi, "getEnv">,
) {
  const fs = yield* FileSystem.FileSystem;
  const urlObj = new URL(url);
  const sslmode = urlObj.searchParams.get("sslmode");
  const sslrootcert = urlObj.searchParams.get("sslrootcert");
  const sslcert = urlObj.searchParams.get("sslcert");
  const sslkey = urlObj.searchParams.get("sslkey");

  urlObj.searchParams.delete("sslmode");
  urlObj.searchParams.delete("sslrootcert");
  urlObj.searchParams.delete("sslcert");
  urlObj.searchParams.delete("sslkey");
  const cleanedUrl = urlObj.toString();

  if (sslmode === "disable") {
    return { cleanedUrl, ssl: false } satisfies SslConfig;
  }

  if (
    sslmode !== "require" &&
    sslmode !== "prefer" &&
    sslmode !== "verify-ca" &&
    sslmode !== "verify-full"
  ) {
    return { cleanedUrl, ssl: false } satisfies SslConfig;
  }

  const getCertValue = (
    queryParam: string | null,
    envVarName: string,
  ): Effect.Effect<string | undefined, Error> =>
    queryParam
      ? fs
          .readFileString(queryParam, "utf-8")
          .pipe(
            Effect.mapError(
              (error) =>
                new Error(
                  `Failed to read certificate file '${queryParam}': ${error instanceof Error ? error.message : String(error)}`,
                ),
            ),
          )
      : Effect.succeed(runtimeConfig.getEnv(envVarName) || undefined);

  const hasExplicitVerification =
    sslmode === "verify-ca" || sslmode === "verify-full";

  const caEnvVar =
    connectionType === "source"
      ? "PGDELTA_SOURCE_SSLROOTCERT"
      : "PGDELTA_TARGET_SSLROOTCERT";

  const caValue = sslrootcert
    ? yield* getCertValue(sslrootcert, caEnvVar)
    : hasExplicitVerification
      ? yield* getCertValue(null, caEnvVar)
      : undefined;

  const hasLibpqCompatibility =
    (sslmode === "require" || sslmode === "prefer") && caValue !== undefined;
  const shouldVerifyCa = hasExplicitVerification || hasLibpqCompatibility;
  const shouldVerifyHostname = sslmode === "verify-full";

  const ssl: Exclude<SslConfig["ssl"], boolean | undefined> = {
    rejectUnauthorized: shouldVerifyCa,
  };

  if (shouldVerifyCa && caValue) {
    ssl.ca = caValue;
  }

  if (shouldVerifyCa && !shouldVerifyHostname) {
    ssl.checkServerIdentity = () => undefined;
  }

  const certEnvVar =
    connectionType === "source"
      ? "PGDELTA_SOURCE_SSLCERT"
      : "PGDELTA_TARGET_SSLCERT";
  const certValue = yield* getCertValue(sslcert, certEnvVar);
  if (certValue) {
    ssl.cert = certValue;
  }

  const keyEnvVar =
    connectionType === "source"
      ? "PGDELTA_SOURCE_SSLKEY"
      : "PGDELTA_TARGET_SSLKEY";
  const keyValue = yield* getCertValue(sslkey, keyEnvVar);
  if (keyValue) {
    ssl.key = keyValue;
  }

  if ((ssl.cert && !ssl.key) || (!ssl.cert && ssl.key)) {
    return yield* Effect.fail(
      new Error(
        "Both client certificate and key must be provided together for mutual TLS",
      ),
    );
  }

  return { ssl, cleanedUrl } satisfies SslConfig;
});
