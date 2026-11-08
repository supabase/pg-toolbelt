/**
 * spark export --url <spark-api-url> --key <service-role-key> --out <dir> [--prune-unmanaged]
 * spark plan   --url <spark-api-url> --key <service-role-key> --schema <dir> [--out-plan <file.sql>]
 *
 * Declarative workflow against a Spark project, with no Postgres involved: both
 * sides come from Spark's schema description (src/integrations/spark/), and the
 * plan is proven by replaying it on a Spark scratch copy of the project.
 */
import { writeFileSync } from "node:fs";
import {
  exportSparkSchema,
  fetchSparkSchema,
  planSparkSchema,
} from "../../integrations/spark/frontend.ts";
import { printDiagnostics } from "../diagnostics.ts";
import { CliExit, parseFlags, UsageError } from "../flags.ts";
import { collectSqlFiles, writeExportFiles } from "./schema.ts";

const USAGE =
  "Usage:\n" +
  "  pgdelta spark export --url <spark-api-url> --key <service-role-key> --out <dir> [--prune-unmanaged]\n" +
  "  pgdelta spark plan   --url <spark-api-url> --key <service-role-key> --schema <dir> [--out-plan <file.sql>]\n";

function parse<T extends Parameters<typeof parseFlags>[1]>(
  args: string[],
  def: T,
) {
  try {
    return parseFlags(args, def).flags;
  } catch (err) {
    if (err instanceof UsageError) {
      throw new UsageError(`${err.message}\n${USAGE}`);
    }
    throw err;
  }
}

async function cmdSparkExport(args: string[]): Promise<void> {
  const flags = parse(args, {
    url: { type: "value", required: true },
    key: { type: "value", required: true },
    out: { type: "value", required: true },
    "prune-unmanaged": { type: "boolean" },
  } as const);
  const description = await fetchSparkSchema({
    url: flags.url,
    key: flags.key,
  });
  const files = exportSparkSchema(description);
  const result = writeExportFiles(
    flags.out,
    files,
    { redactSecrets: true, scope: "database" },
    flags["prune-unmanaged"],
  );
  process.stderr.write(
    `Exported ${files.length} file(s) to ${flags.out} ` +
      `(${result.created.length} created, ${result.updated.length} updated, ` +
      `${result.unchanged.length} unchanged, ${result.removed.length} removed)\n`,
  );
}

async function cmdSparkPlan(args: string[]): Promise<void> {
  const flags = parse(args, {
    url: { type: "value", required: true },
    key: { type: "value", required: true },
    schema: { type: "value", required: true },
    "out-plan": { type: "value" },
  } as const);
  const files = collectSqlFiles(flags.schema);
  const result = await planSparkSchema(
    { url: flags.url, key: flags.key },
    files,
  );
  printDiagnostics(result.diagnostics, { label: "schema files" });
  const rejected = result.diagnostics.some((d) => d.severity === "error");

  if (result.sql === "") {
    process.stdout.write("No schema changes found\n");
  } else {
    if (flags["out-plan"] !== undefined) {
      writeFileSync(flags["out-plan"], result.sql);
      process.stderr.write(`Plan written to ${flags["out-plan"]}\n`);
    } else {
      process.stdout.write(result.sql);
    }
  }
  const proof = result.proof;
  if (proof !== undefined) {
    printDiagnostics(proof.diagnostics, { label: "proof" });
    process.stderr.write(
      proof.ok
        ? `Proof: OK (plan converges to the desired schema, ${proof.expected})\n`
        : `Proof: FAILED (expected ${proof.expected}, replay produced ${proof.actual})\n`,
    );
  }
  if (rejected || (proof !== undefined && !proof.ok)) throw new CliExit(1);
}

export async function cmdSpark(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  if (sub === "export") return cmdSparkExport(rest);
  if (sub === "plan") return cmdSparkPlan(rest);
  if (sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(USAGE);
    return;
  }
  throw new UsageError(
    `Unknown spark subcommand: ${sub ?? "(none)"}\n${USAGE}`,
  );
}
