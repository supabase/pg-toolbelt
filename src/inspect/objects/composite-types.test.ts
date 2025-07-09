import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectCompositeTypes } from "./composite-types.ts";

describe.concurrent(
  "inspect composite types",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of composite types`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create type test_composite as (a integer, b text);
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectCompositeTypes(db.a);
          const resultB = await inspectCompositeTypes(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_composite",
                {
                  force_row_security: false,
                  has_indexes: false,
                  has_rules: false,
                  has_subclasses: false,
                  has_triggers: false,
                  is_partition: false,
                  is_populated: true,
                  name: "test_composite",
                  options: null,
                  owner: "test",
                  partition_bound: null,
                  replica_identity: "n",
                  row_security: false,
                  schema: "public",
                  dependent_on: [],
                  dependents: [],
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
