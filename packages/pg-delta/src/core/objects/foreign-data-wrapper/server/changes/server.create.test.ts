import { describe, expect, test } from "bun:test";
import { Server } from "../server.model.ts";
import { CreateServer } from "./server.create.ts";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";

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
});
