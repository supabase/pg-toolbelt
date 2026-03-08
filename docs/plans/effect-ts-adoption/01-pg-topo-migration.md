---
name: "Effect-TS Phase 1a-1g: pg-topo Full Migration"
overview: Define error types, ParserService, convert async modules to Effect, update public API with dual exports. Does NOT include test migration (that's Phase 1h).
todos:
  - id: phase-1a-errors
    content: Create src/errors.ts with tagged error types
    status: pending
  - id: phase-1b-parser-service
    content: Create src/services/parser.ts (interface) and src/services/parser-live.ts (implementation)
    status: pending
  - id: phase-1c-parse-ingest
    content: Convert parse.ts and discover.ts to Effect
    status: pending
  - id: phase-1d-pipeline
    content: Convert analyze-and-sort.ts to Effect
    status: pending
  - id: phase-1e-from-files
    content: Convert from-files.ts to Effect with FileSystem
    status: pending
  - id: phase-1f-validate
    content: Convert validate-sql.ts to Effect
    status: pending
  - id: phase-1g-index
    content: Update index.ts with dual exports (Effect + Promise wrappers)
    status: pending
isProject: false
---

# Phase 1a-1g: pg-topo Full Migration — Detailed Implementation

## Prerequisites

- Phase 0 complete (Effect packages installed, tsconfig verified)

## Important: What does NOT change

12 out of 18 source files in pg-topo are pure synchronous computation and require ZERO changes:

- `src/classify/classify-statement.ts` (185 lines)
- `src/extract/extract-dependencies.ts` (830 lines)
- `src/extract/shared-refs.ts` (330 lines)
- `src/extract/expression-dependencies.ts` (416 lines)
- `src/graph/build-graph.ts` (403 lines)
- `src/graph/topo-sort.ts` (276 lines)
- `src/model/object-ref.ts` (234 lines)
- `src/model/object-compat.ts` (251 lines)
- `src/model/types.ts` (118 lines) — `Diagnostic` type stays unchanged
- `src/annotations/parse-annotations.ts` (251 lines)
- `src/utils/split-top-level.ts` (43 lines)
- `src/utils/ast.ts` (7 lines)

---

## Phase 1a: Define Error Types

### Create: `packages/pg-topo/src/errors.ts`

This maps existing error patterns to tagged Effect errors:

```typescript
import { Data } from "effect";

// Replaces the try/catch in parse.ts (lines 85-96) that catches parser failures
// and converts them to diagnostics. In Effect, parse failure is in the error channel.
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly filePath?: string;
  readonly cause?: unknown;
}> {}

// Replaces the missingRoots tracking in discover.ts (lines 40-42).
// Used when no SQL files can be found at all.
export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly message: string;
  readonly missingRoots: readonly string[];
}> {}

// Replaces the throw in validate-sql.ts (line 14: parseSql throws on syntax errors).
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

**Design decisions:**

- `Diagnostic` type in `model/types.ts` stays as-is. Diagnostics are non-fatal warnings (UNRESOLVED_DEPENDENCY, DUPLICATE_PRODUCER, CYCLE_DETECTED, etc.) that are part of `AnalyzeResult`. Consumers rely on them.
- `ParseError` is for fatal parser failures only (the parser WASM module fails to load, or SQL syntax is completely invalid).
- Non-fatal parse issues (empty statement nodes) remain as diagnostics.

---

## Phase 1b: Define ParserService

### Create: `packages/pg-topo/src/services/parser.ts`

Service interface — no implementation details, just the contract:

```typescript
import { Context, type Effect } from "effect";
import type { ParsedStatement } from "../ingest/parse.ts";
import type { ParseError } from "../errors.ts";
import type { Diagnostic } from "../model/types.ts";

export interface ParserApi {
  readonly parseSqlContent: (
    sql: string,
    sourceLabel: string,
  ) => Effect.Effect<
    { statements: ParsedStatement[]; diagnostics: Diagnostic[] },
    ParseError
  >;
}

export class ParserService extends Context.Tag("@pg-topo/ParserService")<
  ParserService,
  ParserApi
>() {}
```

**Note:** `parseSqlContent` returns `{ statements, diagnostics }` — same shape as the current function's return type (`ParseContentResult`). The `ParsedStatement` type stays exported from `parse.ts`.

### Create: `packages/pg-topo/src/services/parser-live.ts`

The live implementation wraps `plpgsql-parser`:

```typescript
import { Effect, Layer } from "effect";
import { loadModule as loadPlpgsqlParserModule } from "plpgsql-parser";
import { ParserService } from "./parser.ts";
import { ParseError } from "../errors.ts";
import { parseSqlContentImpl } from "../ingest/parse.ts";

// Effect.once is fiber-safe and lazy — replaces the module-level
// `let parserModuleLoadPromise: Promise<void> | null = null` singleton pattern
// currently in parse.ts (lines 36-42) and validate-sql.ts (lines 5-11).
const loadParser = Effect.once(
  Effect.tryPromise({
    try: () => loadPlpgsqlParserModule(),
    catch: (err) =>
      new ParseError({
        message: `Failed to load parser module: ${err}`,
        cause: err,
      }),
  }),
);

export const ParserServiceLive = Layer.effect(
  ParserService,
  Effect.gen(function* () {
    // Load WASM module once when the layer is built
    yield* Effect.flatten(loadParser);
    return ParserService.of({
      parseSqlContent: (sql, sourceLabel) =>
        Effect.try({
          try: () => parseSqlContentImpl(sql, sourceLabel),
          catch: (err) =>
            new ParseError({
              message:
                err instanceof Error ? err.message : "Unknown parser error",
              filePath: sourceLabel,
              cause: err,
            }),
        }),
    });
  }),
);
```

**Key difference from current code:** `ensureParserModuleLoaded()` singleton becomes `Effect.once()` which is fiber-safe and lazy.

---

## Phase 1c: Convert Parse and Discover Modules

### Modify: `packages/pg-topo/src/ingest/parse.ts`

**Current state:** `async parseSqlContent(sql, sourceLabel)` that loads the parser module, parses SQL, extracts statements, and catches errors to return diagnostics. ~130 lines.

**Changes:**

1. Remove the `parserModuleLoadPromise` singleton and `ensureParserModuleLoaded()` (lines 36-42) — this moves to `ParserServiceLive`.
2. Remove the `async` from `parseSqlContent` — the WASM module is already loaded by the service layer.
3. Rename the function to `parseSqlContentImpl` and make it synchronous (the parser is already loaded).
4. Keep the `ParsedStatement` type export (used by the service interface).
5. The `extractStatementSql` function currently uses `await deparseSql(...)` — this needs to either:

- Stay async and be wrapped by the service, OR
- Be handled within the service's `parseSqlContent` impl

**Concrete approach — split into sync core + Effect wrapper:**

The function has two async parts:

1. `ensureParserModuleLoaded()` — moves to service layer
2. `deparseSql()` in `extractStatementSql` (line 61) — this is a fallback path

**Option chosen:** Make `parseSqlContentImpl` async (keeps `deparseSql` calls), wrap in `Effect.tryPromise` in the service. This minimizes changes to the parsing logic itself.

```typescript
// parse.ts — after changes

// Keep all types exported
export type ParsedStatement = { ... }; // unchanged
type ParseContentResult = { ... }; // unchanged

// Remove: ensureParserModuleLoaded
// Remove: parserModuleLoadPromise

// extractStatementSql stays async (uses deparseSql)
const extractStatementSql = async (...) => { ... }; // unchanged

// Renamed from parseSqlContent, no longer calls ensureParserModuleLoaded
// Assumes parser module is already loaded (done by ParserServiceLive)
export const parseSqlContentImpl = async (
  content: string,
  sourceLabel: string,
): Promise<ParseContentResult> => {
  // Same logic as current parseSqlContent, minus the ensureParserModuleLoaded() call
  const diagnostics: Diagnostic[] = [];

  let parseResult: RawParserResult;
  try {
    parseResult = parseSql(content) as RawParserResult;
  } catch (error) {
    diagnostics.push({
      code: "PARSE_ERROR",
      message: error instanceof Error ? error.message : "Unknown parser error.",
      statementId: { filePath: sourceLabel, statementIndex: 0 },
    });
    return { statements: [], diagnostics };
  }

  // ... rest of current logic (lines 88-130) unchanged ...
};

// Keep backward-compat export for tests that haven't migrated yet:
export const parseSqlContent = async (
  content: string,
  sourceLabel: string,
): Promise<ParseContentResult> => {
  // Lazy-load parser module (old behavior)
  if (!parserModuleLoadPromise) {
    parserModuleLoadPromise = loadPlpgsqlParserModule();
  }
  await parserModuleLoadPromise;
  return parseSqlContentImpl(content, sourceLabel);
};
let parserModuleLoadPromise: Promise<void> | null = null;
```

Wait — actually it's cleaner to NOT split and instead update the `ParserServiceLive` to use `Effect.tryPromise` since `parseSqlContentImpl` is async:

```typescript
// In parser-live.ts:
parseSqlContent: (sql, sourceLabel) =>
  Effect.tryPromise({
    try: () => parseSqlContentImpl(sql, sourceLabel),
    catch: (err) =>
      new ParseError({
        message: err instanceof Error ? err.message : "Unknown parser error",
        filePath: sourceLabel,
        cause: err,
      }),
  }),
```

### Modify: `packages/pg-topo/src/ingest/discover.ts`

**Current state:** Uses `node:fs/promises` (`readdir`, `stat`) directly. ~61 lines.

**Changes:** Replace `node:fs` calls with `@effect/platform` `FileSystem` service.

```typescript
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import path from "node:path";

type DiscoveryResult = {
  files: string[];
  missingRoots: string[];
};

const readSqlFilesInDirectory = (
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(directoryPath);
    const sortedEntries = [...entries].sort((a, b) => a.localeCompare(b));

    for (const entryName of sortedEntries) {
      const fullPath = path.join(directoryPath, entryName);
      const info = yield* fs.stat(fullPath);
      if (info.type === "Directory") {
        yield* readSqlFilesInDirectory(fullPath, outFiles);
      } else if (
        info.type === "File" &&
        fullPath.toLowerCase().endsWith(".sql")
      ) {
        outFiles.add(path.resolve(fullPath));
      }
    }
  });

