import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { evaluatePattern } from "./filter/dsl.ts";
import { supabase } from "./supabase.ts";

if (!supabase.filter) {
  throw new Error("supabase integration is missing a filter");
}
const filter = supabase.filter;

/**
 * Build a synthetic FDW change shaped like what `flattenChange` consumes.
 * The change carries a `foreignDataWrapper` model whose `handler`/`validator`
 * are schema-qualified function references (the form
 * `extractForeignDataWrappers` produces).
 */
function fdwChange(
  operation: "create" | "alter" | "drop",
  fdw: {
    name: string;
    owner: string;
    handler: string | null;
    validator: string | null;
  },
): Change {
  return {
    objectType: "foreign_data_wrapper",
    operation,
    scope: "object",
    foreignDataWrapper: fdw,
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

/**
 * Synthetic FDW privilege change. The three concrete privilege classes
 * (`GrantForeignDataWrapperPrivileges`, `RevokeForeignDataWrapperPrivileges`,
 * `RevokeGrantOptionForeignDataWrapperPrivileges`) all extend
 * `AlterForeignDataWrapperChange`, so their `operation` is `"alter"` in
 * production. The filter rule we exercise here keys off `scope` only,
 * but pinning `operation: "alter"` keeps the synthetic shape honest.
 */
function fdwPrivilegeChange(fdw: { name: string; owner: string }): Change {
  return {
    objectType: "foreign_data_wrapper",
    operation: "alter",
    scope: "privilege",
    foreignDataWrapper: { ...fdw, handler: null, validator: null },
    grantee: "postgres",
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

function serverChange(
  operation: "create" | "alter" | "drop",
  server: {
    name: string;
    owner: string;
    foreign_data_wrapper: string;
    wrapper_handler: string | null;
    wrapper_validator: string | null;
  },
): Change {
  return {
    objectType: "server",
    operation,
    scope: "object",
    server: {
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
      ...server,
    },
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

function foreignTableChange(
  operation: "create" | "alter" | "drop",
  foreignTable: {
    schema: string;
    name: string;
    owner: string;
    server: string;
    wrapper_handler: string | null;
    wrapper_validator: string | null;
  },
): Change {
  return {
    objectType: "foreign_table",
    operation,
    scope: "object",
    foreignTable: {
      options: null,
      comment: null,
      columns: [],
      privileges: [],
      security_labels: [],
      ...foreignTable,
    },
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

function userMappingChange(
  operation: "create" | "alter" | "drop",
  userMapping: {
    user: string;
    server: string;
    wrapper_handler: string | null;
    wrapper_validator: string | null;
  },
): Change {
  return {
    objectType: "user_mapping",
    operation,
    scope: "object",
    userMapping: {
      options: null,
      ...userMapping,
    },
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

function serverPrivilegeChange(server: {
  name: string;
  owner: string;
}): Change {
  return {
    objectType: "server",
    operation: "alter",
    scope: "privilege",
    server,
    grantee: "postgres",
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

/**
 * Build a synthetic trigger change shaped like what `flattenChange` consumes.
 * The flattener emits keys `trigger/schema`, `trigger/table_name`,
 * `trigger/function_schema`, etc. by walking the nested `trigger` model.
 */
function triggerChange(
  operation: "create" | "alter" | "drop",
  trigger: {
    schema: string;
    name: string;
    table_name: string;
    function_schema: string;
    function_name: string;
    owner: string;
  },
): Change {
  return {
    objectType: "trigger",
    operation,
    scope: "object",
    trigger,
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

describe("supabase integration filter — foreign data wrappers", () => {
  // Regression for CLI-1470. Wasm-based foreign data wrappers on Supabase
  // (e.g. `clerk`, `clerk_oauth`) are provisioned at project creation by
  // `supabase_admin` and their handler/validator live in `extensions.*`.
  // pg-delta must not emit `CREATE/DROP/ALTER FOREIGN DATA WRAPPER` for
  // them, even when the FDW owner has been rewritten away from
  // `supabase_admin` (e.g. after a dump/restore).
  test("suppresses CREATE for FDW with handler in extensions schema", () => {
    const change = fdwChange("create", {
      name: "clerk",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses DROP for FDW with handler in extensions schema", () => {
    const change = fdwChange("drop", {
      name: "clerk_oauth",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses ALTER for FDW with handler in extensions schema", () => {
    const change = fdwChange("alter", {
      name: "clerk",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses FDW when only the validator lives in extensions", () => {
    const change = fdwChange("create", {
      name: "partial_wasm",
      owner: "postgres",
      handler: null,
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("preserves user FDW whose handler lives outside extensions", () => {
    const change = fdwChange("create", {
      name: "user_fdw",
      owner: "postgres",
      handler: "public.my_fdw_handler",
      validator: "public.my_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });

  test("preserves user FDW with no handler/validator", () => {
    const change = fdwChange("create", {
      name: "user_fdw_bare",
      owner: "postgres",
      handler: null,
      validator: null,
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });
});

describe("supabase integration filter — foreign data wrapper / server ACLs", () => {
  // Regression for CLI-1469. `GRANT`/`REVOKE ... ON FOREIGN DATA WRAPPER`
  // require superuser. On Supabase Cloud `postgres` has the elevated
  // rights to make them work; the local Docker image does not, so
  // `supabase db reset` aborts with `permission denied for foreign-data
  // wrapper`. FDW ACL is platform-managed, not user-declarative state —
  // suppress regardless of owner because `pg_dump` rewrites OWNER TO
  // away from `supabase_admin`.
  test("suppresses FDW ACL when owner=supabase_admin (existing */owner rule)", () => {
    const change = fdwPrivilegeChange({
      name: "dblink_fdw",
      owner: "supabase_admin",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses FDW ACL when owner=postgres (post-restore)", () => {
    const change = fdwPrivilegeChange({
      name: "dblink_fdw",
      owner: "postgres",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  // FOREIGN SERVER ACL is owner-scoped, not blanket-suppressed:
  // server GRANT/REVOKE does not require superuser, so a user-owned
  // server's ACL must roundtrip. The pre-existing `*/owner` rule
  // already drops platform-managed servers (owner ∈ system roles).
  test("suppresses server ACL when owner=supabase_admin (existing */owner rule)", () => {
    const change = serverPrivilegeChange({
      name: "platform_server",
      owner: "supabase_admin",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("preserves server ACL when owner=postgres", () => {
    const change = serverPrivilegeChange({
      name: "user_dblink_server",
      owner: "postgres",
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });

  // Non-privilege FDW changes whose handler/validator aren't in
  // `extensions.*` should still pass through (a user FDW is plain DDL,
  // not the platform-managed flavor).
  test("preserves non-privilege FDW changes for user wrappers", () => {
    const change = fdwChange("create", {
      name: "user_fdw",
      owner: "postgres",
      handler: "public.my_fdw_handler",
      validator: null,
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });
});

describe("supabase integration filter — Wasm FDW dependents", () => {
  const wasmWrapper = {
    wrapper_handler: "extensions.wasm_fdw_handler",
    wrapper_validator: "extensions.wasm_fdw_validator",
  } as const;

  const userWrapper = {
    wrapper_handler: "public.postgres_fdw_handler",
    wrapper_validator: "public.postgres_fdw_validator",
  } as const;

  test("suppresses CREATE SERVER bound to extensions.* Wasm FDW", () => {
    const change = serverChange("create", {
      name: "clerk_oauth_server",
      owner: "postgres",
      foreign_data_wrapper: "clerk_oauth",
      ...wasmWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses DROP FOREIGN TABLE bound to extensions.* Wasm FDW", () => {
    const change = foreignTableChange("drop", {
      schema: "public",
      name: "clerk_oauth",
      owner: "postgres",
      server: "clerk_oauth_server",
      ...wasmWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses ALTER FOREIGN TABLE bound to extensions.* Wasm FDW", () => {
    const change = foreignTableChange("alter", {
      schema: "public",
      name: "clerk_oauth",
      owner: "postgres",
      server: "clerk_oauth_server",
      ...wasmWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses DROP USER MAPPING bound to extensions.* Wasm FDW", () => {
    const change = userMappingChange("drop", {
      user: "postgres",
      server: "clerk_server",
      ...wasmWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses CREATE USER MAPPING when only wrapper validator is in extensions", () => {
    const change = userMappingChange("create", {
      user: "postgres",
      server: "clerk_server",
      wrapper_handler: null,
      wrapper_validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("preserves CREATE SERVER bound to user postgres_fdw wrapper", () => {
    const change = serverChange("create", {
      name: "live_risk_server",
      owner: "postgres",
      foreign_data_wrapper: "postgres_fdw",
      ...userWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });

  test("preserves server ACL when postgres_fdw handler lives in extensions", () => {
    const change = serverPrivilegeChange({
      name: "user_server",
      owner: "postgres",
    });
    (change as unknown as { server: Record<string, unknown> }).server = {
      name: "user_server",
      owner: "postgres",
      wrapper_handler: "extensions.postgres_fdw_handler",
      wrapper_validator: "extensions.postgres_fdw_validator",
    };
    expect(evaluatePattern(filter, change)).toBe(true);
  });

  test("preserves CREATE FOREIGN TABLE on user postgres_fdw server", () => {
    const change = foreignTableChange("create", {
      schema: "live_risk",
      name: "devices",
      owner: "postgres",
      server: "live_risk_server",
      ...userWrapper,
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });
});

describe("supabase integration filter — pgmq queue triggers", () => {
  // Regression for the pgmq-1.4.4 cloud projects. `pgmq.create('<name>')`
  // materializes `pgmq.q_<name>` and `pgmq.a_<name>` at runtime — they are
  // NOT created by `CREATE EXTENSION pgmq`. On a healthy install the trigger
  // extractor's `extension_table_oids` join already drops these via the
  // `pg_depend deptype='e'` row that newer pgmq versions record, but on
  // pgmq 1.4.4 that row is never recorded, so user triggers on the queue
  // tables leak into the diff and break `supabase db reset` with
  // `relation "pgmq.q_<name>" does not exist`. The filter must drop them
  // at the supabase-integration level too, regardless of pg_depend state.

  test("suppresses CREATE trigger on pgmq.q_<name> calling a public function", () => {
    const change = triggerChange("create", {
      schema: "pgmq",
      name: "after_insert_processed_milestones_queue",
      table_name: "q_processed_milestones_queue",
      function_schema: "public",
      function_name: "move_data_from_queue",
      owner: "postgres",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses DROP trigger on pgmq.a_<name> calling a public function", () => {
    const change = triggerChange("drop", {
      schema: "pgmq",
      name: "after_insert_archive",
      table_name: "a_processed_milestones_queue",
      function_schema: "public",
      function_name: "archive_handler",
      owner: "postgres",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("preserves CREATE trigger on auth.users calling a public function", () => {
    const change = triggerChange("create", {
      schema: "auth",
      name: "on_auth_user_created",
      table_name: "users",
      function_schema: "public",
      function_name: "handle_new_user",
      owner: "supabase_auth_admin",
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });
});
