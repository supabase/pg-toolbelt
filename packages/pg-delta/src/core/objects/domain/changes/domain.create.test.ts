import { describe, expect, test } from "bun:test";
import { Domain } from "../domain.model.ts";
import { CreateDomain } from "./domain.create.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("domain", () => {
  test("create minimal", async () => {
    const domain = new Domain({
      schema: "public",
      name: "test_domain",
      base_type: "integer",
      base_type_schema: "pg_catalog",
      base_type_str: "integer",
      not_null: false,
      type_modifier: null,
      array_dimensions: null,
      collation: null,
      default_bin: null,
      default_value: null,
      owner: "test",
      comment: null,
      constraints: [],
      privileges: [],
    });

    const change = new CreateDomain({ domain });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE DOMAIN public.test_domain AS integer",
    );
  });

  test("create with all options", async () => {
    const domain = new Domain({
      schema: "public",
      name: "test_domain_all",
      base_type: "text",
      base_type_schema: "custom",
      base_type_str: "text",
      not_null: true,
      type_modifier: null,
      array_dimensions: 2,
      collation: "mycoll",
      default_bin: null,
      default_value: "'hello'",
      owner: "test",
      comment: null,
      constraints: [
        {
          name: "c1",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE <> ''",
        },
      ],
      privileges: [],
    });

    const change = new CreateDomain({ domain });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      `CREATE DOMAIN public.test_domain_all AS custom.text[][] COLLATE mycoll DEFAULT 'hello' NOT NULL CHECK (VALUE <> '')`,
    );
  });

  test("create with already schema-qualified base type (format_type)", async () => {
    const domain = new Domain({
      schema: "app",
      name: "email_address",
      base_type: "citext",
      base_type_schema: "extensions",
      base_type_str: "extensions.citext",
      not_null: false,
      type_modifier: null,
      array_dimensions: null,
      collation: null,
      default_bin: null,
      default_value: null,
      owner: "test",
      comment: null,
      constraints: [],
      privileges: [],
    });
    const change = new CreateDomain({ domain });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "CREATE DOMAIN app.email_address AS extensions.citext",
    );
  });
});
