import { describe, expect } from "vitest";
import { test } from "#test";
import { extract, serialize } from "./dump.ts";

describe("dump", () => {
  test("should roundtrip simple database", async ({ db }) => {
    await db.source.sql`
      create table public.users (
        id serial primary key,
        name text not null,
        email text,
        created_at timestamptz default now()
      );
    `;
    const sourceDefinitions = await extract(db.source);
    await db.target.exec(serialize(sourceDefinitions));
    const targetDefinitions = await extract(db.target);
    expect(sourceDefinitions).toMatchInlineSnapshot(`
      {
        "sequences": [
          {
            "cache_size": 1,
            "cycle": false,
            "data_type": "integer",
            "increment": 1,
            "maximum_value": 2147483647,
            "minimum_value": 1,
            "schema_name": "public",
            "sequence_name": "users_id_seq",
            "start_value": 1,
          },
        ],
        "tables": [
          {
            "columns": [
              {
                "default": "nextval('users_id_seq'::regclass)",
                "generated": "",
                "identity": "",
                "name": "id",
                "nullable": false,
                "type": "integer",
              },
              {
                "default": null,
                "generated": "",
                "identity": "",
                "name": "name",
                "nullable": false,
                "type": "text",
              },
              {
                "default": null,
                "generated": "",
                "identity": "",
                "name": "email",
                "nullable": true,
                "type": "text",
              },
              {
                "default": "now()",
                "generated": "",
                "identity": "",
                "name": "created_at",
                "nullable": true,
                "type": "timestamp with time zone",
              },
            ],
            "schema_name": "public",
            "table_name": "users",
            "table_options": null,
          },
        ],
      }
    `);
    expect(sourceDefinitions).toEqual(targetDefinitions);
  });
});
