import { describe, expect, test } from "bun:test";
import {
  isKindCompatible,
  signaturesCompatible,
} from "../src/model/object-compat";

describe("isKindCompatible", () => {
  test("type is compatible with view, table, domain, materialized_view", () => {
    expect(isKindCompatible("type", "type")).toBe(true);
    expect(isKindCompatible("type", "view")).toBe(true);
    expect(isKindCompatible("type", "table")).toBe(true);
    expect(isKindCompatible("type", "domain")).toBe(true);
    expect(isKindCompatible("type", "materialized_view")).toBe(true);
    expect(isKindCompatible("type", "function")).toBe(false);
  });

  test("function is compatible with procedure and vice versa", () => {
    expect(isKindCompatible("function", "procedure")).toBe(true);
    expect(isKindCompatible("procedure", "function")).toBe(true);
    expect(isKindCompatible("function", "table")).toBe(false);
  });
});

describe("signaturesCompatible", () => {
  test("matches when both signatures are undefined", () => {
    expect(signaturesCompatible(undefined, undefined)).toBe(true);
  });

  test("matches when required is undefined (no signature constraint)", () => {
    expect(signaturesCompatible(undefined, "(int,text)")).toBe(true);
  });

  test("rejects when provided is undefined but required is set", () => {
    expect(signaturesCompatible("(int,text)", undefined)).toBe(false);
  });

  test("exact arity match still works", () => {
    expect(signaturesCompatible("(int,text)", "(int,text)")).toBe(true);
    expect(
      signaturesCompatible("(bigint,text,json)", "(bigint,text,json)"),
    ).toBe(true);
  });

  test("fewer required args matches provider with more params (default params)", () => {
    expect(
      signaturesCompatible(
        "(unknown,unknown,auth.action)",
        "(bigint,text,auth.action,json,uuid)",
      ),
    ).toBe(true);
  });

  test("more required args than provided rejects", () => {
    expect(signaturesCompatible("(int,text,json)", "(int,text)")).toBe(false);
  });

  test("zero required args matches any provider", () => {
    expect(signaturesCompatible("()", "(int,text,json)")).toBe(true);
  });

  test("prefix type mismatch rejects even with fewer args", () => {
    expect(signaturesCompatible("(int,text)", "(text,int,json)")).toBe(false);
  });

  test("unknown in prefix matches any provided type", () => {
    expect(
      signaturesCompatible("(unknown,text)", "(bigint,text,json,uuid)"),
    ).toBe(true);
  });

  test("auth.can pattern: 3-arg call matches 5-param overload but not 6-param", () => {
    const callSig = "(unknown,unknown,auth.action)";
    const overload5 = "(bigint,text,auth.action,json,uuid)";
    const overload6 = "(bigint,bigint,text,auth.action,json,uuid)";

    expect(signaturesCompatible(callSig, overload5)).toBe(true);
    expect(signaturesCompatible(callSig, overload6)).toBe(false);
  });

  test("auth.can_project pattern: 4-arg call matches 6-param overload", () => {
    const callSig = "(unknown,unknown,text,auth.action)";
    const overload6 = "(bigint,bigint,text,auth.action,json,uuid)";
    const overload5 = "(bigint,text,auth.action,json,uuid)";

    expect(signaturesCompatible(callSig, overload6)).toBe(true);
    expect(signaturesCompatible(callSig, overload5)).toBe(false);
  });

  test("single-arg unknown matches any single-param or multi-param provider", () => {
    expect(signaturesCompatible("(unknown)", "(bigint)")).toBe(true);
    expect(signaturesCompatible("(unknown)", "(bigint,text)")).toBe(true);
    expect(signaturesCompatible("(unknown)", "(bigint,text,json)")).toBe(true);
  });
});
