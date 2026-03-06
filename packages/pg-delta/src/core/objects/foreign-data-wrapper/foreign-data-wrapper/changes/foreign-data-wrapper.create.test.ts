import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { CreateForeignDataWrapper } from "./foreign-data-wrapper.create.ts";

describe("foreign-data-wrapper", () => {
  test("create basic", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw NO HANDLER NO VALIDATOR",
    );
  });

  test("create with handler", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: "public.handler_func",
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw HANDLER public.handler_func NO VALIDATOR",
    );
  });

  test("create with validator", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: null,
      validator: "public.validator_func",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw NO HANDLER VALIDATOR public.validator_func",
    );
  });

  test("create with handler and validator", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: "public.handler_func",
      validator: "public.validator_func",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw HANDLER public.handler_func VALIDATOR public.validator_func",
    );
  });

  test("create with options", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: null,
      validator: null,
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw NO HANDLER NO VALIDATOR OPTIONS (host 'localhost', port '5432')",
    );
  });

  test("create with all properties", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: "public.handler_func",
      validator: "public.validator_func",
      options: ["host", "localhost", "port", "5432"],
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw HANDLER public.handler_func VALIDATOR public.validator_func OPTIONS (host 'localhost', port '5432')",
    );
  });

  test("create with schema-qualified handler (no function args in output)", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: "extensions.iceberg_fdw_handler",
      validator: "extensions.iceberg_fdw_validator",
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new CreateForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE FOREIGN DATA WRAPPER test_fdw HANDLER extensions.iceberg_fdw_handler VALIDATOR extensions.iceberg_fdw_validator",
    );
  });
});
