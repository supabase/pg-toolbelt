/**
 * prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file>
 *
 * Run the proof loop against a sacrificial clone of the source.
 * WARNING: the clone is mutated and will no longer reflect the source.
 */
import { readFileSync } from "node:fs";
import { parsePlan } from "../../plan/artifact.ts";
import { provePlan } from "../../proof/prove.ts";
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { encodeId } from "../../core/stable-id.ts";
import { makePool } from "../pool.ts";

export async function cmdProve(args: string[]): Promise<void> {
  let planPath: string | undefined;
  let cloneUrl: string | undefined;
  let snapshotPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plan" && args[i + 1]) {
      planPath = args[++i];
    } else if (args[i] === "--clone" && args[i + 1]) {
      cloneUrl = args[++i];
    } else if (args[i] === "--desired-snapshot" && args[i + 1]) {
      snapshotPath = args[++i];
    }
  }

  if (!planPath || !cloneUrl || !snapshotPath) {
    process.stderr.write(
      "Usage: pg-delta-next prove --plan <plan.json> --clone <pg-url> --desired-snapshot <file>\n",
    );
    process.exit(2);
  }

  process.stderr.write(
    "WARNING: The --clone database will be mutated and can no longer be used as a source.\n",
  );

  const json = readFileSync(planPath, "utf8");
  const thePlan = parsePlan(json);
  const { factBase: desiredFb } = loadSnapshot(snapshotPath);

  const clone = makePool(cloneUrl);
  try {
    process.stderr.write(
      `Proving plan (${thePlan.actions.length} action(s))...\n`,
    );
    const verdict = await provePlan(thePlan, clone.pool, desiredFb);

    if (verdict.ok) {
      process.stderr.write(
        "Proof passed: state and data preservation verified.\n",
      );
    } else {
      process.stderr.write("Proof FAILED.\n");
      if (verdict.applyError) {
        process.stderr.write(
          `  apply error at action[${verdict.applyError.actionIndex}]: ${verdict.applyError.message}\n`,
        );
      }
      if (verdict.driftDeltas.length > 0) {
        process.stderr.write(
          `  drift deltas (${verdict.driftDeltas.length}):\n`,
        );
        for (const d of verdict.driftDeltas) {
          const id =
            d.verb === "add" || d.verb === "remove"
              ? encodeId(d.fact.id)
              : d.verb === "set"
                ? encodeId(d.id)
                : encodeId(d.edge.from);
          process.stderr.write(`    ${d.verb} ${id}\n`);
        }
      }
      if (verdict.dataViolations.length > 0) {
        process.stderr.write(
          `  data violations (${verdict.dataViolations.length}):\n`,
        );
        for (const v of verdict.dataViolations) {
          process.stderr.write(
            `    ${v.table}: before=${v.before} after=${v.after}\n`,
          );
        }
      }
      process.exit(1);
    }
  } finally {
    await clone.end();
  }
}
