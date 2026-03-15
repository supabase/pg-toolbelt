import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Rule = {
  readonly pattern: RegExp;
  readonly description: string;
};

type PackagePolicy = {
  readonly root: string;
  readonly allowPrefixes: readonly string[];
  readonly allowFiles?: readonly string[];
  readonly rules: readonly Rule[];
};

const tsSourceFile = (filePath: string) =>
  filePath.endsWith(".ts") &&
  !filePath.endsWith(".d.ts") &&
  !filePath.endsWith(".test.ts");

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
    description: "imports from node:* must stay in adapters or entrypoints",
  },
  {
    pattern: /from\s+["']pg["']/,
    description: "pg imports must stay in node-pg adapters or platform layers",
  },
  {
    pattern: /from\s+["']chalk["']/,
    description: "chalk imports must stay in CLI runtime boundaries",
  },
  {
    pattern: /from\s+["']@clack\/prompts["']/,
    description: "@clack/prompts imports must stay in CLI runtime boundaries",
  },
  {
    pattern: /\bglobalThis\.process\b|\bprocess\.(stdin|stdout|stderr|cwd)\b/,
    description: "direct process access must stay in entrypoints or runtime layers",
  },
  {
    pattern: /\bcrypto\./,
    description: "direct crypto access must stay in approved legacy exceptions",
  },
  {
    pattern: /\bnew Date\(/,
    description: "direct Date construction must stay in approved legacy exceptions",
  },
];

const policies: readonly PackagePolicy[] = [
  {
    root: "packages/pg-topo/src",
    allowPrefixes: [
      "packages/pg-topo/src/adapters/",
      "packages/pg-topo/src/platform/",
    ],
    allowFiles: [
      "packages/pg-topo/src/node.ts",
      "packages/pg-topo/src/bun.ts",
    ],
    rules: runtimeRules,
  },
  {
    root: "packages/pg-delta/src",
    allowPrefixes: [
      "packages/pg-delta/src/adapters/",
      "packages/pg-delta/src/platform/",
      "packages/pg-delta/src/cli/",
    ],
    allowFiles: [
      "packages/pg-delta/src/node.ts",
      "packages/pg-delta/src/bun.ts",
    ],
    rules: runtimeRules,
  },
];

const rootDir = process.cwd();
const issues: string[] = [];

for (const policy of policies) {
  const files = walk(path.join(rootDir, policy.root));
  for (const absoluteFile of files) {
    const relativeFile = path.relative(rootDir, absoluteFile);
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