export const discoverSqlFilesEffect = (
  roots: string[],
): Effect.Effect<DiscoveryResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = new Set<string>();
    const missingRoots: string[] = [];

    for (const inputRoot of roots) {
      const resolvedRoot = path.resolve(inputRoot);
      const exists = yield* fs.exists(resolvedRoot);
      if (!exists) {
        missingRoots.push(inputRoot);
        continue;
      }

      const info = yield* fs.stat(resolvedRoot);
      if (info.type === "File" && resolvedRoot.toLowerCase().endsWith(".sql")) {
        files.add(resolvedRoot);
      } else if (info.type === "Directory") {
        yield* readSqlFilesInDirectory(resolvedRoot, files);
      }
    }

    return {
      files: [...files].sort((a, b) => a.localeCompare(b)),
      missingRoots,
    };
  });

// Keep backward-compat wrapper using node:fs
export { discoverSqlFiles } from "./discover-legacy.ts"; // OR inline the old version
```

**Alternative (simpler):** Keep the old `discoverSqlFiles` function as-is and add `discoverSqlFilesEffect` alongside it. The old one is used by `from-files.ts` (Promise wrapper) and tests. This avoids breaking anything during migration.

**Recommended approach:** Keep both. Export the old function as `discoverSqlFiles` and the new one as `discoverSqlFilesEffect`. The Promise wrapper in `index.ts` uses the old one; Effect consumers use the new one.

---

## Phase 1d: Convert analyze-and-sort Pipeline

### Modify: `packages/pg-topo/src/analyze-and-sort.ts`

**Current state:** `async analyzeAndSort(sql, options): Promise<AnalyzeResult>` — 243 lines. Orchestrates: parse all inputs → classify → extract deps → build graph → topo sort → return result.

**Changes:** Add a new `analyzeAndSortEffect` function that uses `ParserService`. Keep existing `analyzeAndSort` as a wrapper.

```typescript
import { Effect } from "effect";
import { ParserService } from "./services/parser.ts";
import type { ParseError } from "./errors.ts";
// ... existing imports stay ...

