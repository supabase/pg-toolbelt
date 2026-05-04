import { describe, expect, test } from "bun:test";
import {
  diffSecurityLabels,
  type SecurityLabelProps,
  securityLabelPropsSchema,
} from "./security-label.types.ts";

describe("securityLabelPropsSchema", () => {
  test("parses valid props", () => {
    const parsed = securityLabelPropsSchema.parse({
      provider: "p",
      label: "l",
    });
    expect(parsed).toEqual({ provider: "p", label: "l" });
  });

  test("rejects null provider", () => {
    expect(() =>
      securityLabelPropsSchema.parse({ provider: null, label: "l" }),
    ).toThrow();
  });

  test("rejects null label", () => {
    expect(() =>
      securityLabelPropsSchema.parse({ provider: "p", label: null }),
    ).toThrow();
  });
});

describe("diffSecurityLabels", () => {
  type Change = { kind: "create" | "drop" } & SecurityLabelProps;
  const makeCreate = (p: SecurityLabelProps): Change => ({
    kind: "create",
    ...p,
  });
  const makeDrop = (p: SecurityLabelProps): Change => ({
    kind: "drop",
    ...p,
  });

  test("both empty → no changes", () => {
    expect(diffSecurityLabels([], [], makeCreate, makeDrop)).toEqual([]);
  });

  test("added providers emit create", () => {
    expect(
      diffSecurityLabels(
        [],
        [{ provider: "a", label: "x" }],
        makeCreate,
        makeDrop,
      ),
    ).toEqual([{ kind: "create", provider: "a", label: "x" }]);
  });

  test("removed providers emit drop", () => {
    expect(
      diffSecurityLabels(
        [{ provider: "a", label: "x" }],
        [],
        makeCreate,
        makeDrop,
      ),
    ).toEqual([{ kind: "drop", provider: "a", label: "x" }]);
  });

  test("changed label emits create (overwrite semantics)", () => {
    expect(
      diffSecurityLabels(
        [{ provider: "a", label: "old" }],
        [{ provider: "a", label: "new" }],
        makeCreate,
        makeDrop,
      ),
    ).toEqual([{ kind: "create", provider: "a", label: "new" }]);
  });

  test("unchanged label emits nothing", () => {
    expect(
      diffSecurityLabels(
        [{ provider: "a", label: "x" }],
        [{ provider: "a", label: "x" }],
        makeCreate,
        makeDrop,
      ),
    ).toEqual([]);
  });

  test("mixed add/remove/change/unchanged across providers, sorted by provider", () => {
    const main = [
      { provider: "a", label: "stay" },
      { provider: "b", label: "old" },
      { provider: "c", label: "remove" },
    ];
    const branch = [
      { provider: "a", label: "stay" },
      { provider: "b", label: "new" },
      { provider: "d", label: "add" },
    ];
    expect(diffSecurityLabels(main, branch, makeCreate, makeDrop)).toEqual([
      { kind: "create", provider: "b", label: "new" },
      { kind: "drop", provider: "c", label: "remove" },
      { kind: "create", provider: "d", label: "add" },
    ]);
  });
});
