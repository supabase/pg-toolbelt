import { describe, expect, test } from "vitest";
import { formatSqlStatements } from "../sql-format.ts";

describe("lowercase coverage formatting", () => {
  test("normalizes representative DDL/DCL keywords to lowercase", () => {
    const statements = [
      "CREATE FUNCTION auth.can(_organization_id bigint,_resource text,_action auth.action,_data json DEFAULT NULL::json,_subject_id uuid DEFAULT auth.gotrue_id()) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $function$BEGIN RETURN true; END;$function$;",
      "ALTER SEQUENCE audit.record_version_id_seq OWNED by audit.record_version.id;",
      "REVOKE ALL ON FUNCTION auth.uid() FROM postgres;",
      "ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE auth.audit_log_entries ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);",
      "GRANT SELECT ON auth.default_permissions TO authenticated;",
      "GRANT DELETE, INSERT, SELECT, UPDATE ON auth.permissions TO authenticated;",
      "ALTER TABLE auth.subject_all_roles REPLICA IDENTITY FULL;",
      "CREATE EVENT TRIGGER prevent_drop ON sql_drop WHEN TAG IN ('DROP TABLE', 'DROP SCHEMA') EXECUTE FUNCTION public.prevent_drop_fn();",
      "CREATE TABLE public.credit_codes (id uuid DEFAULT gen_random_uuid() NOT NULL, is_unique boolean GENERATED ALWAYS AS ((max_redemptions = 1)) STORED, created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL, status text DEFAULT 'ACTIVE_HEALTHY');",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 200,
    });
    expect(formatted).toMatchInlineSnapshot(`
      [
        "create function auth.can (
        _organization_id bigint,
        _resource        text,
        _action          auth.action,
        _data            json        default null::json,
        _subject_id      uuid        default auth.gotrue_id()
      )
        returns boolean
        language plpgsql
        stable
        security definer
        AS $function$BEGIN RETURN true; END;$function$",
        "alter sequence audit.record_version_id_seq OWNED by audit.record_version.id",
        "revoke all on function auth.uid() from postgres",
        "alter table auth.audit_log_entries
        enable row level security",
        "alter table auth.audit_log_entries
        add constraint audit_log_entries_pkey primary key (id)",
        "grant select on auth.default_permissions to authenticated",
        "grant delete, insert, select, update on auth.permissions to authenticated",
        "alter table auth.subject_all_roles
        replica identity full",
        "create event trigger prevent_drop
        on sql_drop
        when tag in ('DROP TABLE', 'DROP SCHEMA')
        execute function public.prevent_drop_fn()",
        "create table public.credit_codes (
        id         uuid                     default gen_random_uuid() not null,
        is_unique  boolean                  generated always as ((max_redemptions = 1)) stored,
        created_at timestamp with time zone default current_timestamp not null,
        status     text                     default 'ACTIVE_HEALTHY'
      )",
      ]
    `)

  });
});
