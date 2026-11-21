import type { Plan } from "../plan/plan.ts";
import {
  buildApplyPreamble,
  type ApplyTimeoutOptions,
} from "../apply/apply-preamble.ts";
import { segmentActions } from "../apply/apply.ts";
import { CapabilityError } from "../policy/capability.ts";
import { lit } from "../plan/render.ts";

function terminate(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

const EXECUTION_CONTRACT = `-- pg-delta schema apply --dry-run
-- Execute statements one at a time, in order, on one database session.
-- Stop on the first error and preserve autocommit outside BEGIN/COMMIT blocks.
-- Do not submit this as one multi-statement request or wrap it in one transaction.`;

/** Render the portable SQL statement sequence that apply() sends on success. */
export function renderApplyScript(
  plan: Plan,
  timeoutOptions?: ApplyTimeoutOptions,
): string {
  if (plan.blockers !== undefined && plan.blockers.length > 0) {
    throw new CapabilityError(plan.blockers);
  }
  if (plan.actions.length === 0) return "";

  const segments = segmentActions(plan.actions);
  const rendered = segments.map((segment) => {
    const statements: string[] = [];
    if (segment.transactional) statements.push("BEGIN;");
    statements.push(
      ...buildApplyPreamble(plan, timeoutOptions, segment.transactional).map(
        terminate,
      ),
    );
    for (let index = segment.start; index < segment.end; index++) {
      statements.push(terminate(plan.actions[index]!.sql));
    }
    statements.push(segment.transactional ? "COMMIT;" : "RESET ALL;");
    return statements.join("\n");
  });

  // apply() checks this itself; a script has to carry the check
  const guard =
    plan.boundApplier === undefined
      ? ""
      : `DO $pgdelta$ BEGIN IF current_user <> ${lit(plan.boundApplier)} THEN RAISE EXCEPTION 'this migration grants roles to % for its own statements and must be run as that role, not as %', ${lit(plan.boundApplier)}, current_user; END IF; END $pgdelta$;\n\n`;
  return `${EXECUTION_CONTRACT}\n\n${guard}${rendered.join("\n\n")}\n`;
}
