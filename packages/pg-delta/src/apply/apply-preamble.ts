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
    // search_path: pg_catalog FIRST, then the applier's own path. The DDL is
    // fully qualified except for built-ins, which must never resolve to a user
    // schema the role lists before pg_catalog. But expressions the DDL
    // evaluates (an ADD COLUMN default rewrite, an index or CHECK over a user
    // function) run routine bodies whose UNqualified names resolve through the
    // session path — e.g. pgcrypto in Supabase's `extensions` schema — so
    // pinning pg_catalog alone broke them. An empty path renders as `""`.
    ...plan.preamble.map((setting) =>
      setting.name === "search_path"
        ? `SELECT pg_catalog.set_config('search_path', pg_catalog.concat_ws(', ', ${lit(setting.value)}, NULLIF(NULLIF(pg_catalog.current_setting('search_path'), ''), '""')), ${local})`
        : `SET ${scope}${setting.name} = ${setting.value}`,
    ),
  ];
}