// All helper functions (dedupeDiagnostics, compareDiagnostics, buildGraphReport, EMPTY_RESULT) stay unchanged

export const analyzeAndSortEffect = (
  sql: string[],
  options?: AnalyzeOptions,
): Effect.Effect<AnalyzeResult, ParseError, ParserService> =>
  Effect.gen(function* () {
    if (sql.length === 0) {
      return {
        ...EMPTY_RESULT,
        diagnostics: [
          { code: "DISCOVERY_ERROR", message: "No SQL input provided." },
        ],
      };
    }

    const parser = yield* ParserService;
    const diagnostics: Diagnostic[] = [];
    const parsedStatements: ParsedStatement[] = [];

    for (let i = 0; i < sql.length; i += 1) {
      const parsed = yield* parser.parseSqlContent(sql[i], `<input:${i}>`);
      parsedStatements.push(...parsed.statements);
      diagnostics.push(...parsed.diagnostics);
    }

    // Everything below is pure sync — stays identical to current code (lines 110-190)
    const statementNodes: StatementNode[] = [];
    for (const parsedStatement of parsedStatements) {
      const statementClass = classifyStatement(parsedStatement.ast);
      // ... exact same logic as current ...
    }

    const graphState = buildGraph(statementNodes, options?.externalProviders);
    diagnostics.push(...graphState.diagnostics);

    const topoResult = topoSort(statementNodes, graphState.edges);
    // ... cycle detection diagnostics (lines 148-190) — unchanged ...

    const ordered = topoResult.orderedIndices
      .map((index) => statementNodes[index])
      .filter((n): n is StatementNode => Boolean(n));

    const graph = buildGraphReport(
      statementNodes,
      graphState.edges,
      graphState.edgeMetadata,
      topoResult.cycleGroups,
    );

    return {
      ordered,
      diagnostics: dedupeDiagnostics(diagnostics).sort(compareDiagnostics),
      graph,
    };
  });

