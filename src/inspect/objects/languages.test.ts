import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectLanguages } from "./languages.ts";

describe.concurrent(
  "inspect languages",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should detect procedural language creation and removal`, async ({
          db,
        }) => {
          // Initial state should only have sql language per default
          const resultA = await inspectLanguages(db.a);
          const resultB = await inspectLanguages(db.b);

          expect(resultA).toEqual(
            new Map([
              [
                "sql",
                {
                  name: "sql",
                  is_trusted: true,
                  is_procedural: false,
                  call_handler: null,
                  inline_handler: null,
                  validator: "fmgr_sql_validator(oid)",
                  owner: "test",
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
