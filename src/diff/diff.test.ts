import type { PGlite } from "@electric-sql/pglite";
import { describe, expect } from "vitest";
import { test } from "#test";
import { computeSchemaDiff, generateMigration } from "./diff.ts";
import { extractDefinitions } from "./extract.ts";
import { serializeSchemaDiff } from "./serialize.ts";

type MigrationTestCase = {
  name: string;
  initialSchema: string;
  targetModifications: string;
};

async function runMigrationTest(
  db: { source: PGlite; target: PGlite },
  testCase: MigrationTestCase,
) {
  // Apply initial schema to both databases
  await db.source.exec(testCase.initialSchema);
  await db.target.exec(testCase.initialSchema);

  // Apply modifications to target
  await db.target.exec(testCase.targetModifications);

  // Generate and apply migration
  const { sql } = await generateMigration(db.source, db.target);
  await db.source.exec(sql);

  // Verify databases are in sync
  const sourceDefinitions = await extractDefinitions(db.source);
  const targetDefinitions = await extractDefinitions(db.target);
  expect(sourceDefinitions).toEqual(targetDefinitions);
}

describe.concurrent("migrations", () => {
  const testCases: MigrationTestCase[] = [
    {
      name: "should add a column",
      initialSchema: /*sql*/ `
        create table public.users (
          id serial primary key,
          name text not null,
          email text,
          created_at timestamptz default now()
        );
      `,
      targetModifications: /*sql*/ `
        alter table public.users add column age int;
      `,
    },
    {
      name: "should add multiple columns and a new table",
      initialSchema: /*sql*/ `
        create table public.users (
          id serial primary key,
          name text not null
        );
      `,
      targetModifications: /*sql*/ `
        alter table public.users add column email text;
        alter table public.users add column created_at timestamptz default now();
        create table public.posts (
          id serial primary key,
          user_id int references public.users(id),
          title text not null,
          content text
        );
      `,
    },
    // Add more test cases here...
  ];

  for (const testCase of testCases) {
    test.concurrent(testCase.name, async ({ db }) => {
      await runMigrationTest(db, testCase);
    });
  }
});

describe.concurrent("dump", () => {
  test("should roundtrip simple database", async ({ db }) => {
    await db.source.sql`
      create table public.users (
        id serial primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    const sourceDefinitions = await extractDefinitions(db.source);

    const diff = computeSchemaDiff({
      target: sourceDefinitions,
    });

    await db.target.exec(serializeSchemaDiff(diff));
    const targetDefinitions = await extractDefinitions(db.target);

    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});
