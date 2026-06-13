/**
 * plan --source <pg-url> --desired <pg-url>
 *      [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]
 *
 * Extract both databases, plan, write serializePlan to --out (default stdout).
 * Print a human summary to stderr: action count, safety report, rename
 * candidates (prompt-mode candidates listed as questions with from/to),
 * filtered-delta count.
 */
import { extract } from "../../extract/extract.ts";
import { plan } from "../../plan/plan.ts";
import { serializePlan } from "../../plan/artifact.ts";
import { encodeId } from "../../core/stable-id.ts";
import { makePool } from "../pool.ts";
import type { RenameMode } from "../../plan/renames.ts";
import { writeFileSync } from "node:fs";

export async function cmdPlan(args: string[]): Promise<void> {
  let sourceUrl: string | undefined;
  let desiredUrl: string | undefined;
  let renames: RenameMode = "off";
  let compact = true;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      sourceUrl = args[++i];
    } else if (args[i] === "--desired" && args[i + 1]) {
      desiredUrl = args[++i];
    } else if (args[i] === "--renames" && args[i + 1]) {
      const v = args[++i];
      if (v !== "auto" && v !== "prompt" && v !== "off") {
        process.stderr.write(
          `--renames must be auto, prompt, or off (got: ${v})\n`,
        );
        process.exit(2);
      }
      renames = v;
    } else if (args[i] === "--no-compact") {
      compact = false;
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[++i];
    }
  }

  if (!sourceUrl || !desiredUrl) {
    process.stderr.write(
      "Usage: pg-delta-next plan --source <pg-url> --desired <pg-url> [--renames auto|prompt|off] [--no-compact] [--out <plan.json>]\n",
    );
    process.exit(2);
  }

  const src = makePool(sourceUrl);
  const dst = makePool(desiredUrl);
  try {
    process.stderr.write("Extracting source...\n");
    process.stderr.write("Extracting desired...\n");
    const [sourceResult, desiredResult] = await Promise.all([
      extract(src.pool),
      extract(dst.pool),
    ]);

    const thePlan = plan(sourceResult.factBase, desiredResult.factBase, {
      renames,
      compact,
    });

    // human summary → stderr
    process.stderr.write(`\nPlan summary:\n`);
    process.stderr.write(`  actions:          ${thePlan.actions.length}\n`);
    process.stderr.write(
      `  filtered deltas:  ${thePlan.filteredDeltas.length}\n`,
    );
    process.stderr.write(
      `  destructive:      ${thePlan.safetyReport.destructiveActions}\n`,
    );
    process.stderr.write(
      `  rewrite risk:     ${thePlan.safetyReport.rewriteRiskActions}\n`,
    );
    process.stderr.write(
      `  non-transactional:${thePlan.safetyReport.nonTransactionalActions}\n`,
    );

    if (thePlan.renameCandidates.length > 0) {
      process.stderr.write(`\nRename candidates:\n`);
      for (const c of thePlan.renameCandidates) {
        const fromStr = encodeId(c.from);
        const toStr = encodeId(c.to);
        if (renames === "prompt" && c.status === "unambiguous") {
          process.stderr.write(
            `  ? Rename ${fromStr} -> ${toStr}? (${c.status})\n`,
          );
        } else {
          process.stderr.write(
            `  ${c.status}: ${fromStr} -> ${toStr}${c.reason ? ` (${c.reason})` : ""}\n`,
          );
        }
      }
    }

    const json = serializePlan(thePlan);

    if (outPath) {
      writeFileSync(outPath, json, "utf8");
      process.stderr.write(`\nPlan written to ${outPath}\n`);
    } else {
      process.stdout.write(json + "\n");
    }
  } finally {
    await Promise.all([src.end(), dst.end()]);
  }
}
