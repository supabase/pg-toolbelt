/**
 * CLI-1467 regression: pg-delta must never emit foreign-server or
 * user-mapping option secrets (password, passfile, passcode, sslpassword)
 * in any of its output channels — plan SQL, catalog export, declarative
 * export, fingerprints.
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
];

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`user-mapping / server option secret redaction (pg${pgVersion})`, () => {
    test(
      "plan SQL, catalog snapshot, and declarative export never leak password / passfile / passcode / sslpassword",
      withDbIsolated(pgVersion, async (db) => {
        // Setup: create a foreign server + user mapping with credentials in
        // BOTH the server options and the user mapping options. We use a
        // custom FDW so the server can carry arbitrary keys (postgres_fdw
        // restricts what is accepted at CREATE SERVER time).
        const setupSql = `
          CREATE FOREIGN DATA WRAPPER cli1467_fdw;
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
        // Sensitive keys must be replaced with the redaction placeholder.
        expect(planSql).toContain("password '__OPTION_PASSWORD__'");
        expect(planSql).toContain("passfile '__OPTION_PASSFILE__'");
        expect(planSql).toContain("passcode '__OPTION_PASSCODE__'");
        expect(planSql).toContain("sslpassword '__OPTION_SSLPASSWORD__'");

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
