/**
 * The `[db.migrations.checks]` policy (RFC §5): a severity per rule plus
 * relations excluded from every rule.
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
  /** `schema.relation` entries, matched against splinter's `metadata`. */
  readonly exclude: readonly string[];
}

export class PolicyError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid security check policy:\n  ${issues.join("\n  ")}`);
    this.name = "PolicyError";
    this.issues = issues;
  }
}

// Splinter metadata carries raw (unquoted) names, so one dot separates the two
// parts; a name that itself contains a dot or whitespace cannot be excluded.
const EXCLUDE_PATTERN = /^[^.\s]+\.[^.\s]+$/;

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
  let exclude: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === "exclude") {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
      ) {
        issues.push("exclude must be an array of strings");
        continue;
      }
      exclude = value as string[];
      exclude.forEach((entry, index) => {
        if (!EXCLUDE_PATTERN.test(entry)) {
          issues.push(
            `exclude[${index}]: expected "schema.relation", got ${JSON.stringify(entry)}`,
          );
        }
      });
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
  return { severities, exclude: [...new Set(exclude)] };
}

/** Rules resolved to `severity`, in {@link RULES} order. */
export function rulesAt(policy: ResolvedPolicy, severity: Severity): Rule[] {
  return RULES.filter((rule) => policy.severities[rule] === severity);
}
