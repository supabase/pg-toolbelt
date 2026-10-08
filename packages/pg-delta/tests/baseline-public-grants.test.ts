/**
 * Known gap (supabase/pg-toolbelt#531): under a profile baseline, sync cannot
 * see the default grants on schema `public`. The shadow loaded from the files
 * holds the default grant identical to the baseline, so `subtractBaseline`
 * removes it; the source lacks it, so nothing diffs. An edit to a `public`
 * REVOKE in the declarative files is silently ignored. `test.failing` flips
 * once it is fixed.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extract } from "../src/extract/extract.ts";
import {
  buildSchemaExport,
  planSchemaFiles,
  saveSnapshot,
} from "../src/frontends/index.ts";
import type { IntegrationProfile } from "../src/integrations/index.ts";
import { sharedCluster } from "./containers.ts";

const REVOKE = `REVOKE ALL ON SCHEMA "public" FROM PUBLIC;\n`;

describe("public default grants under a policy baseline", () => {
  for (const edit of [
    {
      name: "removing the exported revoke re-grants",
      revoked: true,
      files: (sql: string) => sql.replace(REVOKE, ""),
      /* PG14 grants PUBLIC CREATE too */
      expected: /GRANT [A-Z, ]*USAGE ON SCHEMA "public" TO PUBLIC/,
    },
    {
      name: "adding a revoke revokes",
      revoked: false,
      files: (sql: string) => `${sql}\n${REVOKE}`,
      expected: /REVOKE ALL ON SCHEMA "public" FROM PUBLIC/,
    },
  ]) {
    test.failing(
      edit.name,
      async () => {
        const profile: IntegrationProfile = {
          id: "test-baseline-public-edit",
          handlers: [],
          policy: { id: "test-baseline-public-edit", baseline: "fresh" },
        };
        const cluster = await sharedCluster();
        const source = await cluster.createDb("baseline_public_edit");
        const shadow = await cluster.createDb("baseline_public_edit_shadow");
        const baselineDir = mkdtempSync(
          join(tmpdir(), "pgdn-baseline-public-"),
        );
        try {
          /* the baseline is a fresh database, so it holds PUBLIC's grant */
          const { factBase, pgVersion } = await extract(source.pool);
          saveSnapshot(factBase, pgVersion, join(baselineDir, "fresh.json"));
          /* a table keeps the edited desired state non-empty */
          await source.pool.query(`CREATE TABLE public.kept (id integer)`);
          if (edit.revoked) {
            await source.pool.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
          }
          const exported = await buildSchemaExport(source.pool, {
            profile,
            resolveOptions: { baselineDir },
          });
          const [first, ...rest] = exported.files;
          if (first === undefined) throw new Error("export wrote no files");
          const planned = await planSchemaFiles(
            source.pool,
            shadow.pool,
            [{ ...first, sql: edit.files(first.sql) }, ...rest],
            {
              profile,
              manifest: exported.manifest,
              resolveOptions: { baselineDir },
            },
          );
          expect(planned.plan.actions.map((a) => a.sql).join("\n")).toMatch(
            edit.expected,
          );
        } finally {
          rmSync(baselineDir, { recursive: true, force: true });
          await Promise.all([source.drop(), shadow.drop()]);
        }
      },
      120_000,
    );
  }
});
