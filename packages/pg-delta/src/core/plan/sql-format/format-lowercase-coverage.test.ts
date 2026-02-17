import { describe, expect, test } from "bun:test";
import { formatSqlStatements } from "../sql-format.ts";

describe("lowercase coverage formatting", () => {
  test("normalizes contextual keywords while preserving protected payloads", () => {
    const statements = [
      "CREATE EVENT TRIGGER prevent_drop ON sql_drop WHEN TAG IN ('DROP TABLE', 'DROP SCHEMA') EXECUTE FUNCTION public.prevent_drop_fn();",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid$function$;",
      "COMMENT ON FUNCTION public.fn() IS E'line 1 \\' still quoted\\nline 2';",
      "CREATE COLLATION public.test (LOCALE = 'en_US', DETERMINISTIC = false, provider = icu);",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 140,
    });

    const normalized = [formatted[0], formatted[1], formatted[3]].map((value) =>
      value.replace(/\s+/g, " ").trim(),
    );
    expect(normalized).toMatchInlineSnapshot(`
      [
        "create event trigger prevent_drop on sql_drop when tag in ('DROP TABLE', 'DROP SCHEMA') execute function public.prevent_drop_fn()",
        "create function auth.uid() returns uuid language sql stable AS $function$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid$function$",
        "create collation public.test ( LOCALE = 'en_US', DETERMINISTIC = false, provider = icu )",
      ]
    `);

    expect(formatted[2]).toMatchInlineSnapshot(
      `"comment on function public.fn() is E'line 1 \\' still quoted\\nline 2'"`,
    );
  });

  test("fails safe: malformed protected literals skip casing and wrapping for that statement", () => {
    const statements = [
      "COMMENT ON FUNCTION public.fn() IS E'unterminated \\'",
      "ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 40,
    });

    expect(formatted[0]).toMatchInlineSnapshot(
      `"COMMENT ON FUNCTION public.fn() IS E'unterminated \\'"`,
    );

    expect(formatted[1].replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"alter table auth.audit_log_entries enable row level security"`,
    );
  });

  test("preserves full CHECK clause text while casing surrounding structure", () => {
    const [formatted] = formatSqlStatements(
      [
        "ALTER TABLE public.t ADD CONSTRAINT c CHECK (State IN ('ON','OFF')) NO INHERIT;",
      ],
      { keywordCase: "lower" },
    );

    expect(formatted.replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"alter table public.t add constraint c CHECK (State IN ('ON','OFF')) NO INHERIT"`,
    );
  });
});
