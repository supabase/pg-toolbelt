import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectTriggers } from "./triggers.ts";

describe.concurrent(
  "inspect triggers",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of triggers`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table trg_table (id integer);
            create function trg_func() returns trigger as $$ begin return new; end; $$ language plpgsql;
            create trigger test_trigger before insert on trg_table for each row execute function trg_func();
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectTriggers(db.a);
          const resultB = await inspectTriggers(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.trg_table.test_trigger",
                {
                  argument_count: 0,
                  arguments: [],
                  column_numbers: "",
                  deferrable: false,
                  enabled: "O",
                  function_name: "trg_func",
                  function_schema: "public",
                  initially_deferred: false,
                  is_internal: false,
                  name: "test_trigger",
                  new_table: null,
                  old_table: null,
                  owner: "test",
                  schema: "public",
                  table_name: "trg_table",
                  table_schema: "public",
                  trigger_type: 7,
                  when_condition: null,
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
