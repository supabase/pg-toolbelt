/**
 * SSL configuration parsing for PostgreSQL connection URLs.
 *
 * Supports sslmode and certificate paths (URL params or env). Used by plan,
 * apply, and catalog-export when connecting to source/target databases.
 */

import { readFile } from "node:fs/promises";

/** Parsed SSL options for the pg client plus URL with SSL params stripped (internal). */
type SslConfig = {
  ssl?:
    | boolean
    | {
        rejectUnauthorized: boolean;
        ca?: string;
        cert?: string;
        key?: string;
        /**
         * Custom server identity check function.
         * Used to skip hostname verification for verify-ca mode.
         * Returns undefined to indicate success (no error).
         */
        checkServerIdentity?: () => undefined;
      };
  cleanedUrl: string;
};

/**
 * Parse SSL configuration from a PostgreSQL connection URL.
 * Supports sslmode (require, verify-ca, verify-full, prefer, disable).
 * Certificates can be provided via:
 * - Query string parameters (file paths): sslrootcert, sslcert, sslkey (preferred)
 * - Environment variables (content): PGDELTA_SOURCE_SSLROOTCERT/SSLCERT/SSLKEY or PGDELTA_TARGET_SSLROOTCERT/SSLCERT/SSLKEY
 * Returns SSL options for the postgres.js library and a cleaned URL without SSL-related query parameters.
 */
export async function parseSslConfig(
  url: string,
  connectionType: "source" | "target",
): Promise<SslConfig> {
  const urlObj = new URL(url);
  const sslmode = urlObj.searchParams.get("sslmode");
  const sslrootcert = urlObj.searchParams.get("sslrootcert");
  const sslcert = urlObj.searchParams.get("sslcert");
  const sslkey = urlObj.searchParams.get("sslkey");

  // Remove SSL-related query parameters since we parse them ourselves
  urlObj.searchParams.delete("sslmode");
  urlObj.searchParams.delete("sslrootcert");
  urlObj.searchParams.delete("sslcert");
  urlObj.searchParams.delete("sslkey");
  const cleanedUrl = urlObj.toString();

  // Handle different SSL modes
  if (sslmode === "disable") {
    return { cleanedUrl, ssl: false };
  }

  if (
    sslmode === "require" ||
    sslmode === "prefer" ||
    sslmode === "verify-ca" ||
    sslmode === "verify-full"
  ) {
    // Helper function to get certificate value: query param (file path) takes precedence over env var (content)
    const getCertValue = async (
      queryParam: string | null,
      envVarName: string,
    ): Promise<string | undefined> => {
      // Prefer query parameter (file path)
      if (queryParam) {
        try {
          return await readFile(queryParam, "utf-8");
        } catch (error) {
          throw new Error(
            `Failed to read certificate file '${queryParam}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // Fallback to environment variable (content)
      const envValue = process.env[envVarName];
      return envValue || undefined;
    };

    const hasExplicitVerification =
      sslmode === "verify-ca" || sslmode === "verify-full";

    // Get CA certificate value.
    // - verify-ca/verify-full: check query param first, then env var
    // - require/prefer: only check query param (libpq backward compatibility
    //   requires an explicit root CA *file*, not a global env var)
    const caEnvVar =
      connectionType === "source"
        ? "PGDELTA_SOURCE_SSLROOTCERT"
        : "PGDELTA_TARGET_SSLROOTCERT";
    let caValue: string | undefined;
    if (sslrootcert) {
      // Explicit file path in query param — always honour it
      caValue = await getCertValue(sslrootcert, caEnvVar);
    } else if (hasExplicitVerification) {
      // verify-ca / verify-full without file path — fall back to env var
      caValue = await getCertValue(null, caEnvVar);
    }
    // require/prefer without sslrootcert: no CA cert, no verification

    // Determine if we should verify the CA chain
    //   From PostgreSQL docs: "if a root CA file exists, the behavior of sslmode=require
    //   will be the same as that of verify-ca"
    const hasLibpqCompatibility =
      (sslmode === "require" || sslmode === "prefer") && caValue !== undefined;
    const shouldVerifyCa = hasExplicitVerification || hasLibpqCompatibility;

    // Determine if we should verify hostname
    // - verify-full: verify both CA and hostname
    // - verify-ca: verify CA only (skip hostname)
    // - require/prefer with CA (libpq compat): behaves like verify-ca (skip hostname)
    const shouldVerifyHostname = sslmode === "verify-full";

    const ssl: {
      rejectUnauthorized: boolean;
      ca?: string;
      cert?: string;
      key?: string;
      checkServerIdentity?: () => undefined;
    } = {
      rejectUnauthorized: shouldVerifyCa,
    };

    // Add CA certificate if verifying
    if (shouldVerifyCa && caValue) {
      ssl.ca = caValue;
    }

    // For verify-ca and libpq compatibility mode: skip hostname verification
    // This matches PostgreSQL semantics where verify-ca only checks the CA chain
    if (shouldVerifyCa && !shouldVerifyHostname) {
      ssl.checkServerIdentity = () => undefined;
    }

    // Get client certificate (optional, for mutual TLS)
    const certEnvVar =
      connectionType === "source"
        ? "PGDELTA_SOURCE_SSLCERT"
        : "PGDELTA_TARGET_SSLCERT";
    const certValue = await getCertValue(sslcert, certEnvVar);
    if (certValue) {
      ssl.cert = certValue;
    }

    // Get client key (optional, for mutual TLS, required if cert is provided)
    const keyEnvVar =
      connectionType === "source"
        ? "PGDELTA_SOURCE_SSLKEY"
        : "PGDELTA_TARGET_SSLKEY";
    const keyValue = await getCertValue(sslkey, keyEnvVar);
    if (keyValue) {
      ssl.key = keyValue;
    }

    // Warn if cert is provided without key (or vice versa)
    if ((ssl.cert && !ssl.key) || (!ssl.cert && ssl.key)) {
      throw new Error(
        "Both client certificate and key must be provided together for mutual TLS",
      );
    }

    return { ssl, cleanedUrl };
  }

  // No sslmode specified or invalid value - explicitly disable SSL
  return { cleanedUrl, ssl: false };
}
