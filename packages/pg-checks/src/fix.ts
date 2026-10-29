/**
 * RFC §8 fixes. Splinter's `remediation` is only a docs URL for every checked
 * rule (O13), so the fixes are written here, after splinter's docs. They point
 * the reader at the change; they are not meant to be applied as-is.
 */
import type { Rule } from "./policy.ts";

/**
 * `statement`: complete SQL, still to be read before use. `template`: SQL with
 * `<placeholders>` to fill in. `guidance`: no SQL.
 */
export type FixKind = "statement" | "template" | "guidance";

export interface Fix {
  readonly kind: FixKind;
  readonly label: string;
  /** `null` when {@link kind} is `guidance`. */
  readonly sql: string | null;
  /** What the fix changes, or what to do, naming the object. */
  readonly why: string;
}

const ident = (name: string) =>
  /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;

const statement = (label: string, sql: string, why: string): Fix => ({
  kind: "statement",
  label,
  sql,
  why,
});
const template = (label: string, sql: string, why: string): Fix => ({
  kind: "template",
  label,
  sql,
  why,
});
const guidance = (label: string, why: string): Fix => ({
  kind: "guidance",
  label,
  sql: null,
  why,
});

/** Fixes for one finding, one per intent; the first is the usual one. */
export function fixesFor(
  rule: Rule,
  metadata: Readonly<Record<string, unknown>>,
): Fix[] {
  const part = (key: string, fallback: string) =>
    typeof metadata[key] === "string" ? ident(metadata[key]) : fallback;
  const object = `${part("schema", "<schema>")}.${part("name", "<name>")}`;
  const enableRls = `alter table ${object} enable row level security;`;
  // service_role bypasses RLS; a deny-all policy states that intent and keeps
  // rls_enabled_no_policy quiet.
  const serviceRoleOnly = `create policy "service_role only" on ${object} for all using (false);`;
  const ownerPolicy = `create policy "owner access" on ${object} for <command> to authenticated using (auth.uid() = <owner_column>);`;
  switch (rule) {
    case "rls_disabled_in_public":
      return [
        statement(
          "Restrict to service_role",
          `${enableRls}\n${serviceRoleOnly}`,
          `Only service_role can read or write ${object}; anon and authenticated get no rows.`,
        ),
        template(
          "Allow access per user",
          `${enableRls}\n${ownerPolicy}`,
          `Enable RLS on ${object} and add a policy for each role and command that needs access.`,
        ),
      ];
    case "rls_enabled_no_policy":
      return [
        statement(
          "State service_role only",
          serviceRoleOnly,
          `${object} has RLS and no policy, so only service_role can use it. If that is intended, say so with a deny-all policy.`,
        ),
        template(
          "Allow access per user",
          ownerPolicy,
          `Add a policy on ${object} for each role and command that needs access.`,
        ),
      ];
    case "policy_exists_rls_disabled":
      return [
        statement(
          "Enable RLS",
          enableRls,
          `The policies on ${object} have no effect until RLS is on. Check that they allow what the API needs before enabling it.`,
        ),
      ];
    case "security_definer_view":
      return [
        statement(
          "Use the caller's permissions",
          `alter view ${object} set (security_invoker = on);`,
          `${object} then reads its tables with the caller's permissions and RLS, so callers without access to those tables lose rows.`,
        ),
      ];
    case "rls_policy_always_true": {
      const policy =
        typeof metadata["policy_name"] === "string"
          ? `"${metadata["policy_name"].replaceAll('"', '""')}"`
          : "<policy>";
      return [
        template(
          "Narrow the policy",
          `alter policy ${policy} on ${object} using (<condition>) with check (<condition>);`,
          `Policy ${policy} on ${object} allows every row; replace true with the condition that should apply.`,
        ),
      ];
    }
    case "sensitive_columns_exposed":
      return [
        template(
          "Enable RLS with policies",
          `${enableRls}\n${ownerPolicy}`,
          `${object} has sensitive columns and no RLS; enable it and add policies for the roles that need access.`,
        ),
        guidance(
          "Move the sensitive columns",
          `Move the sensitive columns of ${object} to a table in a schema the API does not expose.`,
        ),
      ];
    case "auth_users_exposed":
      return [
        statement(
          "Revoke API access",
          `revoke select on ${object} from anon, authenticated;`,
          `${object} exposes auth.users to the API; the API roles can no longer read it.`,
        ),
        guidance(
          "Use a profiles table",
          `Drop ${object} and copy the columns you need into a table with RLS, e.g. public.profiles filled by a trigger on auth.users.`,
        ),
      ];
    case "function_search_path_mutable":
      return [
        guidance(
          "Pin the search_path",
          `Function ${object} resolves names through the caller's search_path. Set search_path = '' on it (every overload) and schema-qualify every object its body references.`,
        ),
      ];
    case "rls_references_user_metadata":
      return [
        guidance(
          "Stop trusting user_metadata",
          `A policy on ${object} reads user_metadata, which users can edit. Base it on app_metadata or on a table you control.`,
        ),
      ];
  }
}
