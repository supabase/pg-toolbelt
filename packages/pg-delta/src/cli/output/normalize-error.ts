import { Cause, Option } from "effect";

type NormalizedCliError = {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
  readonly suggestion?: string;
};

type ErrorRecord = Record<string, unknown>;

const isErrorRecord = (value: unknown): value is ErrorRecord =>
  typeof value === "object" && value !== null;

const readString = (value: ErrorRecord, key: string): string | undefined => {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0
    ? field.trim()
    : undefined;
};

export function normalizeCliError(error: unknown): NormalizedCliError {
  if (isErrorRecord(error)) {
    const code = readString(error, "_tag") ?? "UnknownError";
    const message =
      readString(error, "message") ?? readString(error, "detail") ?? code;
    const detail = readString(error, "detail");
    const suggestion = readString(error, "suggestion");
    return {
      code,
      message,
      ...(detail && detail !== message ? { detail } : {}),
      ...(suggestion ? { suggestion } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name || "Error",
      message: error.message || "Unknown error",
    };
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return {
      code: "UnknownError",
      message: error.trim(),
    };
  }

  return {
    code: "UnknownError",
    message: "Unknown error",
  };
}

export function normalizeCause(
  cause: Cause.Cause<unknown>,
): NormalizedCliError {
  const errorOption = Cause.findErrorOption(cause);
  return normalizeCliError(
    Option.getOrElse(errorOption, () => Cause.squash(cause)),
  );
}

const hasCause = (value: unknown): value is { cause: unknown } =>
  isErrorRecord(value) && "cause" in value;

const isGenericMessage = (message: string): boolean =>
  message === "Unknown error" ||
  message === "UnknownError" ||
  message === "SqlError" ||
  message === "Failed to execute statement" ||
  message === "Connection error" ||
  message === "Failed to acquire connection";

export function extractDeepestCliMessage(error: unknown): string {
  let current = error;
  let best = normalizeCliError(error).message;
  const seen = new Set<unknown>();

  while (hasCause(current) && current.cause !== undefined && !seen.has(current)) {
    seen.add(current);
    const next = current.cause;
    const normalized = normalizeCliError(next);
    if (!isGenericMessage(normalized.message)) {
      best = normalized.message;
    }
    current = next;
  }

  return best;
}
