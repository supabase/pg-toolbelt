import { describe, expect, test } from "bun:test";
import type { SerializeOptions } from "../integrations/serialize/serialize.types.ts";
import { BaseChange } from "./base.change.ts";

type ChangeOperation = "create" | "alter" | "drop";
type ChangeScope =
  | "object"
  | "comment"
  | "privilege"
  | "default_privilege"
  | "membership";

class TestChange extends BaseChange {
  public readonly operation: ChangeOperation;
  public readonly scope: ChangeScope;
  public readonly objectType = "test";
  private readonly dropIds: string[];

  constructor(
    operation: ChangeOperation,
    scope: ChangeScope,
    drops: string[] = [],
  ) {
    super();
    this.operation = operation;
    this.scope = scope;
    this.dropIds = drops;
  }

  override get drops(): string[] {
    return this.dropIds;
  }

  serialize(_options?: SerializeOptions): string {
    return "SELECT 1";
  }
}

describe("BaseChange.phase", () => {
  const scopes: ChangeScope[] = [
    "object",
    "comment",
    "privilege",
    "default_privilege",
    "membership",
  ];

  for (const operation of ["create", "alter", "drop"] as const) {
    for (const scope of scopes) {
      test(`${operation}/${scope} uses default phase`, () => {
        const change = new TestChange(operation, scope);
        const expectedPhase = operation === "drop" ? "drop" : "forward";

        expect(change.phase).toBe(expectedPhase);
      });
    }
  }

  test("alter with metadata-only drops stays in forward phase", () => {
    const change = new TestChange("alter", "object", [
      "acl:table:public.t:postgres",
      "defacl:role:postgres:schema:public",
      "aclcol:table:public.t:column:c",
      "membership:postgres->anon",
      "comment:table:public.t",
    ]);

    expect(change.phase).toBe("forward");
  });

  test("alter with object drops goes to drop phase", () => {
    const change = new TestChange("alter", "object", ["table:public.t"]);

    expect(change.phase).toBe("drop");
  });

  test("alter with mixed metadata and object drops goes to drop phase", () => {
    const change = new TestChange("alter", "object", [
      "comment:table:public.t",
      "table:public.other",
    ]);

    expect(change.phase).toBe("drop");
  });
});
