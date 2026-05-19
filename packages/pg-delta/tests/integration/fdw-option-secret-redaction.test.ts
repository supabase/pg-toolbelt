/**
 * CLI-1467 regression: pg-delta must never emit foreign-data-wrapper,
 * foreign-server, user-mapping, or foreign-table option secrets in any of
 * its output channels — plan SQL, catalog export, declarative export,
 * fingerprints.
 *
 * If this test ever fails, an output path is leaking credentials in
 * cleartext. Treat as critical and revert the regression.
 */

import { describe, expect, test } from "bun:test";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../src/core/catalog.snapshot.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";

const SECRET_VALUES = [
  "real-user-password",
  "/etc/secrets/passfile",
  "krb-passcode",
  "ssl-secret",
  "fdw-shared-secret",
  "fdw-api-key",
  "table-shared-secret",
];

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`FDW option secret redaction (pg${pgVersion})`, () => {
    test(
      "plan SQL, catalog snapshot, and declarative export never leak option secrets across FDW / server / user-mapping / foreign-table",
      withDbIsolated(pgVersion, async (db) => {
        // Setup: plant secrets at EVERY object layer that carries OPTIONS.
        // The custom FDW (no handler/validator) lets us drop arbitrary keys
        // into FDW-, server-, user-mapping-, and foreign-table-level
        // OPTIONS without postgres_fdw's restrictions.
        const setupSql = `
          CREATE FOREIGN DATA WRAPPER cli1467_fdw OPTIONS (
            use_remote_estimate 'true',
            password 'fdw-shared-secret',
            api_key 'fdw-api-key'
          );
          CREATE SERVER cli1467_server FOREIGN DATA WRAPPER cli1467_fdw OPTIONS (
            host 'remote.example.com',
            port '5432',
            password 'real-user-password',
            passfile '/etc/secrets/passfile'
          );
          CREATE USER MAPPING FOR CURRENT_USER SERVER cli1467_server OPTIONS (
            "user" 'fdw_reader',
            password 'real-user-password',
            passcode 'krb-passcode',
            sslpassword 'ssl-secret'
          );
          CREATE FOREIGN TABLE cli1467_table (id integer) SERVER cli1467_server OPTIONS (
            schema_name 'remote_schema',
            password 'table-shared-secret'
          );
        `;
        await db.branch.query(setupSql);

        // ----- Plan SQL -----
        const planResult = await createPlan(db.main, db.branch);
        expect(planResult).not.toBeNull();
        // biome-ignore lint/style/noNonNullAssertion: just asserted not null
        const planSql = planResult!.plan.statements.join("\n");
        for (const secret of SECRET_VALUES) {
          expect(planSql).not.toContain(secret);
        }
        // Non-secret options must still roundtrip.
        expect(planSql).toContain("host 'remote.example.com'");
        expect(planSql).toContain("port '5432'");
        expect(planSql).toContain("user 'fdw_reader'");
        expect(planSql).toContain("use_remote_estimate 'true'");
        expect(planSql).toContain("schema_name 'remote_schema'");
        // Sensitive keys must be replaced with the redaction placeholder.
        expect(planSql).toContain("password '__OPTION_PASSWORD__'");
        expect(planSql).toContain("passfile '__OPTION_PASSFILE__'");
        expect(planSql).toContain("passcode '__OPTION_PASSCODE__'");
        expect(planSql).toContain("sslpassword '__OPTION_SSLPASSWORD__'");
        expect(planSql).toContain("api_key '__OPTION_API_KEY__'");

        // ----- Catalog export (snapshot) -----
        const branchCatalog = await extractCatalog(db.branch);
        const snapshotJson = stringifyCatalogSnapshot(
          serializeCatalog(branchCatalog),
        );
        for (const secret of SECRET_VALUES) {
          expect(snapshotJson).not.toContain(secret);
        }

        // ----- Declarative export -----
        // biome-ignore lint/style/noNonNullAssertion: just asserted not null
        const declarative = exportDeclarativeSchema(planResult!, {});
        const declarativeText = JSON.stringify(declarative);
        for (const secret of SECRET_VALUES) {
          expect(declarativeText).not.toContain(secret);
        }
      }),
    );
  });
}
