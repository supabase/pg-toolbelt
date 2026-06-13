/**
 * schema export --source <pg-url> --out-dir <dir> [--layout ordered]
 *   Export the source database as SQL files written to disk.
 *   Maps to old `declarative-export`.
 *
 * schema apply --dir <dir> --shadow <pg-url> --target <pg-url>
 *              [--renames auto|prompt|off] [--force]
 *   Read .sql files recursively (lexicographic), load into shadow, extract
 *   target, plan, apply.  Maps to old `declarative-apply` / `sync`.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { extract } from "../../extract/extract.ts";
import { exportSqlFiles } from "../../frontends/export-sql-files.ts";
import { loadSqlFiles } from "../../frontends/load-sql-files.ts";
import { plan } from "../../plan/plan.ts";
import { apply } from "../../apply/apply.ts";
import { makePool } from "../pool.ts";
import type { RenameMode } from "../../plan/renames.ts";
import type { SqlFile } from "../../frontends/load-sql-files.ts";

/** Recursively collect *.sql files in lexicographic order. */
function collectSqlFiles(dir: string): SqlFile[] {
  const result: SqlFile[] = [];
  const recurse = (current: string): void => {
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        recurse(full);
      } else if (entry.endsWith(".sql")) {
        result.push({
          name: full.slice(dir.length + 1), // relative path from dir
          sql: readFileSync(full, "utf8"),
        });
      }
    }
  };
  recurse(dir);
  return result;
}

export async function cmdSchemaExport(args: string[]): Promise<void> {
  let sourceUrl: string | undefined;
  let outDir: string | undefined;
  let layout: "by-object" | "ordered" = "by-object";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      sourceUrl = args[++i];
    } else if (args[i] === "--out-dir" && args[i + 1]) {
      outDir = args[++i];
    } else if (args[i] === "--layout" && args[i + 1]) {
      const v = args[++i];
      if (v !== "by-object" && v !== "ordered") {
        process.stderr.write(
          `--layout must be by-object or ordered (got: ${v})\n`,
        );
        process.exit(2);
      }
      layout = v;
    }
  }

  if (!sourceUrl || !outDir) {
    process.stderr.write(
      "Usage: pg-delta-next schema export --source <pg-url> --out-dir <dir> [--layout ordered]\n",
    );
    process.exit(2);
  }

  const src = makePool(sourceUrl);
  try {
    process.stderr.write("Extracting...\n");
    const { factBase } = await extract(src.pool);
    const files = exportSqlFiles(factBase, { layout });

    for (const file of files) {
      const full = join(outDir, file.name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.sql, "utf8");
    }
    process.stderr.write(
      `Exported ${files.length} file(s) to ${outDir} (layout: ${layout})\n`,
    );
  } finally {
    await src.end();
  }
}

export async function cmdSchemaApply(args: string[]): Promise<void> {
  let dir: string | undefined;
  let shadowUrl: string | undefined;
  let targetUrl: string | undefined;
  let renames: RenameMode = "off";
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      dir = args[++i];
    } else if (args[i] === "--shadow" && args[i + 1]) {
      shadowUrl = args[++i];
    } else if (args[i] === "--target" && args[i + 1]) {
      targetUrl = args[++i];
    } else if (args[i] === "--renames" && args[i + 1]) {
      const v = args[++i];
      if (v !== "auto" && v !== "prompt" && v !== "off") {
        process.stderr.write(
          `--renames must be auto, prompt, or off (got: ${v})\n`,
        );
        process.exit(2);
      }
      renames = v;
    } else if (args[i] === "--force") {
      force = true;
    }
  }

  if (!dir || !shadowUrl || !targetUrl) {
    process.stderr.write(
      "Usage: pg-delta-next schema apply --dir <dir> --shadow <pg-url> --target <pg-url> [--renames auto|prompt|off] [--force]\n",
    );
    process.exit(2);
  }

  const shadow = makePool(shadowUrl);
  const tgt = makePool(targetUrl);
  try {
    process.stderr.write("Loading SQL files into shadow...\n");
    const files = collectSqlFiles(dir);
    process.stderr.write(`  ${files.length} file(s) found\n`);
    const loadResult = await loadSqlFiles(files, shadow.pool);
    process.stderr.write(
      `  Shadow loaded: ${loadResult.factBase.facts().length} facts (${loadResult.rounds} round(s))\n`,
    );

    process.stderr.write("Extracting target...\n");
    const targetResult = await extract(tgt.pool);
    process.stderr.write(
      `  Target: ${targetResult.factBase.facts().length} facts\n`,
    );

    const thePlan = plan(targetResult.factBase, loadResult.factBase, {
      renames,
    });
    process.stderr.write(`Planning: ${thePlan.actions.length} action(s)\n`);

    if (thePlan.actions.length === 0) {
      process.stderr.write("Target is already up to date.\n");
      return;
    }

    if (force) {
      process.stderr.write("WARNING: --force disables the fingerprint gate.\n");
    }

    const report = await apply(thePlan, tgt.pool, {
      fingerprintGate: !force,
    });

    if (report.status === "applied") {
      process.stderr.write(
        `Applied ${report.appliedActions} action(s) successfully.\n`,
      );
    } else {
      process.stderr.write("Apply failed!\n");
      if (report.error) {
        process.stderr.write(
          `  action[${report.error.actionIndex}]: ${report.error.message}\n`,
        );
        process.stderr.write(`  sql: ${report.error.sql}\n`);
      }
      process.exit(1);
    }
  } finally {
    await Promise.all([shadow.end(), tgt.end()]);
  }
}
