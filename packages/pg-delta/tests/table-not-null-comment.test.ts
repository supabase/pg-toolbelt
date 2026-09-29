/**
 * PG 18 catalogs a table column's NOT NULL as a pg_constraint row (contype
 * 'n'), the change PG 17 made for domains. It must stay the column's `notNull`
 * attribute — never a constraint fact, never a dependency endpoint (issue
 * #483) — so an UNcommented row extracts in silence.
 *
 * A COMMENT ON CONSTRAINT can still be attached to that row, and the comment
 * has nowhere to live once the row is skipped. Report it, mirroring the domain
 * side (`domain_not_null_comment_skipped`), rather than dropping user-authored
 * metadata without a word. Docker required; the row only exists on PG 18+.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let plain: TestDb;
let commented: TestDb;

const TABLE_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.account (
    id integer PRIMARY KEY,
    email text NOT NULL
  );
`;

beforeAll(async () => {
  plain = await createTestDb("tbl_nn_plain");
  commented = await createTestDb("tbl_nn_commented");
  await plain.pool.query(TABLE_SQL);
  await commented.pool.query(TABLE_SQL);
  // PG 18+ only: before that there is no pg_constraint row to comment on.
  if ((await pgMajor(commented)) >= 18) {
    await commented.pool.query(
      `COMMENT ON CONSTRAINT account_email_not_null ON app.account IS 'set at signup'`,
    );
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([plain.drop(), commented.drop()]);
});

const pgMajor = async (db: TestDb) =>
  Number(
    (await db.pool.query(`SHOW server_version_num`)).rows[0].server_version_num,
  ) / 10000;

describe("table NOT NULL is not a constraint fact", () => {
  test("an uncommented NOT NULL row extracts with no diagnostics", async () => {
    const { diagnostics } = await extract(plain.pool);
    expect(diagnostics).toEqual([]);
  });

  test("a comment on the skipped NOT NULL row surfaces as an info diagnostic", async () => {
    const { diagnostics } = await extract(commented.pool);
    if ((await pgMajor(commented)) < 18) {
      expect(diagnostics).toEqual([]);
      return;
    }
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "table_not_null_comment_skipped",
        severity: "info",
        subject: { kind: "table", schema: "app", name: "account" },
      }),
    ]);
    expect(diagnostics[0]!.message).toContain("account_email_not_null");
  });
});
