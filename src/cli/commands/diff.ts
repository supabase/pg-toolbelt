import { writeFile } from "node:fs/promises";
import { buildCommand, type CommandContext } from "@stricli/core";
import { base } from "../../core/integrations/base.ts";
import type { Integration } from "../../core/integrations/integration.types.ts";
import { supabase } from "../../core/integrations/integrations/supabase.ts";
import { main } from "../../core/main.ts";

const integrations: Record<string, Integration> = {
  base,
  supabase,
};

export const diffCommand = buildCommand({
  parameters: {
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Source database connection URL",
          parse: String,
        },
        {
          brief: "Target database connection URL",
          parse: String,
        },
      ],
    },
    flags: {
      output: {
        kind: "parsed",
        brief: "Write output to file instead of stdout",
        parse: (input: string) => input,
        optional: true,
      },
      integration: {
        kind: "enum",
        brief: "Integration to use for filtering and serialization",
        values: ["base", "supabase"] as const,
        default: "base",
        optional: true,
      },
    },
    aliases: {
      o: "output",
    },
  },
  docs: {
    brief: "Generate migration script by diffing two databases",
    fullDescription:
      "Compares the source database (main) with the target database (branch) " +
      "and generates a migration script containing all differences.",
  },
  async func(
    this: CommandContext,
    flags: { output?: string; integration?: "base" | "supabase" },
    sourceUrl: string,
    targetUrl: string,
  ) {
    const integration = integrations[flags.integration ?? "base"] ?? base;

    const result = await main(sourceUrl, targetUrl, integration);

    if (result === null) {
      this.process.stdout.write("No differences found.\n");
      return;
    }

    if (flags.output) {
      await writeFile(flags.output, result.migrationScript, "utf-8");
      this.process.stdout.write(
        `Migration script written to ${flags.output}\n`,
      );
    } else {
      this.process.stdout.write(result.migrationScript);
    }
  },
});
