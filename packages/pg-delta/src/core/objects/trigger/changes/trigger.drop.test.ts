import { describe, expect, test } from "bun:test";
import { Trigger } from "../trigger.model.ts";
import { DropTrigger } from "./trigger.drop.ts";

describe("trigger", () => {
  test("drop", () => {
    const trigger = new Trigger({
      schema: "public",
      name: "test_trigger",
      table_name: "test_table",
      function_schema: "public",
      function_name: "test_function",
      trigger_type: 66,
      enabled: "O",
      is_internal: false,
      deferrable: false,
      initially_deferred: false,
      argument_count: 0,
      column_numbers: null,
      arguments: [],
      when_condition: null,
      old_table: null,
      new_table: null,
      is_partition_clone: false,
      parent_trigger_name: null,
      parent_table_schema: null,
      parent_table_name: null,
      is_on_partitioned_table: false,
      owner: "test",
      definition:
        "CREATE TRIGGER test_trigger BEFORE UPDATE ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.test_function()",
      comment: null,
    });

    const change = new DropTrigger({
      trigger,
    });

    expect(change.serialize()).toBe(
      "DROP TRIGGER test_trigger ON public.test_table",
    );
  });
});
