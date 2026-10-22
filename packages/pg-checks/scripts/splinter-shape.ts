/**
 * Structural split of a released `splinter.sql`. The rule SQL is never edited:
 * the file is cut only at the boundaries the release format guarantees, and any
 * deviation throws so a sync never vendors a file the check block cannot embed.
 *
 * Release format (2026.09.1):
 *
 *   set local search_path = '';
 *   <comments>
 *   do $$ ... end $$;          -- preamble, sets splinter.* settings
 *   (<rule 1>)
 *   union all
 *   (<rule 2>)
 *   ...
 *
 * Each branch is one `lints/*.sql` file as splinter's bin/compile.py writes it
 * (files sorted by name, `create view` line dropped, `;` removed, wrapped in
 * parentheses). The sync checks that against the tag's lint files, so a branch
 * boundary can never land inside a rule.
 */

export interface SplinterRule {
  readonly name: string;
  readonly categories: readonly string[];
  /** The branch reads a `splinter.*` setting the preamble sets. */
  readonly readsSplinterSettings: boolean;
  /** The branch, `(` to `)`, verbatim. */
  readonly sql: string;
}

export interface SplinterShape {
  readonly preamble: string;
  readonly query: string;
  readonly rules: readonly SplinterRule[];
}

const HEADER = "set local search_path = '';";
// Prefix of the dollar-quote tags the check block wraps the query in (src/check.ts).
const CHECK_TAG = "$sbc";

export function splitSplinter(text: string): SplinterShape {
  const fail = (why: string): never => {
    throw new Error(`splinter.sql has an unexpected shape: ${why}`);
  };
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith(`${HEADER}\n`)) {
    fail(
      `first line must be exactly ${JSON.stringify(HEADER)} (search_path header)`,
    );
  }
  const afterHeader = normalized.slice(HEADER.length + 1);
  const doStart = afterHeader.search(/^do \$\$$/m);
  const doEndMatch = /^end \$\$;$/m.exec(afterHeader);
  if (doStart < 0 || doEndMatch === null || doEndMatch.index < doStart) {
    fail("expected a `do $$` ... `end $$;` preamble after the header");
  }
  const doEnd = (doEndMatch?.index ?? 0) + "end $$;".length;
  const beforeDo = afterHeader.slice(0, doStart);
  if (
    beforeDo
      .split("\n")
      .some((line) => line.trim() !== "" && !line.trim().startsWith("--"))
  ) {
    fail("only comments may sit between the header and the preamble");
  }
  const preamble = afterHeader.slice(doStart, doEnd);
  const query = afterHeader.slice(doEnd).trim();
  if (!query.startsWith("(") || !query.endsWith(")")) {
    fail("query must start with `(` and end with `)` (no trailing statements)");
  }
  if (query.includes(CHECK_TAG)) {
    fail(`query contains ${CHECK_TAG}, the check block's dollar-quote tag`);
  }
  const branches = query.split("\nunion all\n");
  const rules = branches.map((branchText, index): SplinterRule => {
    const where = `branch ${index + 1}`;
    if (!branchText.startsWith("(") || !branchText.endsWith(")")) {
      fail(`${where} is not parenthesized`);
    }
    const names = [...branchText.matchAll(/^\s*'([a-z0-9_]+)' as name,$/gm)];
    if (names.length !== 1) {
      fail(
        `${where} must carry exactly one \`'<rule>' as name\` column, found ${names.length}`,
      );
    }
    const categories = /^\s*array\[([^\]]*)\] as categories,$/m.exec(
      branchText,
    );
    if (categories === null) {
      fail(`${where} has no \`array[...] as categories\` column`);
    }
    return {
      name: names[0]?.[1] ?? "",
      categories: (categories?.[1] ?? "")
        .split(",")
        .map((c) => c.trim().replace(/^'|'$/g, "")),
      readsSplinterSettings: /current_setting\('splinter\./.test(branchText),
      sql: branchText,
    };
  });
  return { preamble, query, rules };
}

export interface LintSource {
  /** File name under `lints/`, e.g. `0013_rls_disabled_in_public.sql`. */
  readonly file: string;
  readonly text: string;
}

/** A lint file as bin/compile.py puts it in the union (Python's `strip()` ≈ `trim()`). */
const compiledBranch = (source: string) =>
  `(${source
    .trim()
    .split("\n")
    .filter((line) => !line.includes("create view"))
    .map((line) => line.replaceAll(";", ""))
    .join("\n")})`;

/** Throws unless the release's branches are exactly its lint files, in file order. */
export function verifyLintSources(
  shape: SplinterShape,
  sources: readonly LintSource[],
): void {
  const sorted = [...sources].sort((x, y) =>
    x.file < y.file ? -1 : x.file > y.file ? 1 : 0,
  );
  const problems: string[] = [];
  if (sorted.length !== shape.rules.length) {
    problems.push(
      `${shape.rules.length} branches, ${sorted.length} lint files`,
    );
  }
  sorted.forEach((source, index) => {
    const branch = shape.rules[index];
    if (branch !== undefined && compiledBranch(source.text) !== branch.sql) {
      problems.push(
        `branch ${index + 1} (${branch.name}) is not lints/${source.file}`,
      );
    }
  });
  if (problems.length > 0) {
    throw new Error(
      `splinter.sql does not match its lint files:\n  ${problems.join("\n  ")}`,
    );
  }
}

/** The generated `src/vendor/splinter.ts`: one branch per checked rule. */
export function renderVendoredModule(
  sql: string,
  version: string,
  rules: readonly string[],
): string {
  const shape = splitSplinter(sql);
  const entries = rules.map((rule) => {
    const found = shape.rules.find((r) => r.name === rule);
    if (found === undefined) {
      throw new Error(`splinter ${version}: checked rule ${rule} is missing`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(rule)) {
      throw new Error(`rule name ${JSON.stringify(rule)} is not an identifier`);
    }
    return `  ${rule}:\n    ${JSON.stringify(found.sql)},`;
  });
  return `// Generated by scripts/sync-splinter.ts from splinter.sql (splinter ${version}). Do not edit.

export const SPLINTER_VERSION = ${JSON.stringify(version)};

/**
 * Each checked rule's branch of the release's \`(...) union all (...)\` query,
 * verbatim. Needs \`search_path = ''\`. The release's \`do $$\` preamble is not
 * vendored: it only sets \`splinter.*\` settings, which no checked rule reads.
 */
export const RULE_SQL: Readonly<Record<string, string>> = {
${entries.join("\n")}
};
`;
}