// Keep existing analyzeAndSort as-is for backward compat
// (it will be updated in Phase 1g to delegate to Effect internally)
export const analyzeAndSort = async (
  sql: string[],
  options?: AnalyzeOptions,
): Promise<AnalyzeResult> => {
  // ... current implementation unchanged ...
};
```

**Key:** The pure synchronous functions (`classifyStatement`, `extractDependencies`, `buildGraph`, `topoSort`) are called within the Effect generator but don't need to be Effects themselves.

---

## Phase 1e: Convert from-files

### Modify: `packages/pg-topo/src/from-files.ts`

**Current state:** Uses `node:fs/promises` (`readFile`, `stat`) and `node:path`. Calls `discoverSqlFiles` → reads files → calls `analyzeAndSort`. ~144 lines.

**Changes:** Add `analyzeAndSortFromFilesEffect`. Keep old `analyzeAndSortFromFiles`.

```typescript
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import path from "node:path";
import { analyzeAndSortEffect } from "./analyze-and-sort.ts";
import { discoverSqlFilesEffect } from "./ingest/discover.ts";
import { ParserService } from "./services/parser.ts";
import type { ParseError, DiscoveryError } from "./errors.ts";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  Diagnostic,
} from "./model/types.ts";

export const analyzeAndSortFromFilesEffect = (
  roots: string[],
  options?: AnalyzeOptions,
): Effect.Effect<
  AnalyzeResult,
  ParseError | DiscoveryError,
  ParserService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (roots.length === 0) {
      return {
        ordered: [],
        diagnostics: [
          { code: "DISCOVERY_ERROR", message: "No roots provided..." },
        ],
        graph: { nodeCount: 0, edges: [], cycleGroups: [] },
      };
    }

    const fs = yield* FileSystem.FileSystem;
    const discovery = yield* discoverSqlFilesEffect(roots);
    const discoveryDiagnostics: Diagnostic[] = [];
    for (const missingRoot of discovery.missingRoots) {
      discoveryDiagnostics.push({
        code: "DISCOVERY_ERROR",
        message: `Root does not exist: '${missingRoot}'.`,
      });
    }

    // computeCommonBase logic (needs FileSystem for stat calls)
    const resolvedRoots = roots.map((r) => path.resolve(r));
    const basePath = yield* computeCommonBaseEffect(resolvedRoots);

    // Read all files
    const sqlContents: string[] = [];
    for (const filePath of discovery.files) {
      const content = yield* fs.readFileString(filePath, "utf-8");
      sqlContents.push(content);
    }

    const result = yield* analyzeAndSortEffect(sqlContents, options);

    // Remap synthetic source labels — same logic as current (lines 82-120)
    const filePathMap = new Map<string, string>();
    for (let i = 0; i < discovery.files.length; i += 1) {
      filePathMap.set(
        `<input:${i}>`,
        toStablePath(discovery.files[i], basePath),
      );
    }
    // ... remapping logic identical to current ...

    return {
      ordered: remappedOrdered,
      diagnostics: remappedDiagnostics,
      graph: remappedGraph,
    };
  });

// Helper converted to Effect
const computeCommonBaseEffect = (resolvedRoots: string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (resolvedRoots.length === 0) return process.cwd();
    const dirs: string[] = [];
    for (const root of resolvedRoots) {
      const exists = yield* fs.exists(root);
      if (exists) {
        const info = yield* fs.stat(root);
        dirs.push(info.type === "File" ? path.dirname(root) : root);
      } else {
        dirs.push(root);
      }
    }
    // ... rest of common base computation (pure sync) ...
  });

