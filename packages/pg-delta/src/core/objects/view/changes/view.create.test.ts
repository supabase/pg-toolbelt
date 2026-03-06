import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { View } from "../view.model.ts";
import { CreateView } from "./view.create.ts";

describe("view", () => {
  test("create", async () => {
    const view = new View({
      schema: "public",
      name: "test_view",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "test",
      comment: null,
      columns: [],
      privileges: [],
    });

    const change = new CreateView({
      view,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE VIEW public.test_view AS SELECT * FROM test_table",
    );
  });

  test("create with options", async () => {
    const view = new View({
      schema: "public",
      name: "test_view",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: ["security_barrier=true", "check_option=local"],
      partition_bound: null,
      owner: "test",
      comment: null,
      columns: [],
      privileges: [],
    });

    const change = new CreateView({ view });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE VIEW public.test_view WITH (security_barrier=true, check_option=local) AS SELECT * FROM test_table",
    );
  });
});
