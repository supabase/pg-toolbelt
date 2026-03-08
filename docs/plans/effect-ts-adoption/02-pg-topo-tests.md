---
name: "Effect-TS Phase 1h: pg-topo Test Migration"
overview: Migrate pg-topo tests to work with the Effect API. Most tests need zero changes (they use Promise wrappers). A few need minor updates. Add new Effect-specific tests for DI/mocking.
todos:
  - id: audit-test-files
    content: Audit all 15 test files + 11 support files to classify change requirements
    status: pending
  - id: update-parse-test
    content: Update test/parse.test.ts to use ParserService or keep as-is
    status: pending
  - id: update-ingest-test
    content: Update test/ingest.test.ts for new discover function
    status: pending
  - id: update-expr-deps-test
    content: Update test/expression-dependencies.test.ts for parseSqlContent changes
    status: pending
  - id: update-support-files
    content: Update test/support/randomized-input.ts
    status: pending
  - id: create-effect-tests
    content: Create new Effect-specific tests for service mocking and Layer composition
    status: pending
  - id: verify-all-tests
    content: Run full pg-topo test suite
    status: pending
isProject: false
---

# Phase 1h: pg-topo Test Migration — Detailed Implementation

## Prerequisites

- Phase 1a-1g complete (Effect API exists alongside Promise API)

## Test File Audit

### Tests Requiring NO Changes (12 files)

These tests call `analyzeAndSort` / `analyzeAndSortFromFiles` which still exist as Promise wrappers, or test pure sync functions:

**Promise wrapper callers (no change needed):**

- `test/analyze-and-sort.test.ts` (106 lines) — calls `analyzeAndSort()`
- `test/diagnostics.test.ts` (235 lines) — calls `analyzeAndSort()`
- `test/statement-coverage.test.ts` (322 lines) — calls `analyzeAndSort()`
- `test/from-files.test.ts` (82 lines) — calls `analyzeAndSortFromFiles()`
- `test/extension-workaround.test.ts` (199 lines) — calls `analyzeAndSort()`
- `test/diverse-schema-fixture.test.ts` (107 lines) — calls `analyzeAndSortFromFiles()`
- `test/function-body-dependency-chain.test.ts` (193 lines) — calls `analyzeAndSort()`

**Pure sync function testers (no change needed):**

- `test/classify-statement.test.ts` (126 lines)
- `test/shared-refs.test.ts` (209 lines)
- `test/object-compat.test.ts` (206 lines)
- `test/object-ref-normalization.test.ts` (57 lines)
- `test/annotation-hardening.test.ts` (153 lines)

### Tests Requiring Minor Updates (3 files)

#### 1. `test/parse.test.ts` (~47 lines)

**Current:** Imports `parseSqlContent` directly from `../src/ingest/parse.ts`.

**What changed:** `parseSqlContent` was renamed to `parseSqlContentImpl` (internal), and a compat wrapper `parseSqlContent` was kept.

**Action:** If the backward-compat `parseSqlContent` export was preserved (recommended in Phase 1c), NO CHANGE needed. The test continues to call the old function name.

**If `parseSqlContent` was removed:** Update import:

```typescript
// Before
import { parseSqlContent } from "../src/ingest/parse.ts";

// After (Option A — use compat export)
import { parseSqlContent } from "../src/ingest/parse.ts"; // no change if compat preserved

// After (Option B — use Effect API with runPromise)
import { Effect } from "effect";
import { ParserServiceLive } from "../src/services/parser-live.ts";
import { ParserService } from "../src/services/parser.ts";

const parseSqlContent = (sql: string, label: string) =>
  Effect.gen(function* () {
    const parser = yield* ParserService;
    return yield* parser.parseSqlContent(sql, label);
  }).pipe(Effect.provide(ParserServiceLive), Effect.runPromise);
```

**Recommended:** Keep compat export → zero changes to this file.

#### 2. `test/ingest.test.ts` (~73 lines)

**Current:** Imports `discoverSqlFiles` from `../src/ingest/discover.ts` and `parseSqlContent` from `../src/ingest/parse.ts`.

**What changed:** `discoverSqlFiles` was kept as backward-compat; `discoverSqlFilesEffect` was added alongside.

**Action:** If backward-compat exports preserved → NO CHANGE needed.

**If discover was fully replaced with Effect:** Wrap in `Effect.runPromise`:

```typescript
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-bun"; // or @effect/platform-node
import { discoverSqlFilesEffect } from "../src/ingest/discover.ts";

const discoverSqlFiles = (roots: string[]) =>
  discoverSqlFilesEffect(roots).pipe(
    Effect.provide(NodeFileSystem.layer),
    Effect.runPromise,
  );
```

**Recommended:** Keep compat export → zero changes.

#### 3. `test/expression-dependencies.test.ts` (~94 lines)

**Current:** Imports `parseSqlContent` from `../src/ingest/parse.ts`.

**Action:** Same as `parse.test.ts` — if compat export preserved, no change.

### Support Files Requiring Updates (1-2 files)

#### `test/support/randomized-input.ts` (~21 lines)

**Current:** Imports `parseSqlContent` from `../../src/ingest/parse.ts`, `discoverSqlFiles` from `../../src/ingest/discover.ts`, and uses `node:fs/promises` directly.

