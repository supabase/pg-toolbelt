import type { Plan } from "../plan/plan.ts";
import { lit } from "../plan/render.ts";

export interface ApplyTimeoutOptions {
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
}

/** Build the session settings sent before each apply segment. */
export function buildApplyPreamble(
  plan: Pick<Plan, "preamble">,
  options: ApplyTimeoutOptions | undefined,
  local: boolean,
): string[] {
  const scope = local ? "LOCAL " : "";
  return [
    ...(options?.lockTimeoutMs !== undefined
      ? [`SET ${scope}lock_timeout = ${options.lockTimeoutMs}`]
      : []),
    ...(options?.statementTimeoutMs !== undefined
      ? [`SET ${scope}statement_timeout = ${options.statementTimeoutMs}`]
      : []),
    // search_path: pg_catalog first, so built-ins never resolve to a user
    // schema; then the applier's own path, which routine bodies the DDL
    // evaluates (e.g. an ADD COLUMN default) need for unqualified names such as
    // pgcrypto in Supabase's `extensions`. array_remove compares with the
    // type's own equality, not an operator looked up on the old path. An
    // empty path reads back as `""`.
    ...plan.preamble.map((setting) =>
      setting.name === "search_path"
        ? `SELECT pg_catalog.set_config('search_path', pg_catalog.array_to_string(pg_catalog.array_remove(pg_catalog.array_remove(ARRAY[${lit(setting.value)}, pg_catalog.current_setting('search_path')], ''), '""'), ', '), ${local})`
        : `SET ${scope}${setting.name} = ${setting.value}`,
    ),
  ];
}
