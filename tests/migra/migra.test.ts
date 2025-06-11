import { readdir, readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./setup.ts";

async function getFixtures() {
  const folders = await readdir(new URL("./fixtures", import.meta.url));
  const files = [
    "a.sql",
    "b.sql",
    "additions.sql",
    "expected.sql",
    "expected2.sql",
  ];
  const fixtures = await Promise.all(
    folders.map(async (folder) => {
      const [a, b, additions, expected, expected2] = await Promise.all(
        files.map(async (file) => {
          const content = await readFile(
            new URL(`./fixtures/${folder}/${file}`, import.meta.url),
            "utf-8",
          );
          if (content === "") {
            return null;
          }
          return content;
        }),
      );
      if (!(a && b && expected)) {
        throw new Error(`Missing fixtures for ${folder}`);
      }
      return {
        folder,
        a,
        b,
        additions,
        expected,
        expected2,
      };
    }),
  );

  return fixtures;
}

const fixtures = await getFixtures();

describe.concurrent(
  "migra",
  () => {
    for (const fixture of fixtures) {
      test(`should diff ${fixture.folder}`, async ({ db }) => {
        // arrange
        await Promise.all([db.a.unsafe(fixture.a), db.b.unsafe(fixture.b)]);
        // act
        const result = "";
        // assert
        expect(result).toBe(fixture.expected);

        if (fixture.additions) {
          // arrange
          await db.b.unsafe(fixture.additions);
          // act
          const result2 = "";
          // assert
          expect(result2).toBe(fixture.expected2);
        }
      });
    }
  },
  60_000,
);
