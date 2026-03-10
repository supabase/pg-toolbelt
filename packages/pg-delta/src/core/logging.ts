import {
  configure,
  getConsoleSink,
  getLogger,
  isLogLevel,
  type Logger,
  type LoggerConfig,
  type LogLevel,
} from "@logtape/logtape";

const ROOT_CATEGORY = "pg-delta";
const DEFAULT_LEVEL: LogLevel = "warning";

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

export function resolvePgDeltaLogLevel(level: string | undefined): LogLevel {
  if (level && isLogLevel(level)) return level;
  return DEFAULT_LEVEL;
}

export async function configurePgDeltaLogging(options?: {
  debug?: string;
  level?: string;
}): Promise<void> {
  const rootLevel = resolvePgDeltaLogLevel(options?.level);
  const debugCategories = parseDebugCategories(options?.debug);
  const loggers: LoggerConfig<"console", never>[] = [
    {
      category: [ROOT_CATEGORY],
      sinks: ["console"],
      lowestLevel: rootLevel,
    },
    {
      category: ["logtape"],
      sinks: ["console"],
      lowestLevel: "error",
    },
    ...debugCategories.map<LoggerConfig<"console", never>>((category) => ({
      category,
      sinks: ["console"],
      lowestLevel: "debug",
    })),
  ];

  await configure({
    reset: true,
    sinks: {
      console: getConsoleSink(),
    },
    loggers,
  });
}

export function getPgDeltaLogger(
  category?: string | readonly string[],
): Logger {
  if (category === undefined) return getLogger([ROOT_CATEGORY]);
  const suffix = Array.isArray(category) ? category : [category];
  return getLogger([ROOT_CATEGORY, ...suffix]);
}
