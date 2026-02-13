import { describe, expect, test } from "bun:test";
import { Trigger, type TriggerProps } from "../trigger.model.ts";
import { ReplaceTrigger } from "./trigger.alter.ts";

describe.concurrent("trigger", () => {
  describe("alter", () => {
    test("replace trigger", () => {
      const props: Omit<TriggerProps, "enabled"> = {
        schema: "public",
        name: "test_trigger",
        table_name: "test_table",
        function_schema: "public",
        function_name: "test_function",
        trigger_type: 1 << 4, // UPDATE (1<<4) = 16, AFTER is default (0), STATEMENT is default (0)
        is_internal: false,
        deferrable: true,
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
          "CREATE TRIGGER test_trigger AFTER UPDATE ON public.test_table DEFERRABLE EXECUTE FUNCTION public.test_function()",
        comment: null,
      };
      const branch = new Trigger({
        ...props,
        enabled: "D",
      });

      const change = new ReplaceTrigger({ trigger: branch });

      expect(change.serialize()).toBe(
        "CREATE OR REPLACE TRIGGER test_trigger AFTER UPDATE ON public.test_table DEFERRABLE EXECUTE FUNCTION public.test_function()",
      );
    });
  });
});
