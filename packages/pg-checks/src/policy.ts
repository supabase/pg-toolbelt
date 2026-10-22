/**
 * The `[db.migrations.checks]` policy (RFC §5): a severity per rule plus
 * objects excluded from individual rules (`[db.migrations.checks.exclude]`).
 */

/** Splinter security rules the check evaluates (RFC §5, D8). */
export const RULES = [
  "rls_disabled_in_public",
  "rls_enabled_no_policy",
  "policy_exists_rls_disabled",
  "security_definer_view",
  "rls_policy_always_true",
  "sensitive_columns_exposed",
  "auth_users_exposed",
  "function_search_path_mutable",
  "rls_references_user_metadata",
] as const;

export type Rule = (typeof RULES)[number];

/** `error` blocks and rolls back, `warn` applies and reports, `off` skips (D5). */
export type Severity = "error" | "warn" | "off";

const SEVERITIES: readonly Severity[] = ["error", "warn", "off"];

export interface ResolvedPolicy {
  readonly severities: Readonly<Record<Rule, Severity>>;
  /** `object` is `schema.name`, matched against splinter's `metadata`. */
  readonly exclude: ReadonlyArray<{
    readonly rule: Rule;
    readonly object: string;
  }>;
}

export class PolicyError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid security check policy:\n  ${issues.join("\n  ")}`);
    this.name = "PolicyError";
    this.issues = issues;
  }
}

// Splinter metadata carries raw (unquoted) names: an entry is `schema.name`
// with a dot and text on both sides, and no quoting.
const isObjectName = (entry: string) => {
  const dot = entry.indexOf(".");
  return entry === entry.trim() && dot > 0 && dot < entry.length - 1;
};

const isRule = (key: string): key is Rule =>
  (RULES as readonly string[]).includes(key);

/**
 * Validates a policy as read from `config.toml` or a project setting. Absent
 * rules resolve to `warn` (D2). Every problem is reported at once.
 */
export function resolvePolicy(input: unknown): ResolvedPolicy {
  const source = input ?? {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new PolicyError(["policy must be an object"]);
  }
  const issues: string[] = [];
  const severities = Object.fromEntries(
    RULES.map((rule) => [rule, "warn"]),
  ) as Record<Rule, Severity>;
  const exclude: Array<{ rule: Rule; object: string }> = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === "exclude") {
      collectExclusions(value, exclude, issues);
    } else if (!isRule(key)) {
      issues.push(`unknown rule ${JSON.stringify(key)}`);
    } else if (!SEVERITIES.includes(value as Severity)) {
      issues.push(
        `rule "${key}": severity must be "error", "warn" or "off", got ${JSON.stringify(value)}`,
      );
    } else {
      severities[key] = value as Severity;
    }
  }
  if (issues.length > 0) throw new PolicyError(issues);
  return { severities, exclude };
}

function collectExclusions(
  value: unknown,
  out: Array<{ rule: Rule; object: string }>,
  issues: string[],
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push("exclude must be a table of rule names to lists");
    return;
  }
  const seen = new Set<string>();
  for (const [rule, entries] of Object.entries(value)) {
    if (!isRule(rule)) {
      issues.push(`exclude: unknown rule ${JSON.stringify(rule)}`);
    } else if (!Array.isArray(entries)) {
      issues.push(
        "values under [db.migrations.checks.exclude] must be lists; severities go above it",
      );
    } else {
      entries.forEach((entry: unknown, index) => {
        if (typeof entry !== "string" || !isObjectName(entry)) {
          issues.push(
            `exclude.${rule}[${index}]: expected "schema.name", got ${JSON.stringify(entry)}`,
          );
        } else if (!seen.has(`${rule}\0${entry}`)) {
          seen.add(`${rule}\0${entry}`);
          out.push({ rule, object: entry });
        }
      });
    }
  }
}

/** Rules resolved to `severity`, in {@link RULES} order. */
export function rulesAt(policy: ResolvedPolicy, severity: Severity): Rule[] {
  return RULES.filter((rule) => policy.severities[rule] === severity);
}
