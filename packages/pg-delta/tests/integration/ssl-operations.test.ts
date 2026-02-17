/**
 * Integration tests for SSL/TLS connection support.
 */

import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { createPlan } from "../../src/core/plan/create.ts";
import { createPool } from "../../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "../constants.ts";
import { PostgresSslContainer } from "../postgres-ssl.ts";
import {
  generateSslCertificates,
  type SslCertificateOptions,
} from "../ssl-utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`SSL operations (pg${pgVersion})`, () => {
    it(
      "should connect with sslmode=require",
      async () => {
        const certificates = await generateSslCertificates();
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          const sourceUrl = `${container.getConnectionUri()}?sslmode=require`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=require`;

          // Should not throw - SSL connection should work
          const result = await createPlan(sourceUrl, targetUrl);
          expect(result).toBeNull(); // No changes expected for identical databases
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    it(
      "should connect with sslmode=verify-ca using CA certificate file",
      async () => {
        const certificates = await generateSslCertificates();
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          const sourceUrl = `${container.getConnectionUri()}?sslmode=verify-ca&sslrootcert=${certificates.caCert}`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=require`;

          // Should not throw - SSL connection with CA verification should work
          const result = await createPlan(sourceUrl, targetUrl);
          expect(result).toBeNull(); // No changes expected for identical databases
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    it(
      "should connect with sslmode=verify-ca using CA certificate from environment variable",
      async () => {
        const certificates = await generateSslCertificates();
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          const caContent = await readFile(certificates.caCert, "utf-8");
          process.env.PGDELTA_SOURCE_SSLROOTCERT = caContent;

          const sourceUrl = `${container.getConnectionUri()}?sslmode=verify-ca`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=require`;

          // Should not throw - SSL connection with CA from env var should work
          const result = await createPlan(sourceUrl, targetUrl);
          expect(result).toBeNull(); // No changes expected for identical databases
        } finally {
          delete process.env.PGDELTA_SOURCE_SSLROOTCERT;
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    it(
      "should fail to connect without SSL when server requires SSL",
      async () => {
        const certificates = await generateSslCertificates();
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          const sourceUrl = container.getConnectionUri(); // No sslmode parameter - should fail
          const targetUrl = `${container.getConnectionUri()}?sslmode=require`; // Target needs SSL too

          // Should throw - server requires SSL but client doesn't use it
          // Add timeout to prevent hanging
          await expect(
            Promise.race([
              createPlan(sourceUrl, targetUrl),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 5000),
              ),
            ]),
          ).rejects.toThrow();
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    it(
      "should detect schema differences over SSL connection",
      async () => {
        const certificates = await generateSslCertificates();
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          // Use pg Pool instead of container.exec() which hangs under Bun.
          // SSL container requires SSL for TCP connections. Use rejectUnauthorized: false
          // since the container uses self-signed certs (this is test setup, not the SUT).
          const sslOpts = { ssl: { rejectUnauthorized: false } };
          const adminPool = createPool(container.getConnectionUri(), sslOpts);

          // Create a test database
          await adminPool.query(
            `CREATE DATABASE "test_db" OWNER "${container.getUsername()}"`,
          );

          // Create a table in the test database via pg Pool
          const testDbPool = createPool(
            container.getConnectionUriForDatabase("test_db"),
            sslOpts,
          );
          await testDbPool.query("CREATE TABLE test_table (id integer)");
          await testDbPool.end();
          await adminPool.end();

          const sourceUrl = `${container.getConnectionUriForDatabase("test_db")}?sslmode=require`;
          const targetUrl = `${container.getConnectionUriForDatabase("postgres")}?sslmode=require`;

          // Should detect the difference
          const planResult = await createPlan(sourceUrl, targetUrl);
          expect(planResult).not.toBeNull();
          expect(planResult?.plan.statements.length).toBeGreaterThan(0);
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    /**
     * Test for issue: verify-ca mode incorrectly verifies hostname.
     *
     * User report: "x509: certificate is not standards compliant" error when using
     * verify-ca with certificates that have hostname mismatches.
     *
     * PostgreSQL's sslmode=verify-ca should ONLY verify the certificate chain (CA),
     * NOT the hostname. This test uses a certificate with a different hostname
     * (wronghost.example.com instead of localhost) to verify that verify-ca
     * accepts it as long as the CA is trusted.
     *
     * Current behavior: FAILS with hostname verification error
     * Expected behavior: PASSES because verify-ca should not check hostname
     */
    it(
      "should connect with sslmode=verify-ca when hostname does not match (CA-only verification)",
      async () => {
        // Generate certificates with a different hostname that won't match localhost
        const certOptions: SslCertificateOptions = {
          serverCN: "wronghost.example.com",
          serverSAN: ["DNS:wronghost.example.com"],
        };
        const certificates = await generateSslCertificates(certOptions);
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          // Use verify-ca with CA certificate - should work because verify-ca
          // only verifies the CA chain, not the hostname
          const sourceUrl = `${container.getConnectionUri()}?sslmode=verify-ca&sslrootcert=${certificates.caCert}`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=verify-ca&sslrootcert=${certificates.caCert}`;

          // This should NOT throw - verify-ca should accept a certificate signed by
          // the trusted CA regardless of hostname mismatch
          const result = await createPlan(sourceUrl, targetUrl);
          expect(result).toBeNull(); // No changes expected for identical databases
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );

    /**
     * Test for libpq compatibility: sslmode=require with CA cert should verify CA.
     *
     * From PostgreSQL docs: "For backwards compatibility with earlier versions of
     * PostgreSQL, if a root CA file exists, the behavior of sslmode=require will
     * be the same as that of verify-ca."
     *
     * This test verifies that when sslmode=require is used WITH a CA certificate,
     * it actually VERIFIES the CA chain. We use a DIFFERENT CA (not the one that
     * signed the server cert) to prove that CA verification is happening.
     *
     * Current behavior: PASSES (incorrectly) - CA cert is ignored, any cert accepted
     * Expected behavior: FAILS - should reject because CA doesn't match
     */
    it(
      "should reject connection with sslmode=require and wrong CA cert (libpq compatibility - CA must be verified)",
      async () => {
        // Generate server certificates with one CA
        const serverCerts = await generateSslCertificates();
        // Generate a DIFFERENT CA that didn't sign the server cert
        const wrongCaCerts = await generateSslCertificates();

        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          serverCerts,
        ).start();

        try {
          // Use require with WRONG CA certificate - should fail because
          // require+CA should verify the CA chain (like verify-ca)
          const sourceUrl = `${container.getConnectionUri()}?sslmode=require&sslrootcert=${wrongCaCerts.caCert}`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=require&sslrootcert=${wrongCaCerts.caCert}`;

          // This SHOULD throw - the CA doesn't match the server's certificate
          // If it passes, it means CA verification is NOT happening (current bug)
          await expect(
            Promise.race([
              createPlan(sourceUrl, targetUrl),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 5000),
              ),
            ]),
          ).rejects.toThrow();
        } finally {
          await container.stop();
          await serverCerts.cleanup();
          await wrongCaCerts.cleanup();
        }
      },
      { retry: 3 },
    );

    /**
     * Test for issue: verify-full mode should verify hostname.
     *
     * PostgreSQL's sslmode=verify-full should verify BOTH the certificate chain
     * AND the hostname. This test confirms that verify-full correctly rejects
     * certificates where the hostname doesn't match.
     */
    it(
      "should reject connection with sslmode=verify-full when hostname does not match",
      async () => {
        // Generate certificates with a different hostname that won't match localhost
        const certOptions: SslCertificateOptions = {
          serverCN: "wronghost.example.com",
          serverSAN: ["DNS:wronghost.example.com"],
        };
        const certificates = await generateSslCertificates(certOptions);
        const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
        const container = await new PostgresSslContainer(
          image,
          certificates,
        ).start();

        try {
          // Use verify-full with CA certificate - should fail because verify-full
          // requires hostname to match
          const sourceUrl = `${container.getConnectionUri()}?sslmode=verify-full&sslrootcert=${certificates.caCert}`;
          const targetUrl = `${container.getConnectionUri()}?sslmode=verify-full&sslrootcert=${certificates.caCert}`;

          // This SHOULD throw because verify-full requires hostname match
          await expect(
            Promise.race([
              createPlan(sourceUrl, targetUrl),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 5000),
              ),
            ]),
          ).rejects.toThrow();
        } finally {
          await container.stop();
          await certificates.cleanup();
        }
      },
      { retry: 3 },
    );
  });
}
