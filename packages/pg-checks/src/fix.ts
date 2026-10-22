/**
 * RFC §8 `Fix:` text. Splinter's `remediation` is only a docs URL for every
 * checked rule (O13), so the text is written here, after splinter's docs.
 */
import type { Rule } from "./policy.ts";

const ident = (name: string) =>
  /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;

export function fixText(
  rule: Rule,
  metadata: Readonly<Record<string, unknown>>,
): string {
  const part = (key: string, fallback: string) =>
    typeof metadata[key] === "string" ? ident(metadata[key]) : fallback;
  const object = `${part("schema", "<schema>")}.${part("name", "<name>")}`;
  switch (rule) {
    case "rls_disabled_in_public":
      return `alter table ${object} enable row level security; then add a policy for each role that needs access: create policy ... on ${object} for <command> to <role> using (<condition>);`;
    case "rls_enabled_no_policy":
      return `If only service_role should use this table, state it: create policy "service_role only" on ${object} for all using (false); otherwise add a policy for the roles that need access.`;
    case "policy_exists_rls_disabled":
      return `The policies on ${object} have no effect until RLS is on: alter table ${object} enable row level security;`;
    case "security_definer_view":
      return `alter view ${object} set (security_invoker = on);`;
    case "rls_policy_always_true": {
      const policy =
        typeof metadata["policy_name"] === "string"
          ? `"${metadata["policy_name"].replaceAll('"', '""')}"`
          : "<policy>";
      return `Policy ${policy} on ${object} allows every row: alter policy ${policy} on ${object} using (<condition>) with check (<condition>);`;
    }
    case "sensitive_columns_exposed":
      return `${object} has sensitive columns and no RLS: alter table ${object} enable row level security; and add policies, or move those columns to a table the API cannot read.`;
    case "auth_users_exposed":
      return `View ${object} exposes auth.users to the API: revoke select on ${object} from anon, authenticated; or drop it and copy the columns you need into a table with RLS (e.g. public.profiles filled by a trigger on auth.users).`;
    case "function_search_path_mutable":
      return `alter function ${object} set search_path = ''; then schema-qualify every object its body references.`;
    case "rls_references_user_metadata":
      return `A policy on ${object} reads user_metadata, which users can edit: base it on app_metadata or on a table you control.`;
  }
}
