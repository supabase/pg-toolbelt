/**
 * Integration tests for SSL/TLS connection support.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPlan } from "../../src/core/plan/create.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "../constants.ts";
import { PostgresSslContainer } from "../postgres-ssl.ts";
import { generateSslCertificates } from "../ssl-utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`SSL operations (pg${pgVersion})`, () => {
    it("should connect with sslmode=require", async () => {
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
    });

    it("should connect with sslmode=verify-ca using CA certificate file", async () => {
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
    });

    it("should connect with sslmode=verify-ca using CA certificate from environment variable", async () => {
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
    });

    it("should fail to connect without SSL when server requires SSL", async () => {
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
    });

    it("should detect schema differences over SSL connection", async () => {
      const certificates = await generateSslCertificates();
      const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
      const container = await new PostgresSslContainer(
        image,
        certificates,
      ).start();

      try {
        // Create a test database with a table
        await container.createDatabase("test_db");

        // Create a table in source database using container exec (handles SSL automatically)
        const result = await container.exec(
          [
            "psql",
            "-U",
            container.getUsername(),
            "-d",
            "test_db",
            "-c",
            "CREATE TABLE test_table (id integer)",
          ],
          {
            env: {
              PGPASSWORD: container.getPassword(),
            },
          },
        );
        if (result.exitCode !== 0) {
          throw new Error(`Failed to create table: ${result.output}`);
        }

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
    });
  });
}
