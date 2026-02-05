import { describe, expect, test } from "vitest";
import { Schema } from "../schema.model.ts";
import { CreateSchema } from "./schema.create.ts";

describe("schema", () => {
  test("create", () => {
    const schema = new Schema({
      name: "test_schema",
      owner: "test",
      comment: null,
      privileges: [],
    });

    const change = new CreateSchema({
      schema,
    });

    expect(change.serialize()).toBe(
      "CREATE SCHEMA test_schema AUTHORIZATION test",
    );
  });

  test("create formatted", () => {
    const schema = new Schema({
      name: "test_schema",
      owner: "test",
      comment: null,
      privileges: [],
    });

    const change = new CreateSchema({
      schema,
    });

    expect(
      change.serialize({
        format: {
          enabled: true,
        },
      }),
    ).toMatchInlineSnapshot(
      `
      "CREATE SCHEMA test_schema
      AUTHORIZATION test"
    `,
    );
  });
});
