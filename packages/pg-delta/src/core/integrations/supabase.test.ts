import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { compileFilterDSL } from "./filter/dsl.ts";
import { supabase } from "./supabase.ts";

const filter = compileFilterDSL(supabase.filter ?? {});

// Minimal trigger-shaped change builder that only carries the fields
// `flattenChange` reads when the filter DSL evaluates `*/schema`,
// `*/owner`, `trigger/function_schema`, etc. The exact change class
// constructor is not relevant for filter inclusion logic.
function triggerChange(props: {
  schema: string;
  table_name: string;
  owner: string;
  function_schema: string;
  function_name: string;
}): Change {
  return {
    objectType: "trigger",
    operation: "create",
    scope: "object",
    trigger: {
      schema: props.schema,
      name: "my_trigger",
      table_name: props.table_name,
      table_relkind: "r",
      function_schema: props.function_schema,
      function_name: props.function_name,
      trigger_type: 0,
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
      owner: props.owner,
      definition: "CREATE TRIGGER my_trigger ...",
      comment: null,
    },
    requires: [],
    creates: [`trigger:${props.schema}.${props.table_name}.my_trigger`],
    drops: [],
  } as unknown as Change;
}

describe("supabase integration filter", () => {
  test("includes a user-defined trigger on auth.users that calls a public function", () => {
    // Regression for https://github.com/supabase/pg-toolbelt/issues/254 —
    // user-attached triggers on managed tables (auth.users, storage.objects)
    // were being dropped from the diff alongside Supabase's own auth/storage
    // triggers. The user's trigger lives in the auth schema and inherits the
    // auth.users table owner (supabase_auth_admin), so both schema-based and
    // owner-based blanket exclusions catch it. Their trigger function still
    // lives in a non-managed schema (public), which is the signal the filter
    // uses to keep them.
    const change = triggerChange({
      schema: "auth",
      table_name: "users",
      owner: "supabase_auth_admin",
      function_schema: "public",
      function_name: "handle_new_user",
    });

    expect(filter(change)).toBe(true);
  });

  test("excludes a Supabase-managed trigger whose function lives in a managed schema", () => {
    const change = triggerChange({
      schema: "auth",
      table_name: "users",
      owner: "supabase_auth_admin",
      function_schema: "auth",
      function_name: "managed_handler",
    });

    expect(filter(change)).toBe(false);
  });

  test("includes a user-defined trigger on storage.objects that calls a public function", () => {
    const change = triggerChange({
      schema: "storage",
      table_name: "objects",
      owner: "supabase_storage_admin",
      function_schema: "public",
      function_name: "on_object_uploaded",
    });

    expect(filter(change)).toBe(true);
  });
});
