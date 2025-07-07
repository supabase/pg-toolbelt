import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectCollations } from "./collations.ts";

describe.concurrent(
  "inspect collations",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of collations`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create collation test_collation (locale = 'C');
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectCollations(db.a);
          const resultB = await inspectCollations(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_collation",
                {
                  collate: "C",
                  ctype: "C",
                  encoding: 6,
                  icu_rules: null,
                  is_deterministic: true,
                  locale: null,
                  name: "test_collation",
                  owner: "test",
                  provider: "c",
                  schema: "public",
                  version: null,
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
