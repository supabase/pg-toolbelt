import { describe, expect, test } from "bun:test";
import {
  createObjectRef,
  normalizeIdentifier,
  normalizeSignature,
  splitQualifiedName,
} from "../src/model/object-ref";

describe("object reference normalization", () => {
  test("folds unquoted identifiers while preserving quoted identifiers", () => {
    expect(normalizeIdentifier("Public")).toBe("public");
    expect(normalizeIdentifier('"Users"')).toBe("Users");
  });

  test("splits qualified names with quoted segments", () => {
    const quoted = splitQualifiedName('"App"."Users"');
    const unquoted = splitQualifiedName("App.Users");

    expect(quoted).toEqual({ schema: "App", name: "Users" });
    expect(unquoted).toEqual({ schema: "app", name: "users" });
  });

  test("normalizes function signatures deterministically", () => {
    expect(normalizeSignature("( INT , text , numeric(10, 2) )")).toBe("(int,text,numeric(10,2))");
    expect(normalizeSignature('("CustomType" , public.USER_ROLE )')).toBe(
      '("CustomType",public.user_role)',
    );
  });

  test("createObjectRef normalizes schema/name/signature", () => {
    const ref = createObjectRef("function", "Fn_A", "Public", "( INT , text )");

    expect(ref.schema).toBe("public");
    expect(ref.name).toBe("fn_a");
    expect(ref.signature).toBe("(int,text)");
  });
});
