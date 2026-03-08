---
name: "Effect-TS Phase 5a-5b: pg-delta CLI Migration"
overview: Migrate pg-delta CLI from @stricli/core to @effect/cli. Rewrite command definitions and entry point.
todos:
  - id: phase-5a-install-deps
    content: Install @effect/cli dependency
    status: pending
  - id: phase-5a-plan-command
    content: Rewrite plan command with @effect/cli
    status: pending
  - id: phase-5a-apply-command
    content: Rewrite apply command with @effect/cli
    status: pending
  - id: phase-5a-sync-command
    content: Rewrite sync command with @effect/cli
    status: pending
  - id: phase-5a-declarative-commands
    content: Rewrite declarative-apply and declarative-export commands
    status: pending
  - id: phase-5a-catalog-export
    content: Rewrite catalog-export command
    status: pending
  - id: phase-5b-entry-point
    content: Rewire CLI app entry point with Effect runtime
    status: pending
  - id: phase-5b-remove-stricli
    content: Remove @stricli/core from dependencies
    status: pending
  - id: verify
    content: Run CLI commands manually to verify
    status: pending
isProject: false
---

# Phase 5a-5b: pg-delta CLI Migration — Detailed Implementation

## Prerequisites

- Phase 3c-3f complete (all Effect pipeline APIs exist)
- Phase 4a complete (test infrastructure in place)

---

## Phase 5a: Migrate CLI Commands to @effect/cli

### Install Dependency

```bash
cd packages/pg-delta
bun add @effect/cli
```

Add to `dependencies` in `package.json`:

```json
"@effect/cli": "^0.x.x"
```

### Current CLI Structure

```
src/cli/
├── bin/
│   └── cli.ts          # Entry point (Stricli run)
├── app.ts              # Stricli app registration
├── commands/
│   ├── plan.ts         # plan command
│   ├── apply.ts        # apply command
│   ├── sync.ts         # sync command
│   ├── declarative-apply.ts  # declarative apply subcommand
│   ├── declarative-export.ts # declarative export subcommand
│   └── catalog-export.ts     # catalog-export command
├── formatters/
│   ├── index.ts
│   └── tree/           # Tree view formatter
├── utils/
│   └── (various helpers)
└── utils.ts
```

### Understanding the Current Pattern

Each command file exports a Stricli command definition. Need to read the actual files to understand:

1. What options/flags each command accepts
2. How arguments are parsed
3. What the command handler does
4. How output is formatted

**Before converting, read each command file to understand the exact CLI interface.**

### Command Conversion Pattern

**@effect/cli structure:**

```typescript
import { Command, Options, Args } from "@effect/cli";
import { Effect } from "effect";

const myOption = Options.text("option-name").pipe(
  Options.withAlias("o"),
  Options.withDescription("Description"),
);

const myOptionalOption = Options.text("optional").pipe(Options.optional);

const myCommand = Command.make(
  "name",
  { opt: myOption, opt2: myOptionalOption },
  ({ opt, opt2 }) =>
    Effect.gen(function* () {
      // command implementation using Effect
    }),
);
```

### Rewrite: `src/cli/commands/plan.ts`

**Current flags (from Stricli):**

- `--source` / `-s` — source database URL or catalog snapshot (optional)
- `--target` / `-t` — target database URL or catalog snapshot (required)
- `--output` / `-o` — output file path (optional, defaults to stdout)
- `--format` / `-f` — output format: `sql` | `json` | `tree` (default: `tree`)
- `--integration` — integration name (e.g., `supabase`)
- `--role` — PostgreSQL role
- `--filter` — filter DSL JSON string
- `--serialize` — serialize DSL JSON string

**After:**

