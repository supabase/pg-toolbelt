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
      "CREATE POLICY restrict_delete ON public.credit_codes AS RESTRICTIVE FOR DELETE TO authenticated USING (true);",
      "CREATE AGGREGATE public.array_cat_agg(anycompatiblearray) (SFUNC = array_cat, STYPE = anycompatiblearray, PARALLEL SAFE);",
      "GRANT USAGE ON SCHEMA public TO PUBLIC;",
      "REVOKE USAGE ON SCHEMA public FROM PUBLIC;",
    ];

    const formatted = formatSqlStatements(statements, {
      keywordCase: "lower",
      maxWidth: 200,
    });

    expect(formatted[0]).toContain("returns boolean");
    expect(formatted[0]).toContain("language plpgsql");
    expect(formatted[0]).toContain("stable");
    expect(formatted[0]).toContain("security definer");
    expect(formatted[0]).toContain("\n  as $function$");

    expect(formatted[1]).toContain("owned by");
    expect(formatted[2]).toContain("from postgres");
    expect(formatted[3]).toContain("enable row level security");
    expect(formatted[4]).toContain("primary key");
    expect(formatted[5]).toContain("grant select on");
    expect(formatted[6]).toContain("grant delete,");
    expect(formatted[6]).toContain("insert,");
    expect(formatted[6]).toContain("select,");
    expect(formatted[6]).toContain("update on");
    expect(formatted[7]).toContain("replica identity full");
    expect(formatted[8]).toContain("when tag in");
    expect(formatted[9]).toContain("generated always as");
    expect(formatted[9]).toContain("default current_timestamp");
    expect(formatted[10]).toContain("as restrictive");
    expect(formatted[11]).toContain("parallel safe");
    expect(formatted[12]).toContain("on schema public");
    expect(formatted[12]).toContain("to public");
    expect(formatted[12]).not.toContain("schema PUBLIC");
    expect(formatted[13]).toContain("on schema public");
    expect(formatted[13]).toContain("from public");
    expect(formatted[13]).not.toContain("schema PUBLIC");

    // Quoted text must remain unchanged.
    expect(formatted[9]).toContain("'ACTIVE_HEALTHY'");
  });
});
