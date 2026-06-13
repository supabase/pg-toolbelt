/**
 * Minimal typed flag parser shared by all CLI command handlers.
 *
 * Usage:
 *   const { flags, positionals } = parseFlags(args, {
 *     source:  { type: "value", required: true },
 *     desired: { type: "value", required: true },
 *     compact: { type: "boolean" },
 *     out:     { type: "value" },
 *   });
 *
 * - "value" flags consume the next argv token as their value.
 * - "boolean" flags are true when present, absent = undefined.
 * - "multi" flags are repeatable; each occurrence appends one value; result is string[].
 * - required: true on a "value" flag makes parseFlags throw a UsageError when absent.
 * - Unknown flags throw a UsageError (exit code 2 semantics).
 * - Positional args (non-flag tokens) are collected into `positionals`.
 */

export class UsageError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type FlagSpec =
  | { type: "value"; required?: boolean }
  | { type: "boolean" }
  | { type: "multi" };

export type FlagsDef = Record<string, FlagSpec>;

/** Infer the result type from a FlagsDef. */
export type ParsedFlags<T extends FlagsDef> = {
  [K in keyof T]: T[K] extends { type: "boolean" }
    ? boolean
    : T[K] extends { type: "multi" }
      ? string[]
      : T[K] extends { type: "value"; required: true }
        ? string
        : string | undefined;
};

export interface ParseResult<T extends FlagsDef> {
  flags: ParsedFlags<T>;
  positionals: string[];
}

export function parseFlags<T extends FlagsDef>(
  args: string[],
  spec: T,
): ParseResult<T> {
  // initialise result with defaults
  const result: Record<string, boolean | string | string[] | undefined> = {};
  for (const [name, def] of Object.entries(spec)) {
    if (def.type === "boolean") {
      result[name] = false;
    } else if (def.type === "multi") {
      result[name] = [];
    } else {
      result[name] = undefined;
    }
  }

  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string; // i < args.length guarantees defined
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const flagName = arg.slice(2); // strip "--"
    const def = spec[flagName];

    if (def === undefined) {
      throw new UsageError(`Unknown flag: --${flagName}`);
    }

    if (def.type === "boolean") {
      result[flagName] = true;
    } else if (def.type === "value") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Flag --${flagName} requires a value`);
      }
      result[flagName] = next;
      i++;
    } else {
      // multi
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Flag --${flagName} requires a value`);
      }
      (result[flagName] as string[]).push(next);
      i++;
    }
  }

  // check required value flags
  for (const [name, def] of Object.entries(spec)) {
    if (def.type === "value" && def.required && result[name] === undefined) {
      throw new UsageError(`Missing required flag: --${name}`);
    }
  }

  return { flags: result as ParsedFlags<T>, positionals };
}