```typescript
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { createPlanEffect } from "../../core/plan/create.ts";
import { formatOutput } from "../formatters/index.ts";
import { resolveIntegration } from "../utils/integrations.ts";
import { resolveInput } from "../utils/resolve-input.ts";

const source = Options.text("source").pipe(
  Options.withAlias("s"),
  Options.withDescription("Source database URL or catalog snapshot file"),
  Options.optional,
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription("Target database URL or catalog snapshot file"),
);

const output = Options.text("output").pipe(
  Options.withAlias("o"),
  Options.withDescription("Output file path (defaults to stdout)"),
  Options.optional,
);

const format = Options.choice("format", ["sql", "json", "tree"]).pipe(
  Options.withAlias("f"),
  Options.withDefault("tree"),
);

const integration = Options.text("integration").pipe(
  Options.withDescription("Integration name (e.g., supabase)"),
  Options.optional,
);

const role = Options.text("role").pipe(
  Options.withDescription("PostgreSQL role for SET ROLE"),
  Options.optional,
);

const filter = Options.text("filter").pipe(
  Options.withDescription("Filter DSL (JSON)"),
  Options.optional,
);

const serialize = Options.text("serialize").pipe(
  Options.withDescription("Serialize DSL (JSON)"),
  Options.optional,
);

export const planCommand = Command.make(
  "plan",
  { source, target, output, format, integration, role, filter, serialize },
  (opts) =>
    Effect.gen(function* () {
      // Resolve integration
      const int = opts.integration
        ? yield* Effect.try(() => resolveIntegration(opts.integration!))
        : undefined;

      // Parse filter/serialize DSL if provided
      const filterDSL = opts.filter
        ? yield* Effect.try(() => JSON.parse(opts.filter!))
        : int?.filter;
      const serializeDSL = opts.serialize
        ? yield* Effect.try(() => JSON.parse(opts.serialize!))
        : int?.serialize;

      // Resolve source input (URL, file, or null)
      const sourceInput = opts.source
        ? yield* Effect.promise(() => resolveInput(opts.source!))
        : null;
      const targetInput = yield* Effect.promise(() =>
        resolveInput(opts.target),
      );

      // Create plan
      const result = yield* createPlanEffect(sourceInput, targetInput, {
        role: opts.role,
        filter: filterDSL,
        serialize: serializeDSL,
      }).pipe(Effect.scoped);

      if (!result) {
        yield* Effect.log("No changes detected.");
        return;
      }

      // Format and output
      const formatted = formatOutput(result, opts.format);
      if (opts.output) {
        yield* Effect.promise(() => Bun.write(opts.output!, formatted));
        yield* Effect.log(`Plan written to ${opts.output}`);
      } else {
        console.log(formatted);
      }
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // Handle typed errors with appropriate exit codes
          console.error(`Error: ${error.message ?? error}`);
          yield* Effect.fail(error);
        }),
      ),
    ),
);
```

### Rewrite: `src/cli/commands/apply.ts`

**Current flags:**

- `--plan` — plan file path (required)
- `--source` — source database URL (required)
- `--target` — target database URL (required)
- `--unsafe` — allow data-loss operations (flag)
- `--verify` / `--no-verify` — post-apply verification

**After:**

```typescript
import { Command, Options } from "@effect/cli";
import { Effect } from "effect";
import { applyPlanEffect } from "../../core/plan/apply.ts";
import { deserializePlan } from "../../core/plan/io.ts";

const plan = Options.file("plan").pipe(
  Options.withDescription("Path to plan JSON file"),
);

const source = Options.text("source").pipe(
  Options.withAlias("s"),
  Options.withDescription("Source database URL"),
);

const target = Options.text("target").pipe(
  Options.withAlias("t"),
  Options.withDescription("Target database URL"),
);

const unsafe = Options.boolean("unsafe").pipe(
  Options.withDefault(false),
  Options.withDescription("Allow data-loss operations (drops, truncates)"),
);

export const applyCommand = Command.make(
  "apply",
  { plan, source, target, unsafe },
  (opts) =>
    Effect.gen(function* () {
      const planContent = yield* Effect.promise(() =>
        Bun.file(opts.plan).text(),
      );
      const planObj = deserializePlan(planContent);

      // Safety check for data-loss
      if (planObj.risk?.level === "data_loss" && !opts.unsafe) {
        console.error(
          "Plan contains data-loss operations. Use --unsafe to proceed.",
        );
        return yield* Effect.fail(new Error("Unsafe plan rejected"));
      }

      const result = yield* applyPlanEffect(
        planObj,
        opts.source,
        opts.target,
      ).pipe(Effect.scoped);

      // Display result
      console.log(`Applied ${result.statements} statements.`);
      if (result.warnings) {
        for (const w of result.warnings) {
          console.warn(`Warning: ${w}`);
        }
      }
    }).pipe(
      Effect.catchTags({
        AlreadyAppliedError: () =>
          Effect.log("Plan already applied. No changes made."),
        FingerprintMismatchError: (e) =>
          Effect.gen(function* () {
            console.error(
              `Fingerprint mismatch: current=${e.current}, expected=${e.expected}`,
            );
            yield* Effect.fail(e);
          }),
        InvalidPlanError: (e) =>
          Effect.gen(function* () {
            console.error(`Invalid plan: ${e.message}`);
            yield* Effect.fail(e);
          }),
        PlanApplyError: (e) =>
          Effect.gen(function* () {
            console.error(`Apply failed: ${e.cause}`);
            yield* Effect.fail(e);
          }),
      }),
    ),
);
```

**Key improvement:** `Effect.catchTags` provides exhaustive pattern matching on typed errors — much cleaner than the current `switch (result.status)` pattern.

### Rewrite: Other commands

Follow the same pattern for:

- `sync.ts` — combines plan + apply in one step
- `declarative-apply.ts` — uses `applyDeclarativeSchemaEffect`
- `declarative-export.ts` — uses `createPlanEffect` + `exportDeclarativeSchema`
- `catalog-export.ts` — uses `extractCatalogEffect`

Each command:

1. Define options using `Options.`
2. Implement handler using `Effect.gen`
3. Use the Effect pipeline APIs (`*Effect` functions)
4. Handle errors with `Effect.catchTags` for clean error messages

### Formatters and Utils

- `src/cli/formatters/` — These are pure sync functions that format plan output as tree/SQL/JSON. They stay unchanged.
- `src/cli/utils/` — These are helper functions. Most stay unchanged. `resolve-input.ts` might need a minor Effect wrapper if it does async I/O (reading snapshot files).
- `src/cli/utils.ts` — Shared CLI helpers. Stay unchanged unless they do async I/O.

