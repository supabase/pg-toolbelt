import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectEnums } from "./enums.ts";

describe.concurrent(
  "inspect enums",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of enums`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create type test_enum as enum ('a', 'b', 'c');
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectEnums(db.a);
          const resultB = await inspectEnums(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_enum",
                {
                  schema: "public",
                  name: "test_enum",
                  owner: "test",
                  dependent_on: [],
                  dependents: [],
                  labels: [
                    {
                      sort_order: 1,
                      label: "a",
                    },
                    {
                      sort_order: 2,
                      label: "b",
                    },
                    {
                      sort_order: 3,
                      label: "c",
                    },
                  ],
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
