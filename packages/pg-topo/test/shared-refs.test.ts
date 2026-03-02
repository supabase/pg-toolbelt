import { describe, expect, test } from "bun:test";
import { objectFromNameParts } from "../src/extract/shared-refs";

describe("objectFromNameParts", () => {
  test("trigger and policy use relation.objectName identity so COMMENT ON resolves to CREATE", () => {
    // COMMENT ON TRIGGER name on relation → parts [schema?, relation, triggerName]
    const triggerRef = objectFromNameParts(
      "trigger",
      ["auth", "users", "initialise_auth_users_email"],
      "public",
    );
    expect(triggerRef).not.toBeNull();
    expect(triggerRef?.kind).toBe("trigger");
    expect(triggerRef?.schema).toBe("auth");
    expect(triggerRef?.name).toBe("users.initialise_auth_users_email");

    // COMMENT ON POLICY name on relation → same shape
    const policyRef = objectFromNameParts(
      "policy",
      ["auth", "users", "users_select_policy"],
      "public",
    );
    expect(policyRef).not.toBeNull();
    expect(policyRef?.kind).toBe("policy");
    expect(policyRef?.schema).toBe("auth");
    expect(policyRef?.name).toBe("users.users_select_policy");

    // Two parts only (no schema) → schema from fallback
    const triggerNoSchema = objectFromNameParts(
      "trigger",
      ["my_table", "my_trigger"],
      "public",
    );
    expect(triggerNoSchema?.name).toBe("my_table.my_trigger");
    expect(triggerNoSchema?.schema).toBe("public");
  });
});
