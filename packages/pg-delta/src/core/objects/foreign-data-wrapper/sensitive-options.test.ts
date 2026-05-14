import { describe, expect, test } from "bun:test";
import {
  redactOptionValue,
  redactSensitiveOptionPairs,
} from "./sensitive-options.ts";

describe("sensitive-options", () => {
  test("redacts a representative slice of the denylist (case-insensitive)", () => {
    // One assertion per denylist family so an accidental drop is caught
    // here instead of silently leaking through `serialize()`.
    expect(redactOptionValue("password", "p1")).toBe("__OPTION_PASSWORD__");
    expect(redactOptionValue("PASSWORD", "p2")).toBe("__OPTION_PASSWORD__");
    expect(redactOptionValue("passfile", "/tmp/pf")).toBe(
      "__OPTION_PASSFILE__",
    );
    expect(redactOptionValue("sslpassword", "x")).toBe(
      "__OPTION_SSLPASSWORD__",
    );
    expect(redactOptionValue("api_key", "x")).toBe("__OPTION_API_KEY__");
    expect(redactOptionValue("secret_key", "x")).toBe("__OPTION_SECRET_KEY__");
    expect(redactOptionValue("private_key", "x")).toBe(
      "__OPTION_PRIVATE_KEY__",
    );
    expect(redactOptionValue("aws_secret_access_key", "x")).toBe(
      "__OPTION_AWS_SECRET_ACCESS_KEY__",
    );
  });

  test("preserves connection options that are not credentials", () => {
    for (const safe of [
      "host",
      "port",
      "dbname",
      "user",
      "schema",
      "fetch_size",
      // Adjacent names that are NOT in the denylist (substring matches must
      // not redact) — would only be a problem if the matcher slipped from
      // exact-match to substring.
      "password_validator_extension",
      "api_keyword",
    ]) {
      expect(redactOptionValue(safe, "real-value")).toBe("real-value");
    }
  });

  test("redactSensitiveOptionPairs leaves non-secrets intact and redacts secrets", () => {
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

  test("redactSensitiveOptionPairs handles null and empty input", () => {
    expect(redactSensitiveOptionPairs(null)).toBeNull();
    expect(redactSensitiveOptionPairs([])).toEqual([]);
  });
});
