/**
 * Under a profile baseline, an edit to a grant on schema `public` in the
 * declarative files must still diff (supabase/pg-toolbelt#531). A revoked
 * default grant leaves no fact on one side, so the other side's
 * baseline-identical grant must not be subtracted.
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
  type SqlFile,
} from "../src/frontends/index.ts";
import type { IntegrationProfile } from "../src/integrations/index.ts";
import { sharedCluster } from "./containers.ts";

const REVOKE = `REVOKE ALL ON SCHEMA "public" FROM PUBLIC;\n`;
/* PG14 grants PUBLIC CREATE too */
const GRANT = /GRANT [A-Z, ]*USAGE ON SCHEMA "public" TO PUBLIC;\n/g;

/** Strip `line` from every file, then append `tail` to the last one. */
function edited(files: SqlFile[], line: string | RegExp, tail = ""): SqlFile[] {
  return files.map((file, index) => {
    const sql = file.sql.replaceAll(line, "");
    return { ...file, sql: index === files.length - 1 ? sql + tail : sql };
  });
}

describe("public default grants under a policy baseline", () => {
  for (const edit of [
    {
      name: "removing the exported revoke re-grants",
      revoked: true,
      files: (files: SqlFile[]) => edited(files, REVOKE),
      expected: /GRANT [A-Z, ]*USAGE ON SCHEMA "public" TO PUBLIC/,
    },
    {
      name: "adding a revoke revokes",
      revoked: false,
      files: (files: SqlFile[]) => edited(files, GRANT, `\n${REVOKE}`),
      expected: /REVOKE ALL ON SCHEMA "public" FROM PUBLIC/,
    },
    {
      name: "an unchanged export re-syncs empty",
      revoked: true,
      files: (files: SqlFile[]) => files,
      expected: undefined,
    },
  ]) {
    test(
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
          const planned = await planSchemaFiles(
            source.pool,
            shadow.pool,
            edit.files(exported.files),
            {
              profile,
              manifest: exported.manifest,
              resolveOptions: { baselineDir },
            },
          );
          const sql = planned.plan.actions.map((a) => a.sql).join("\n");
          if (edit.expected === undefined) expect(sql).toBe("");
          else expect(sql).toMatch(edit.expected);
        } finally {
          rmSync(baselineDir, { recursive: true, force: true });
          await Promise.all([source.drop(), shadow.drop()]);
        }
      },
      120_000,
    );
  }
});
