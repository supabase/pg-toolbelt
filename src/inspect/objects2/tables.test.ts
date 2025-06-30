import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectTables } from "./tables.ts";

describe.concurrent(
  "inspect tables",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of tables`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table test_table (id integer);
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectTables(db.a);
          const resultB = await inspectTables(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_table",
                {
                  force_row_security: false,
                  has_indexes: false,
                  has_rules: false,
                  has_subclasses: false,
                  has_triggers: false,
                  is_partition: false,
                  is_populated: true,
                  name: "test_table",
                  options: null,
                  owner: "test",
                  partition_bound: null,
                  persistence: "p",
                  replica_identity: "d",
                  row_security: false,
                  schema: "public",
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
