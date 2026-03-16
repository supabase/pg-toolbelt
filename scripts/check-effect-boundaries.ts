import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Rule = {
  readonly pattern: RegExp;
  readonly description: string;
};

type PackagePolicy = {
  readonly root: string;
  readonly allowPrefixes: readonly string[];
  readonly allowFiles?: readonly string[];
  readonly forbiddenFiles?: readonly string[];
  readonly rules: readonly Rule[];
};

const tsSourceFile = (filePath: string) =>
  filePath.endsWith(".ts") &&
  !filePath.endsWith(".d.ts") &&
  !filePath.endsWith(".test.ts");

const isThrowGuardExempt = (filePath: string) =>
  filePath.includes("/tests/") ||
  filePath.endsWith(".test.ts") ||
  filePath.includes("/src/core/test-utils/");

const walk = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walk(resolved);
    }
    return tsSourceFile(resolved) ? [resolved] : [];
  });
};

const runtimeRules: readonly Rule[] = [
  {
    pattern: /from\s+["']node:/,
    description: "imports from node:* must stay in adapters only",
  },
  {
    pattern: /from\s+["']pg["']/,
    description: "pg imports must stay in adapters only",
  },
  {
    pattern: /from\s+["']chalk["']/,
    description: "chalk imports must stay in adapters only",
  },
  {
    pattern: /from\s+["']@clack\/prompts["']/,
    description: "@clack/prompts imports must stay in adapters only",
  },
  {
    pattern: /from\s+["']plpgsql-parser["']/,
    description: "plpgsql-parser imports must stay in adapters only",
  },
  {
    pattern: /from\s+["']@pgsql\/traverse["']/,
    description: "@pgsql/traverse imports must stay in adapters only",
  },
  {
    pattern: /from\s+["']@effect\/platform-node\//,
    description: "@effect/platform-node imports must stay in adapters only",
  },
  {
    pattern: /\bcreateRequire\s*\(/,
    description: "createRequire must not be used in src",
  },
  {
    pattern: /\bglobalThis\.process\b|\bprocess\.(stdin|stdout|stderr|cwd)\b/,
    description: "direct process access must stay in adapters only",
  },
  {
    pattern: /\bcrypto\./,
    description: "direct crypto access must stay in adapters only",
  },
  {
    pattern: /\bnew Date\(/,
    description: "direct Date construction must stay in adapters only",
  },
];

const policies: readonly PackagePolicy[] = [
  {
    root: "packages/pg-topo/src",
    allowPrefixes: ["packages/pg-topo/src/adapters/"],
    rules: runtimeRules,
  },
  {
    root: "packages/pg-delta/src",
    allowPrefixes: [],
    allowFiles: [
      "packages/pg-delta/src/adapters/node-child-process-spawn.ts",
      "packages/pg-delta/src/adapters/node-platform.ts",
      "packages/pg-delta/src/adapters/pg-runtime.ts",
      "packages/pg-delta/src/adapters/runtime-process.ts",
    ],
    forbiddenFiles: [
      "packages/pg-delta/src/adapters/cli-package.ts",
      "packages/pg-delta/src/adapters/effect-cli-completions.ts",
      "packages/pg-delta/src/adapters/node-file.ts",
      "packages/pg-delta/src/adapters/terminal-prompts.ts",
      "packages/pg-delta/src/adapters/terminal-style.ts",
      "packages/pg-delta/src/adapters/timestamp.ts",
    ],
    rules: runtimeRules,
  },
];

const rootDir = process.cwd();
const issues: string[] = [];

const isIdentifierChar = (char: string) => /[A-Za-z0-9_$]/.test(char);

const findThrowStatements = (_filePath: string, content: string): number[] => {
  const lines: number[] = [];
  let line = 1;
  let index = 0;
  let state:
    | "code"
    | "single"
    | "double"
    | "template"
    | "lineComment"
    | "blockComment" = "code";

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\n") {
      line += 1;
      if (state === "lineComment") {
        state = "code";
      }
      index += 1;
      continue;
    }

    if (state === "lineComment") {
      index += 1;
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        state = "code";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      state = "lineComment";
      index += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      state = "blockComment";
      index += 2;
      continue;
    }

    if (char === "'") {
      state = "single";
      index += 1;
      continue;
    }

    if (char === '"') {
      state = "double";
      index += 1;
      continue;
    }

    if (char === "`") {
      state = "template";
      index += 1;
      continue;
    }

    if (
      content.startsWith("throw", index) &&
      !isIdentifierChar(content[index - 1] ?? "") &&
      !isIdentifierChar(content[index + 5] ?? "")
    ) {
      lines.push(line);
      index += 5;
      continue;
    }

    index += 1;
  }

  return lines;
};

for (const policy of policies) {
  const files = walk(path.join(rootDir, policy.root));
  for (const absoluteFile of files) {
    const relativeFile = path.relative(rootDir, absoluteFile);
    if (policy.forbiddenFiles?.includes(relativeFile)) {
      issues.push(`${relativeFile}: forbidden transitional boundary file`);
      continue;
    }
    if (
      policy.allowFiles?.includes(relativeFile) ||
      policy.allowPrefixes.some((prefix) => relativeFile.startsWith(prefix))
    ) {
      continue;
    }

    const content = readFileSync(absoluteFile, "utf8");
    for (const rule of policy.rules) {
      if (rule.pattern.test(content)) {
        issues.push(`${relativeFile}: ${rule.description}`);
      }
    }
    if (!isThrowGuardExempt(relativeFile)) {
      for (const line of findThrowStatements(relativeFile, content)) {
        issues.push(
          `${relativeFile}:${line}: production code must use typed Effect failures instead of throw`,
        );
      }
    }
  }
}

if (issues.length > 0) {
  console.error("Effect boundary check failed:\n");
  for (const issue of issues.sort((left, right) => left.localeCompare(right))) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Effect boundary check passed.");
