import type { Plan } from "../plan/plan.ts";
import {
  buildApplyPreamble,
  type ApplyTimeoutOptions,
} from "../apply/apply-preamble.ts";
import { runAsBracket, segmentActions } from "../apply/apply.ts";
import { CapabilityError } from "../policy/capability.ts";

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
      const action = plan.actions[index]!;
      const bracket = runAsBracket(action, plan.boundApplier);
      if (bracket !== undefined) statements.push(terminate(bracket.set));
      statements.push(terminate(action.sql));
      if (bracket !== undefined) statements.push(terminate(bracket.restore));
    }
    statements.push(segment.transactional ? "COMMIT;" : "RESET ALL;");
    return statements.join("\n");
  });

  return `${EXECUTION_CONTRACT}\n\n${rendered.join("\n\n")}\n`;
}
