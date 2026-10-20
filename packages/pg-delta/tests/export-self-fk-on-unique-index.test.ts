/**
 * #543: a self-referencing FK that targets a unique index (not a constraint)
 * must be emitted after that index, otherwise the export cannot reload.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE TABLE public.people (id bigint PRIMARY KEY, org_id integer NOT NULL, merge_target_id bigint);
  CREATE UNIQUE INDEX uq_people_org_id_id ON public.people (org_id, id);
  ALTER TABLE public.people ADD CONSTRAINT people_merge_target_fkey
    FOREIGN KEY (org_id, merge_target_id) REFERENCES public.people (org_id, id);
`;

describe("export: self FK on a unique index", () => {
  test("reloads into an empty database", async () => {
    const src = await createTestDb("selffk_src");
    const shadow = await createTestDb("selffk_shadow");
    try {
      await src.pool.query(SCHEMA_SQL);
      const fb = (await extract(src.pool)).factBase;
      const files = exportSqlFiles(fb, { layout: "by-object" }).filter(
        (f) => !/cluster[_/]roles/.test(f.name),
      );
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
