import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectExtensions } from "./extensions.ts";

describe.concurrent(
  "inspect extensions",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of extensions`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create extension citext;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectExtensions(db.a);
          const resultB = await inspectExtensions(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.citext",
                {
                  name: "citext",
                  owner: "test",
                  relocatable: true,
                  schema: "public",
                  version: "1.6",
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
