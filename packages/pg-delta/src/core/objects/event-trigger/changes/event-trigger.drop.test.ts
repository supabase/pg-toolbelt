import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { EventTrigger } from "../event-trigger.model.ts";
import { DropEventTrigger } from "./event-trigger.drop.ts";

describe("event trigger drop change", () => {
  test("serialize drop event trigger", async () => {
    const eventTrigger = new EventTrigger({
      name: "ddl_logger",
      event: "ddl_command_start",
      function_schema: "public",
      function_name: "log_ddl",
      enabled: "O",
      tags: null,
      owner: "postgres",
      comment: null,
    });

    const change = new DropEventTrigger({ eventTrigger });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP EVENT TRIGGER ddl_logger");
  });
});
