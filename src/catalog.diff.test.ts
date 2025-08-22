import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../tests/constants.ts";
import { getTest } from "../tests/utils.ts";
import { diffCatalogs } from "./catalog.diff.ts";
import { extractCatalog } from "./catalog.model.ts";
import { resolveDependencies } from "./dependency.ts";

function shuffle<T>(array: T[]) {
  return array.sort(() => Math.random() - 0.5);
}

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  describe.concurrent(`catalog diff (pg${pgVersion})`, () => {
    test("create schema then composite type", async ({ db }) => {
      await db.b.unsafe(`
        create schema test_schema;
        create type test_schema.address as (
          street varchar,
          city varchar,
          state varchar
        );
      `);
      const mainCatalog = await extractCatalog(db.a);
      const branchCatalog = await extractCatalog(db.b);
      const changes = await diffCatalogs(mainCatalog, branchCatalog);
      // Shuffle all the schema catalogs changes
      const shuffledChanges = shuffle(changes);
      // Calling resolveDependencies should re-order the changes in the right order
      const sortedChanges = await resolveDependencies(
        shuffledChanges,
        mainCatalog,
        branchCatalog,
      );
      // Verify that the sorted changes are the same as the original changes
      expect(sortedChanges).toEqual(changes);
    });
  });
}
