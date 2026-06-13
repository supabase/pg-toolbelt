/**
 * apply --plan <plan.json> --target <pg-url> [--force]
 *
 * Parse the plan artifact and apply it to the target database.
 * --force disables the fingerprint gate.
 * On failure, print the per-action failure report.
 */
import { readFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { apply } from "../../apply/apply.ts";
import { makePool } from "../pool.ts";

export async function cmdApply(args: string[]): Promise<void> {
  let planPath: string | undefined;
  let targetUrl: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      planPath = args[++i];
    } else if (args[i] === "--target" && args[i + 1]) {
      targetUrl = args[++i];
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  if (!planPath || !targetUrl) {
    process.stderr.write(
      "Usage: pg-delta-next apply --plan <plan.json> --target <pg-url> [--force]\n",
    );
    process.exit(2);
  }

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);

  const tgt = makePool(targetUrl);
  try {
    if (force) {
      process.stderr.write(
        "WARNING: --force disables the fingerprint gate. Applying without state verification.\n",
      );
    }
    process.stderr.write(`Applying ${thePlan.actions.length} action(s)...\n`);

    const report = await apply(thePlan, tgt.pool, {
      fingerprintGate: !force,
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write(`Apply failed!\n`);
      if (report.error) {
        process.stderr.write(
          `  action[${report.error.actionIndex}]: ${report.error.message}\n`,
        );
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      const applied = report.actionStatuses.filter(
        (s) => s === "applied",
      ).length;
      const unapplied = report.actionStatuses.filter(
        (s) => s === "unapplied",
      ).length;
      const inDoubt = report.actionStatuses.filter(
        (s) => s === "inDoubt",
      ).length;
      process.stderr.write(
        `  applied: ${applied}  unapplied: ${unapplied}  inDoubt: ${inDoubt}\n`,
      );
      process.exit(1);
    }
  } finally {
    await tgt.end();
  }
}
