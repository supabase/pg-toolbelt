import { describe, expect, test } from "bun:test";
import {
  redactOptionValue,
  redactSensitiveOptionPairs,
} from "./sensitive-options.ts";

describe("sensitive-options", () => {
  test("preserves allowlisted connection / behavior options (case-insensitive)", () => {
    // One assertion per allowlist family so an accidental drop is caught
    // here instead of silently turning real plans into placeholder soup.
    expect(redactOptionValue("host", "prod.example.com")).toBe(
      "prod.example.com",
    );
    expect(redactOptionValue("HOST", "prod.example.com")).toBe(
      "prod.example.com",
    );
    expect(redactOptionValue("port", "5432")).toBe("5432");
    expect(redactOptionValue("dbname", "appdb")).toBe("appdb");
    expect(redactOptionValue("user", "fdw_reader")).toBe("fdw_reader");
    expect(redactOptionValue("sslmode", "require")).toBe("require");
    expect(redactOptionValue("fetch_size", "200")).toBe("200");
    expect(redactOptionValue("schema_name", "public")).toBe("public");
    expect(redactOptionValue("region", "us-east-1")).toBe("us-east-1");
  });

  test("redacts unknown / credential-shaped keys to the placeholder", () => {
    // None of these are in the allowlist; the policy is default-redact, so
    // they all collapse to `__OPTION_<KEY>__` regardless of the value.
    expect(redactOptionValue("password", "supersecret")).toBe(
      "__OPTION_PASSWORD__",
    );
    expect(redactOptionValue("PASSWORD", "supersecret")).toBe(
      "__OPTION_PASSWORD__",
    );
    expect(redactOptionValue("passfile", "/etc/passfile")).toBe(
      "__OPTION_PASSFILE__",
    );
    expect(redactOptionValue("sslpassword", "x")).toBe(
      "__OPTION_SSLPASSWORD__",
    );
    expect(redactOptionValue("api_key", "x")).toBe("__OPTION_API_KEY__");
    expect(redactOptionValue("aws_secret_access_key", "x")).toBe(
      "__OPTION_AWS_SECRET_ACCESS_KEY__",
    );
    // An unrecognized FDW option key — default-redact catches it even
    // though we have not enumerated this wrapper.
    expect(redactOptionValue("brand_new_wrapper_token", "x")).toBe(
      "__OPTION_BRAND_NEW_WRAPPER_TOKEN__",
    );
  });

  test("matching is exact (not substring)", () => {
    // `host` is allowlisted but `host_addr` is not — substring matches must
    // not promote unknown keys into the allowlist.
    expect(redactOptionValue("host_addr", "10.0.0.1")).toBe(
      "__OPTION_HOST_ADDR__",
    );
    // Inverse direction: `password_validator_extension` is not in the
    // allowlist, and must not be accidentally allowlisted because some
    // future loose-match scheme thought "password" looked similar.
    expect(
      redactOptionValue("password_validator_extension", "passwordcheck"),
    ).toBe("__OPTION_PASSWORD_VALIDATOR_EXTENSION__");
  });

  test("redactSensitiveOptionPairs preserves safe keys and redacts the rest", () => {
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
        "brand_new_wrapper_token",
        "leaked",
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
      "brand_new_wrapper_token",
      "__OPTION_BRAND_NEW_WRAPPER_TOKEN__",
    ]);
  });

  test("redactSensitiveOptionPairs handles null and empty input", () => {
    expect(redactSensitiveOptionPairs(null)).toBeNull();
    expect(redactSensitiveOptionPairs([])).toEqual([]);
  });
});
