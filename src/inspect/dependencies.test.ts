import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../tests/migra/constants.ts";
import { getTest } from "../../tests/migra/utils.ts";
import { buildDependencies } from "./dependencies.ts";
import { inspect } from "./inspect.ts";

describe.concurrent("build dependencies", () => {
  for (const postgresVersion of POSTGRES_VERSIONS) {
    describe(`postgres ${postgresVersion}`, () => {
      const test = getTest(postgresVersion);

      test(`should be able to build dependencies`, async ({ db }) => {
        // arrange
        const fixture = /* sql */ `
            create table test_table (
              id serial primary key,
              name text
            );

            create view test_view as select id, name from test_table;

            create function test_func_with_args(arg1 integer, arg2 text default 'foo') returns table(val integer) as $$
              select arg1 as val;
            $$ language sql;

            create view test_view_func as
              select * from test_func_with_args(42, 'bar');

            -- Add enum type and table using it
            create type test_enum as enum ('a', 'b', 'c');
            create table enum_table (
              id serial primary key,
              enum_col test_enum
            );

            -- Add a child table inheriting from test_table
            create table child_table (
              extra_col text
            ) inherits (test_table);

            -- Add a trigger function and a trigger on test_table
            create function test_table_trigger_fn() returns trigger as $$
            begin
              return new;
            end;
            $$ language plpgsql;

            create trigger test_table_trigger
              before insert on test_table
              for each row
              execute function test_table_trigger_fn();
          `;
        await db.a.unsafe(fixture);
        // act
        const inspection = await inspect(db.a);
        await buildDependencies(db.a, inspection);
        // assert
        expect(inspection).toMatchObject({
          // Function and its dependent view
          "function:public.test_func_with_args(arg1 integer, arg2 text)": {
            dependent_on: [],
            dependents: ["view:public.test_view_func"],
          },
          // Base table and its dependents (view, child table, trigger)
          "table:public.test_table": {
            dependent_on: [],
            dependents: [
              "table:public.child_table",
              "trigger:public.test_table_trigger",
              "view:public.test_view",
            ],
          },
          // View depending on test_table
          "view:public.test_view": {
            dependent_on: ["table:public.test_table"],
            dependents: [],
          },
          // View depending on function
          "view:public.test_view_func": {
            dependent_on: [
              "function:public.test_func_with_args(arg1 integer, arg2 text)",
            ],
            dependents: [],
          },
          // Enum type and its dependent table
          "enum:public.test_enum": {
            dependent_on: [],
            dependents: ["table:public.enum_table"],
          },
          // Table using enum
          "table:public.enum_table": {
            dependent_on: ["enum:public.test_enum"],
            dependents: [],
          },
          // Child table inheriting from test_table
          "table:public.child_table": {
            dependent_on: ["table:public.test_table"],
            dependents: [],
          },
          // Trigger function (no dependencies, but has dependent trigger)
          "function:public.test_table_trigger_fn()": {
            dependent_on: [],
            dependents: ["trigger:public.test_table_trigger"],
          },
          // Trigger on test_table
          "trigger:public.test_table_trigger": {
            dependent_on: [
              "function:public.test_table_trigger_fn()",
              "table:public.test_table",
            ],
            dependents: [],
          },
        });
      }, 30_000);
    });
  }
});
