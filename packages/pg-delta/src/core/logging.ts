import { Effect, Layer, ManagedRuntime } from "effect";

const ROOT_CATEGORY = "pg-delta";

const VALID_LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const;

const DEFAULT_LEVEL = "warning";

const LEVEL_ORDER: Record<PgDeltaLogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
  fatal: 5,
};

const loggerCache = new Map<string, PgDeltaLogger>();

type PgDeltaLogLevel = (typeof VALID_LOG_LEVELS)[number];

interface PgDeltaLogEvent {
  level: PgDeltaLogLevel;
  category: readonly string[];
  rawMessage: string;
  properties: Record<string, unknown>;
}

interface PgDeltaLogger {
  debug(message: string, properties?: Record<string, unknown>): void;
  info(message: string, properties?: Record<string, unknown>): void;
  warn(message: string, properties?: Record<string, unknown>): void;
  error(message: string, properties?: Record<string, unknown>): void;
  trace(message: string, properties?: Record<string, unknown>): void;
  fatal(message: string, properties?: Record<string, unknown>): void;
  isEnabledFor(level: string): boolean;
}

interface PgDeltaLoggingState {
  rootLevel: PgDeltaLogLevel;
  debugCategories: string[][];
  captureLogger?: (event: PgDeltaLogEvent) => void;
}

const loggingRuntime = ManagedRuntime.make(Layer.empty);
let loggingState: PgDeltaLoggingState = {
  rootLevel: DEFAULT_LEVEL,
  debugCategories: [],
};

function normalizeDebugToken(token: string): string[] | null {
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith("-")) return null;
  if (trimmed === "*") return [ROOT_CATEGORY];

  if (
    trimmed !== ROOT_CATEGORY &&
    !trimmed.startsWith(`${ROOT_CATEGORY}:`) &&
    !trimmed.startsWith(`${ROOT_CATEGORY}*`)
  ) {
    return null;
  }

  // Convert debug-style wildcards (`pg-delta:*`, `pg-delta:foo:*`) into
  // category prefixes that logtape can match hierarchically.
  const wildcardIndex = trimmed.indexOf("*");
  const wildcardTrimmed =
    wildcardIndex >= 0 ? trimmed.slice(0, wildcardIndex) : trimmed;
  const normalized = wildcardTrimmed.endsWith(":")
    ? wildcardTrimmed.slice(0, -1)
    : wildcardTrimmed;
  const parts = normalized.split(":").filter(Boolean);
  if (parts[0] !== ROOT_CATEGORY) return null;
  return parts;
}

export function parseDebugCategories(debug: string | undefined): string[][] {
  if (!debug) return [];
  const seen = new Set<string>();
  const categories: string[][] = [];
  for (const rawToken of debug.split(/[,\s]+/)) {
    const category = normalizeDebugToken(rawToken);
    if (!category) continue;
    const key = category.join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(category);
  }
  return categories;
}

function isPgDeltaLogLevel(value: string): value is PgDeltaLogLevel {
  return (VALID_LOG_LEVELS as readonly string[]).includes(value);
}

export function resolvePgDeltaLogLevel(
  level: string | undefined,
): PgDeltaLogLevel {
  if (level && isPgDeltaLogLevel(level)) return level;
  return DEFAULT_LEVEL;
}

export async function configurePgDeltaLogging(options?: {
  debug?: string;
  level?: string;
  captureLogger?: (event: PgDeltaLogEvent) => void;
}): Promise<void> {
  loggingState = {
    rootLevel: resolvePgDeltaLogLevel(options?.level),
    debugCategories: parseDebugCategories(options?.debug),
    captureLogger: options?.captureLogger,
  };
}

export function getPgDeltaLogger(
  category?: string | readonly string[],
): PgDeltaLogger {
  const resolvedCategory = resolveCategory(category);
  const key = resolvedCategory.join(":");
  const cached = loggerCache.get(key);
  if (cached) return cached;

  const logger: PgDeltaLogger = {
    debug(message, properties) {
      emitLog("debug", resolvedCategory, message, properties);
    },
    info(message, properties) {
      emitLog("info", resolvedCategory, message, properties);
    },
    warn(message, properties) {
      emitLog("warning", resolvedCategory, message, properties);
    },
    error(message, properties) {
      emitLog("error", resolvedCategory, message, properties);
    },
    trace(message, properties) {
      emitLog("trace", resolvedCategory, message, properties);
    },
    fatal(message, properties) {
      emitLog("fatal", resolvedCategory, message, properties);
    },
    isEnabledFor(level) {
      return isEnabledForLevel(resolvedCategory, level);
    },
  };

  loggerCache.set(key, logger);
  return logger;
}

function resolveCategory(
  category?: string | readonly string[],
): readonly string[] {
  if (category === undefined) return [ROOT_CATEGORY];
  const suffix = Array.isArray(category) ? category : [category];
  return [ROOT_CATEGORY, ...suffix];
}

function resolveEffectiveLevel(category: readonly string[]): PgDeltaLogLevel {
  const debugLevel = loggingState.debugCategories.some((prefix) =>
    isCategoryMatch(category, prefix),
  )
    ? "debug"
    : undefined;
  if (!debugLevel) return loggingState.rootLevel;
  return LEVEL_ORDER[debugLevel] < LEVEL_ORDER[loggingState.rootLevel]
    ? debugLevel
    : loggingState.rootLevel;
}

function isCategoryMatch(
  category: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((part, index) => category[index] === part);
}

function normalizeLevel(level: string): PgDeltaLogLevel | null {
  const normalized = level.toLowerCase();
  if (normalized === "warn") return "warning";
  return isPgDeltaLogLevel(normalized) ? normalized : null;
}

function isEnabledForLevel(
  category: readonly string[],
  level: string,
): boolean {
  const normalized = normalizeLevel(level);
  if (!normalized) return false;
  return (
    LEVEL_ORDER[normalized] >= LEVEL_ORDER[resolveEffectiveLevel(category)]
  );
}

function emitLog(
  level: PgDeltaLogLevel,
  category: readonly string[],
  rawMessage: string,
  properties?: Record<string, unknown>,
): void {
  if (!isEnabledForLevel(category, level)) return;

  const event: PgDeltaLogEvent = {
    level,
    category,
    rawMessage,
    properties: properties ?? {},
  };
  loggingState.captureLogger?.(event);
  if (loggingState.captureLogger) return;

  try {
    loggingRuntime.runSync(
      toEffectLog(level, rawMessage).pipe(
        Effect.annotateLogs({
          category: category.join(":"),
          ...(properties ?? {}),
        }),
      ),
    );
  } catch {
    // Logging should never break program execution.
  }
}

function toEffectLog(level: PgDeltaLogLevel, message: string) {
  switch (level) {
    case "trace":
      return Effect.logTrace(message);
    case "debug":
      return Effect.logDebug(message);
    case "info":
      return Effect.logInfo(message);
    case "warning":
      return Effect.logWarning(message);
    case "error":
      return Effect.logError(message);
    case "fatal":
      return Effect.logFatal(message);
  }
}