---

## Phase 5b: Rewire CLI App Entry Point

### Modify: `src/cli/app.ts`

Replace Stricli app registration with @effect/cli command composition:

```typescript
import { Command } from "@effect/cli";
import { planCommand } from "./commands/plan.ts";
import { applyCommand } from "./commands/apply.ts";
import { syncCommand } from "./commands/sync.ts";
import { catalogExportCommand } from "./commands/catalog-export.ts";

// Declarative subcommands
const declarativeApplyCommand = ...; // from commands/declarative-apply.ts
const declarativeExportCommand = ...; // from commands/declarative-export.ts

const declarativeCommand = Command.make("declarative").pipe(
  Command.withSubcommands([
    ["apply", declarativeApplyCommand],
    ["export", declarativeExportCommand],
  ]),
);

export const pgdelta = Command.make("pgdelta").pipe(
  Command.withSubcommands([
    ["plan", planCommand],
    ["apply", applyCommand],
    ["sync", syncCommand],
    ["catalog-export", catalogExportCommand],
    ["declarative", declarativeCommand],
  ]),
);
```

### Modify: `src/cli/bin/cli.ts`

Replace Stricli entry point with Effect runtime:

```typescript
#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { pgdelta } from "../app.ts";

const cli = Command.run(pgdelta, {
  name: "pgdelta",
  version: "1.0.0-alpha.4", // read from package.json
});

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
```

**Note:** `BunContext.layer` provides all the platform services (`FileSystem`, `Terminal`, etc.) that `@effect/cli` needs. `BunRuntime.runMain` handles the Effect runtime lifecycle and process exit.

### Remove Stricli

After all commands are migrated:

```bash
cd packages/pg-delta
bun remove @stricli/core
```

**Verify:** `rg '@stricli' src/` returns no results.

---

## Exit Code Handling

**Current behavior (from `src/cli/exit-code.ts`):**

- Exit code 0: No changes / success
- Exit code 1: Error
- Exit code 2: Changes detected (plan command)

**@effect/cli approach:** Effect provides `Effect.fail` for error cases. For custom exit codes:

```typescript
import { Effect } from "effect";

// In plan command, after successful plan with changes:
if (result !== null) {
  // Changes detected — exit code 2
  yield * Effect.fail({ _tag: "ExitCode", code: 2 });
}
```

Or use `@effect/cli`'s built-in exit handling. Check the library docs for the recommended pattern.

---

## Files Summary

| Action        | File                                     | Estimated Changes                         |
| ------------- | ---------------------------------------- | ----------------------------------------- |
| **Rewrite**   | `src/cli/commands/plan.ts`               | ~80 lines                                 |
| **Rewrite**   | `src/cli/commands/apply.ts`              | ~60 lines                                 |
| **Rewrite**   | `src/cli/commands/sync.ts`               | ~70 lines                                 |
| **Rewrite**   | `src/cli/commands/declarative-apply.ts`  | ~80 lines                                 |
| **Rewrite**   | `src/cli/commands/declarative-export.ts` | ~60 lines                                 |
| **Rewrite**   | `src/cli/commands/catalog-export.ts`     | ~40 lines                                 |
| **Rewrite**   | `src/cli/app.ts`                         | ~30 lines                                 |
| **Rewrite**   | `src/cli/bin/cli.ts`                     | ~15 lines                                 |
| **Modify**    | `src/cli/exit-code.ts`                   | ~10 lines (adapt to Effect)               |
| **Unchanged** | `src/cli/formatters/`                    | 0 (pure sync)                             |
| **Unchanged** | `src/cli/utils/`                         | 0 (most are pure sync)                    |
| **Modify**    | `package.json`                           | Add `@effect/cli`, remove `@stricli/core` |

## Verification Checklist

- `bun run check-types` passes
- `bun run pgdelta --help` shows all commands
- `bun run pgdelta plan --help` shows plan options
- `bun run pgdelta plan --target postgresql://... --format tree` works
- `bun run pgdelta apply --plan plan.json --source ... --target ...` works
- `bun run pgdelta declarative export --target ... --output ...` works
- `bun run pgdelta declarative apply --path ... --target ...` works
- `bun run pgdelta catalog-export --target ... --output ...` works
- Exit codes match previous behavior (0, 1, 2)
- `rg '@stricli' src/` returns 0 results
- `bun run build` produces working dist/cli/bin/cli.js
- CLI unit tests pass: `bun test src/cli/`

## Important Notes

- **Read each current command file before rewriting.** The Stricli interface details (option types, validation, defaults) must be preserved exactly.
- **@effect/cli API may differ from the examples above.** Check the latest `@effect/cli` docs at the time of implementation. The library is still evolving.
- **Test manually.** CLI commands must be tested by running them against a real PostgreSQL database to verify end-to-end behavior.
- **Backward compatibility of CLI interface:** The flags, options, and output format should remain identical. Only the internal implementation changes.
