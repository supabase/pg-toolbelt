import { describe, expect, test } from "vitest";
import { formatSqlStatements } from "../sql-format.ts";

describe("lowercase coverage formatting", () => {
  test("normalizes keywords while preserving definitions and key=value settings", () => {
    const statements = [
      "ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;",
      "REVOKE GRANT OPTION FOR USAGE ON SEQUENCE public.seq FROM app_user;",
      "ALTER FUNCTION public.fn() PARALLEL RESTRICTED;",
      "CREATE EVENT TRIGGER prevent_drop ON sql_drop WHEN TAG IN ('DROP TABLE') EXECUTE FUNCTION public.prevent_drop_fn();",
      "CREATE COLLATION public.test (LOCALE = 'en_US', DETERMINISTIC = false, VERSION = '1.0');",
      "ALTER TABLE public.t SET (fillfactor=80, autovacuum_enabled=true);",
      "GRANT USAGE ON SCHEMA public TO PUBLIC;",
      "CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 200,
    });

    expect(formatted).toMatchInlineSnapshot(`
      [
        "alter table auth.audit_log_entries
        enable row level security",
        "revoke grant option for usage on sequence public.seq from app_user",
        "alter function public.fn() parallel restricted",
        "create event trigger prevent_drop
        on sql_drop
        when tag in ('DROP TABLE')
        execute function public.prevent_drop_fn()",
        "create collation public.test (
        LOCALE        = 'en_US',
        DETERMINISTIC = false,
        VERSION       = '1.0'
      )",
        "alter table public.t
        set (fillfactor=80, autovacuum_enabled=true)",
        "grant usage on schema public to PUBLIC",
        "create rule test_rule as ON INSERT TO public.test_table DO INSTEAD NOTHING",
      ]
    `);
  });
});
