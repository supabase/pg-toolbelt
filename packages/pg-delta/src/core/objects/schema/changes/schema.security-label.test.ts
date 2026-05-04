import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { Schema } from "../schema.model.ts";
import {
  CreateSecurityLabelOnSchema,
  DropSecurityLabelOnSchema,
} from "./schema.security-label.ts";

const makeSchema = () =>
  new Schema({
    name: "app",
    owner: "postgres",
    comment: null,
    privileges: [],
    security_labels: [],
  });

describe("schema.security-label", () => {
  test("create serializes and tracks dependencies", async () => {
    const schema = makeSchema();
    const change = new CreateSecurityLabelOnSchema({
      schema,
      securityLabel: {
        provider: "pg_graphql",
        label: '{"inflect_names":true}',
      },
    });

    expect(change.scope).toBe("security_label");
    expect(change.operation).toBe("create");
    expect(change.objectType).toBe("schema");
    expect(change.creates).toEqual([
      stableId.securityLabel(schema.stableId, "pg_graphql"),
    ]);
    expect(change.requires).toEqual([schema.stableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      `SECURITY LABEL FOR pg_graphql ON SCHEMA app IS '{"inflect_names":true}'`,
    );
  });

  test("drop serializes to IS NULL and tracks dependencies", async () => {
    const schema = makeSchema();
    const change = new DropSecurityLabelOnSchema({
      schema,
      securityLabel: { provider: "pg_graphql", label: "old" },
    });

    expect(change.scope).toBe("security_label");
    expect(change.operation).toBe("drop");
    expect(change.drops).toEqual([
      stableId.securityLabel(schema.stableId, "pg_graphql"),
    ]);
    expect(change.requires).toEqual([
      stableId.securityLabel(schema.stableId, "pg_graphql"),
      schema.stableId,
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR pg_graphql ON SCHEMA app IS NULL",
    );
  });

  test("create escapes single quotes in label", async () => {
    const schema = makeSchema();
    const change = new CreateSecurityLabelOnSchema({
      schema,
      securityLabel: { provider: "p", label: "it's a test" },
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR p ON SCHEMA app IS 'it''s a test'",
    );
  });
});