// Keep existing analyzeAndSortFromFiles as-is
```

---

## Phase 1f: Convert validateSqlSyntax

### Modify: `packages/pg-topo/src/validate-sql.ts`

**Current state:** 28 lines. Loads parser, calls `parseSql(sql)` which throws on syntax errors.

**Changes:** Add `validateSqlSyntaxEffect`. Keep old `validateSqlSyntax`.

```typescript
import { Effect } from "effect";
import { parseSql } from "plpgsql-parser";
import { ParserService } from "./services/parser.ts";
import { ValidationError } from "./errors.ts";

export const validateSqlSyntaxEffect = (
  sql: string,
): Effect.Effect<void, ValidationError, ParserService> =>
  Effect.gen(function* () {
    // ParserService ensures the WASM module is loaded
    const parser = yield* ParserService;
    // Use the parser to validate — mapError converts ParseError → ValidationError
    yield* parser
      .parseSqlContent(sql, "<validation>")
      .pipe(
        Effect.mapError(
          (e) => new ValidationError({ message: e.message, cause: e }),
        ),
      );
  });

// Keep existing validateSqlSyntax as-is for backward compat
export const validateSqlSyntax = async (sql: string): Promise<void> => {
  // ... current implementation unchanged ...
};
```

---

## Phase 1g: Update Public API (index.ts)

### Modify: `packages/pg-topo/src/index.ts`

**Changes:** Add Effect-native exports alongside existing Promise-based exports. The Promise wrappers delegate to Effect internally.

```typescript
// ============================================================================
// Effect-native exports (for Effect consumers)
// ============================================================================
export { analyzeAndSortEffect } from "./analyze-and-sort.ts";
export { analyzeAndSortFromFilesEffect } from "./from-files.ts";
export { validateSqlSyntaxEffect } from "./validate-sql.ts";
export { ParserService, type ParserApi } from "./services/parser.ts";
export { ParserServiceLive } from "./services/parser-live.ts";
export { ParseError, DiscoveryError, ValidationError } from "./errors.ts";

// ============================================================================
// Promise-based exports (backward compatible — unchanged signatures)
// ============================================================================
export { analyzeAndSort } from "./analyze-and-sort.ts";
export { analyzeAndSortFromFiles } from "./from-files.ts";
export { validateSqlSyntax } from "./validate-sql.ts";

// ============================================================================
// Type re-exports (unchanged)
// ============================================================================
export type {
  AnalyzeOptions,
  AnalyzeResult,
  AnnotationHints,
  Diagnostic,
  DiagnosticCode,
  GraphEdge,
  GraphEdgeReason,
  GraphReport,
  ObjectKind,
  ObjectRef,
  PhaseTag,
  StatementId,
  StatementNode,
} from "./model/types.ts";
```

**Alternative approach (separate entry point):** Add a new `src/effect.ts` entry point and a `./effect` export in `package.json`:

```json
// package.json exports
"exports": {
  ".": { "bun": "./src/index.ts", "import": "./dist/index.js", ... },
  "./effect": { "bun": "./src/effect.ts", "import": "./dist/effect.js", ... }
}
```

This keeps the main entry point clean and avoids Effect-related imports for consumers who don't use Effect. **Choose this approach if the import of `effect` adds measurable overhead to the main bundle.**

---

## Files Summary

| Action        | File                                                           | Lines Changed (est.)                   |
| ------------- | -------------------------------------------------------------- | -------------------------------------- |
| **Create**    | `src/errors.ts`                                                | ~25                                    |
| **Create**    | `src/services/parser.ts`                                       | ~25                                    |
| **Create**    | `src/services/parser-live.ts`                                  | ~40                                    |
| **Modify**    | `src/ingest/parse.ts`                                          | ~10 (rename + keep compat)             |
| **Modify**    | `src/ingest/discover.ts`                                       | ~60 (add Effect version alongside old) |
| **Modify**    | `src/analyze-and-sort.ts`                                      | ~80 (add Effect version alongside old) |
| **Modify**    | `src/from-files.ts`                                            | ~80 (add Effect version alongside old) |
| **Modify**    | `src/validate-sql.ts`                                          | ~15 (add Effect version alongside old) |
| **Modify**    | `src/index.ts`                                                 | ~20 (add new exports)                  |
| **Unchanged** | 12 files (classify, extract, graph, model, annotations, utils) | 0                                      |

## Verification Checklist

- `bun run check-types` passes (packages/pg-topo)
- `cd packages/pg-topo && bun test` passes (all existing tests)
- New Effect functions can be imported and type-check correctly
- `ParserServiceLive` successfully loads the WASM module
- `analyzeAndSortEffect` produces identical results to `analyzeAndSort` for the same input
- Old Promise-based API signatures are unchanged