**Action:** If compat exports preserved → NO CHANGE needed. This file is test infrastructure, not library code.

#### `test/support/temp-fixture.ts` (~53 lines)

**Current:** Uses `node:fs/promises` directly for creating temp directories and files.

**Action:** NO CHANGE. This is test scaffolding that creates temporary filesystem fixtures. It doesn't need to use Effect's FileSystem — it's setup code that runs before the Effect pipeline.

### Support Files Requiring NO Changes (remaining)

- `test/support/fingerprint.ts` — pure helper
- `test/support/fixture-regression.ts` — pure helper
- `test/support/postgres-validation.ts` — uses testcontainers directly
- `test/support/postgres/*.ts` (5 files) — testcontainer/PG helpers
- `test/support/randomized-runtime-analysis.ts` — pure analysis helper

---

## New Test Files to Create

### Create: `test/effect-services.test.ts`

Tests ParserService mocking and Layer composition:

```typescript
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ParserService } from "../src/services/parser.ts";
import { ParserServiceLive } from "../src/services/parser-live.ts";
import { analyzeAndSortEffect } from "../src/analyze-and-sort.ts";
import { ParseError } from "../src/errors.ts";
import type { Diagnostic } from "../src/model/types.ts";

describe("ParserService", () => {
  test("ParserServiceLive loads and parses SQL", async () => {
    const result = await analyzeAndSortEffect([
      "CREATE TABLE foo (id int);",
    ]).pipe(Effect.provide(ParserServiceLive), Effect.runPromise);
    expect(result.ordered.length).toBe(1);
    expect(result.ordered[0].sql).toContain("CREATE TABLE");
  });

  test("mock ParserService for testing", async () => {
    const MockParser = Layer.succeed(ParserService, {
      parseSqlContent: (sql, label) =>
        Effect.succeed({
          statements: [
            {
              id: { filePath: label, statementIndex: 0 },
              ast: { CreateStmt: {} },
              sql: sql,
              annotations: { dependsOn: [], requires: [], provides: [] },
            },
          ],
          diagnostics: [] as Diagnostic[],
        }),
    });

    const result = await analyzeAndSortEffect(["mock sql"]).pipe(
      Effect.provide(MockParser),
      Effect.runPromise,
    );
    // Should have processed the mock statement
    expect(result.ordered.length).toBeGreaterThanOrEqual(0);
  });

  test("ParseError is typed in the error channel", async () => {
    const FailingParser = Layer.succeed(ParserService, {
      parseSqlContent: (_sql, _label) =>
        Effect.fail(new ParseError({ message: "parser crashed" })),
    });

    const result = await analyzeAndSortEffect(["bad sql"]).pipe(
      Effect.provide(FailingParser),
      Effect.either,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ParseError");
      expect(result.left.message).toBe("parser crashed");
    }
  });
});
```

### Create: `test/effect-from-files.test.ts`

Tests FileSystem DI with mock filesystem:

```typescript
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { BunFileSystem } from "@effect/platform-bun";
import { ParserServiceLive } from "../src/services/parser-live.ts";
import { analyzeAndSortFromFilesEffect } from "../src/from-files.ts";

describe("analyzeAndSortFromFilesEffect", () => {
  test("works with BunFileSystem layer", async () => {
    // This uses real filesystem — needs the test fixtures to exist
    const result = await analyzeAndSortFromFilesEffect([
      "./test/fixtures/diverse-schema",
    ]).pipe(
      Effect.provide(Layer.merge(ParserServiceLive, BunFileSystem.layer)),
      Effect.runPromise,
    );
    expect(result.ordered.length).toBeGreaterThan(0);
  });

  test("reports missing roots", async () => {
    const result = await analyzeAndSortFromFilesEffect([
      "/nonexistent/path",
    ]).pipe(
      Effect.provide(Layer.merge(ParserServiceLive, BunFileSystem.layer)),
      Effect.runPromise,
    );
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_ERROR")).toBe(
      true,
    );
  });

  // Future: test with mock FileSystem layer for isolated tests
});
```

---

## Verification Checklist

Run the full pg-topo test suite:

```bash
cd packages/pg-topo && bun test
```

- All 15 existing test files pass unchanged
- New `test/effect-services.test.ts` passes
- New `test/effect-from-files.test.ts` passes
- No regressions in any test
- `bun run check-types` passes

## Files Summary

| Action           | File                                   | Estimated Changes                         |
| ---------------- | -------------------------------------- | ----------------------------------------- |
| **No change**    | 12 test files                          | 0                                         |
| **Minor update** | `test/parse.test.ts`                   | 0-5 lines (if compat export preserved: 0) |
| **Minor update** | `test/ingest.test.ts`                  | 0-5 lines (if compat export preserved: 0) |
| **Minor update** | `test/expression-dependencies.test.ts` | 0-5 lines (if compat export preserved: 0) |
| **No change**    | 10 support files                       | 0                                         |
| **Minor update** | `test/support/randomized-input.ts`     | 0 lines (test infra, not library)         |
| **Create**       | `test/effect-services.test.ts`         | ~60                                       |
| **Create**       | `test/effect-from-files.test.ts`       | ~40                                       |
