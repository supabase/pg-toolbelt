import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { UserMapping } from "../user-mapping.model.ts";
import { CreateUserMapping } from "./user-mapping.create.ts";

describe("user-mapping", () => {
  test("create basic", async () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR test_user SERVER test_server",
    );
  });

  test("create with PUBLIC user", async () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR PUBLIC SERVER test_server",
    );
  });

  test("create with CURRENT_USER", async () => {
    const userMapping = new UserMapping({
      user: "CURRENT_USER",
      server: "test_server",
      options: null,
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR CURRENT_USER SERVER test_server",
    );
  });

  test("create with options", async () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: ["user", "remote_user", "password", "secret"],
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR test_user SERVER test_server OPTIONS (user 'remote_user', password '__OPTION_PASSWORD__')",
    );
  });

  test("create with all properties", async () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: ["user", "remote_user", "password", "secret"],
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (user 'remote_user', password '__OPTION_PASSWORD__')",
    );
  });

  test("redacts sensitive option values to prevent secret leakage (CLI-1467)", async () => {
    const userMapping = new UserMapping({
      user: "postgres",
      server: "live_risk_server",
      options: [
        "user",
        "fdw_reader",
        "password",
        "real-user-password",
        "passfile",
        "/etc/secrets/passfile",
        "sslpassword",
        "ssl-secret",
        "passcode",
        "krb-passcode",
      ],
    });

    const change = new CreateUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    const sql = change.serialize();
    expect(sql).not.toContain("real-user-password");
    expect(sql).not.toContain("/etc/secrets/passfile");
    expect(sql).not.toContain("ssl-secret");
    expect(sql).not.toContain("krb-passcode");
    expect(sql).toContain("user 'fdw_reader'");
    expect(sql).toContain("password '__OPTION_PASSWORD__'");
    expect(sql).toContain("passfile '__OPTION_PASSFILE__'");
    expect(sql).toContain("sslpassword '__OPTION_SSLPASSWORD__'");
    expect(sql).toContain("passcode '__OPTION_PASSCODE__'");
  });
});
