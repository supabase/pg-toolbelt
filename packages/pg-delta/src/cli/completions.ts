import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const SUPPORTED_COMPLETION_SHELLS = ["bash", "zsh", "fish", "sh"] as const;

type SupportedCompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];
type GeneratorShell = Exclude<SupportedCompletionShell, "sh">;

interface InternalCommandDescriptor {
  readonly name: string;
}

interface InternalCompletionModules {
  readonly fromCommand: (command: unknown) => InternalCommandDescriptor;
  readonly generate: (
    executableName: string,
    shell: GeneratorShell,
    descriptor: InternalCommandDescriptor,
  ) => string;
}

let internalCompletionModulesPromise:
  | Promise<InternalCompletionModules>
  | undefined;

export function parseCompletionShell(
  argv: readonly string[],
): SupportedCompletionShell | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--completions") {
      const next = argv[i + 1];
      return isSupportedCompletionShell(next) ? next : undefined;
    }
    if (token.startsWith("--completions=")) {
      const shell = token.slice("--completions=".length);
      return isSupportedCompletionShell(shell) ? shell : undefined;
    }
  }
  return undefined;
}

export function isSupportedCompletionShell(
  value: string | undefined,
): value is SupportedCompletionShell {
  return (
    value !== undefined &&
    (SUPPORTED_COMPLETION_SHELLS as readonly string[]).includes(value)
  );
}

export async function generateCompletionScript(
  shell: SupportedCompletionShell,
  command: unknown,
  executableName = "pgdelta",
): Promise<{ script?: string; error?: string }> {
  try {
    const modules = await loadInternalCompletionModules();
    const descriptor = modules.fromCommand(command);
    const generatorShell = shell === "sh" ? "bash" : shell;
    const rawScript = modules.generate(executableName, generatorShell, descriptor);

    return {
      script: sanitizeCompletionScript(rawScript, generatorShell),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate completion script.",
    };
  }
}

export function sanitizeCompletionScript(
  script: string,
  shell: GeneratorShell,
): string {
  switch (shell) {
    case "bash":
      return sanitizeBashCompletionScript(script);
    case "zsh":
      return sanitizeZshCompletionScript(script);
    case "fish":
      return sanitizeFishCompletionScript(script);
  }
}

async function loadInternalCompletionModules(): Promise<InternalCompletionModules> {
  if (!internalCompletionModulesPromise) {
    internalCompletionModulesPromise = (async () => {
      const commandModulePath = require.resolve("effect/unstable/cli/Command");
      const completionsDir = join(dirname(commandModulePath), "internal", "completions");

      const [{ fromCommand }, { generate }] = await Promise.all([
        import(
          pathToFileURL(join(completionsDir, "CommandDescriptor.js")).href
        ) as Promise<Pick<InternalCompletionModules, "fromCommand">>,
        import(
          pathToFileURL(join(completionsDir, "Completions.js")).href
        ) as Promise<Pick<InternalCompletionModules, "generate">>,
      ]);

      return { fromCommand, generate };
    })();
  }

  return internalCompletionModulesPromise;
}

function sanitizeBashCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes("_flag_groups[--no-")) {
        return [];
      }

      const sanitizedLine = line
        .replace(/\s--no-[a-z-]+(?=[\s;)]|$)/g, "")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")");

      return sanitizedLine.trim() === "()" ? [] : [sanitizedLine];
    })
    .join("\n");
}

function sanitizeZshCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes("--no-") && line.includes("Disable ")) {
        return [];
      }

      return [
        line
          .replace(/ --no-[a-z-]+/g, "")
          .replace(/\(\s+/g, "(")
          .replace(/\s+\)/g, ")"),
      ];
    })
    .join("\n");
}

function sanitizeFishCompletionScript(script: string): string {
  return script
    .split("\n")
    .flatMap((line) => {
      if (line.includes(" -l no-") || line.includes(" -a '--no-")) {
        return [];
      }

      return [line.replace(/\sno-[a-z-]+(?=[ '])/g, "")];
    })
    .join("\n");
}
