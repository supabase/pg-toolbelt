import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Server } from "../server.model.ts";
import { CreateServer } from "./server.create.ts";

describe("server", () => {
  test("create basic", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with type", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server TYPE 'postgres_fdw' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with version", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: "1.0",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server VERSION '1.0' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with type and version", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: "1.0",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server TYPE 'postgres_fdw' VERSION '1.0' FOREIGN DATA WRAPPER test_fdw",
    );
  });

  test("create with options", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost', port '5432')",
    );
  });

  test("create with all properties", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: "postgres_fdw",
      version: "1.0",
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SERVER test_server TYPE 'postgres_fdw' VERSION '1.0' FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost', port '5432')",
    );
  });

  test("redacts sensitive option values to prevent secret leakage (CLI-1467)", async () => {
    const server = new Server({
      name: "live_risk_server",
      owner: "postgres",
      foreign_data_wrapper: "postgres_fdw",
      type: null,
      version: null,
      options: [
        "host",
        "remote.example.com",
        "port",
        "5432",
        "password",
        "server-shared-secret",
        "passfile",
        "/etc/secrets/passfile",
      ],
      comment: null,
      privileges: [],
    });

    const change = new CreateServer({
      server,
    });

    const sql = change.serialize();
    expect(sql).not.toContain("server-shared-secret");
    expect(sql).not.toContain("/etc/secrets/passfile");
    expect(sql).toContain("host 'remote.example.com'");
    expect(sql).toContain("port '5432'");
    expect(sql).toContain("password '__OPTION_PASSWORD__'");
    expect(sql).toContain("passfile '__OPTION_PASSFILE__'");
  });
});
