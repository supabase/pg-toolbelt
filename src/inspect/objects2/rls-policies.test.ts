import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectRlsPolicies } from "./rls-policies.ts";

describe.concurrent(
  "inspect rls policies",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of rls policies`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create table rls_table (id integer);
            alter table rls_table enable row level security;
            create policy test_policy on rls_table for select using (true);
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectRlsPolicies(db.a);
          const resultB = await inspectRlsPolicies(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public.rls_table.test_policy",
                {
                  command: "r",
                  name: "test_policy",
                  owner: "test",
                  permissive: true,
                  roles: [],
                  schema: "public",
                  table_name: "rls_table",
                  table_schema: "public",
                  using_expression: "true",
                  with_check_expression: null,
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
