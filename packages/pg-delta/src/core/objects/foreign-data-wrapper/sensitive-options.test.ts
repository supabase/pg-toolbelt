import { describe, expect, test } from "bun:test";
import {
  isSensitiveOptionKey,
  redactOptionValue,
  redactSensitiveOptionPairs,
} from "./sensitive-options.ts";

describe("sensitive-options", () => {
  describe("isSensitiveOptionKey", () => {
    test.each([
      "password",
      "PASSWORD",
      "Password",
      "passfile",
      "passcode",
      "sslpassword",
    ])("flags %s as sensitive", (key) => {
      expect(isSensitiveOptionKey(key)).toBe(true);
    });

    test.each([
      "host",
      "port",
      "user",
      "dbname",
      "schema",
      "fetch_size",
    ])("leaves %s untouched", (key) => {
      expect(isSensitiveOptionKey(key)).toBe(false);
    });
  });

  test("redactOptionValue replaces sensitive values with placeholder", () => {
    expect(redactOptionValue("password", "supersecret")).toBe(
      "__OPTION_PASSWORD__",
    );
    expect(redactOptionValue("PASSWORD", "supersecret")).toBe(
      "__OPTION_PASSWORD__",
    );
    expect(redactOptionValue("host", "localhost")).toBe("localhost");
  });

  test("redactSensitiveOptionPairs preserves non-secret options", () => {
    expect(
      redactSensitiveOptionPairs([
        "host",
        "localhost",
        "port",
        "5432",
        "password",
        "supersecret",
        "passfile",
        "/etc/secrets/passfile",
      ]),
    ).toEqual([
      "host",
      "localhost",
      "port",
      "5432",
      "password",
      "__OPTION_PASSWORD__",
      "passfile",
      "__OPTION_PASSFILE__",
    ]);
  });

  test("redactSensitiveOptionPairs handles null/empty", () => {
    expect(redactSensitiveOptionPairs(null)).toBeNull();
    expect(redactSensitiveOptionPairs([])).toEqual([]);
  });
});
