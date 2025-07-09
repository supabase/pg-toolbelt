import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectSequences } from "./sequences.ts";

describe.concurrent(
  "inspect sequences",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of sequences`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create sequence test_sequence;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectSequences(db.a);
          const resultB = await inspectSequences(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.test_sequence",
                {
                  cache_size: "1",
                  cycle_option: false,
                  data_type: "bigint",
                  increment: "1",
                  maximum_value: "9223372036854775807",
                  minimum_value: "1",
                  name: "test_sequence",
                  owner: "test",
                  persistence: "p",
                  schema: "public",
                  start_value: "1",
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
