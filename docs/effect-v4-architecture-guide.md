# Effect v4 Architecture Guide

Drop-in LLM context for building CLI applications and libraries with **Effect v4** (`effect@4.x-beta`). This guide captures every pattern needed to one-shot implement or refactor Effect v4 code without access to a reference codebase.

> **Scope:** Generic enough for any Effect v4 project, concrete enough to produce consistent, high-quality code. All code examples use v4 APIs exclusively.

---

## Table of Contents

1. [V3 to V4 Migration Table](#1-v3--v4-migration-table)
2. [Architectural Invariants & Separation of Concerns](#2-architectural-invariants--separation-of-concerns)
3. [Core Effect v4 Patterns](#3-core-effect-v4-patterns)
4. [CLI Architecture](#4-cli-architecture-effectunstablecli)
5. [Package Export Pattern](#5-package-export-pattern)
6. [File Organization](#6-file-organization)
7. [Testing Patterns](#7-testing-patterns)
8. [Reference Submodule Setup](#8-reference-submodule-setup)
9. [Checklists](#9-checklists)

---

## 1. V3 → V4 Migration Table

Placed first for maximum utility. When writing new code or reviewing existing code, consult this table to avoid v3 patterns.

| v3 (wrong) | v4 (correct) | Notes |
|---|---|---|
| `Context.Tag("T")<Self, Api>()` | `ServiceMap.Service<Self, Api>()("T")` | `Context.Tag` removed entirely |
| `Effect.once(effect)` | Remove; `Layer.effect` already memoizes | Auto-memoization in v4 |
| `Schema.Literal("a", "b", "c")` | `Schema.Literals(["a", "b", "c"])` | Plural form takes array |
| `Schema.Literal("a")` | `Schema.Literal("a")` | Singular still takes one arg |
| `Schema.Union(a, b)` | `Schema.Union([a, b])` | Array argument |
| `Schema.Record({ key, value })` | `Schema.Record(key, value)` | Positional arguments |
| `Schema.mutable(Schema.Struct({...}))` | Just `Schema.Struct({...})` | `mutable` is for Array/Tuple only |
| `Schema.BigIntFromSelf` | `Schema.BigInt` | Renamed |
| `import { Options } from "@effect/cli"` | `import { Flag } from "effect/unstable/cli"` | `@effect/cli` merged into `effect` |
| `Options.text("name")` | `Flag.string("name")` | Renamed |
| `Options.boolean("name")` | `Flag.boolean("name")` | Renamed |
| `Options.choice("name", ...)` | `Flag.choice("name", [...])` | Renamed, array argument |
| `Command.run(cmd, { name, version })` | `cmd.pipe(Command.run({ version }))` | Piped API |
| `Effect.either` | `Effect.result` | Returns `Result` not `Either` |
| `result._tag === "Left"` / `result.left` | `result._tag === "Failure"` / `result.failure` | |
| `result._tag === "Right"` / `result.right` | `result._tag === "Success"` / `result.success` | |
| `Effect.tapErrorCause` | `Effect.tapCause` | Renamed |
| `BunContext.layer` | `BunServices.layer` | Renamed |
| `import { FileSystem } from "@effect/platform"` | `import { FileSystem } from "effect"` | Moved into core |
| `import { Path } from "@effect/platform"` | `import { Path } from "effect"` | Moved into core |
| `GlobalFlag.value(...)` | `GlobalFlag.setting("name")(...)` | Renamed |
| `Command.withHandler(cmd, handler)` | `Command.withHandler(handler)` in pipe | Piped API |

---

## 2. Architectural Invariants & Separation of Concerns

This section describes the **non-negotiable structural rules** that govern how code is organized. These invariants exist to keep the dependency graph unidirectional, make every service independently testable, and ensure handlers are pure business logic with zero knowledge of transport or runtime.

**Every new file must respect all invariants below.** When refactoring existing code, migrate toward these patterns.

### 2.1 Service / Layer Split (the fundamental rule)

A service is **always** split across exactly two files:

| File | Contains | Imports |
|---|---|---|
| `*.service.ts` | Interface shape + `ServiceMap.Service` class | Only `effect` types and sibling types/errors |
| `*.layer.ts` | Live `Layer.effect` or `Layer.succeed` implementation | The `.service.ts` file + any dependencies |

**Invariants:**

1. **Service files are pure interface** — they contain ZERO implementation logic, ZERO side effects, ZERO runtime imports (e.g., no `node:*`, no `@clack/prompts`, no `pg`). They import `effect` for types only (`import type { Effect } from "effect"`).
2. **Layer files are pure implementation** — they produce a `Layer.Layer<MyService>` and contain all the runtime details (filesystem access, network calls, keyring, TTY detection, etc.).
3. **The service file never imports the layer file.** The dependency is always one-way: layer → service.
4. **Handlers import only service files, never layer files.** This is what makes handlers testable — they depend on abstract interfaces, not concrete implementations.
5. **Command files import layer files and the handler.** The command is the only place where concrete layers are wired to abstract services via `Command.provide`.

**Adapter rule:** non-Effect packages and host APIs belong in explicit adapter files only. Pure modules, handlers, formatters, and entrypoints import local adapters or services, never `node:*`, `pg`, `chalk`, `@clack/prompts`, parser libraries, or platform-node modules directly.

**Correct import graph:**

```
command.ts ──imports──→ handler.ts ──imports──→ service.ts  ←──imports── layer.ts
    │                                              ↑                        ↑
    └──imports──→ layer.ts ────imports─────────────┘                        │
                                                                   (runtime deps)
```

**Why this matters:** Any handler can be tested by providing `Layer.succeed(MyService, { ...mock })` — no filesystem, no network, no Docker. The test never touches the `.layer.ts` file.

**Example — Credentials service pair:**

```typescript
// credentials.service.ts — INTERFACE ONLY
import type { Effect, Option, Redacted } from "effect";
import { ServiceMap } from "effect";

interface CredentialsShape {
  readonly getAccessToken: Effect.Effect<Option.Option<Redacted.Redacted<string>>>;
  readonly saveAccessToken: (token: string | Redacted.Redacted<string>) => Effect.Effect<void>;
}

export class Credentials extends ServiceMap.Service<Credentials, CredentialsShape>()(
  "@myapp/cli/auth/Credentials",
) {}
```

```typescript
// credentials.layer.ts — IMPLEMENTATION ONLY
import { Effect, FileSystem, Layer, Option, Path, Redacted } from "effect";
import { CliConfig } from "../config/cli-config.service.ts";
import { Credentials } from "./credentials.service.ts";

export const credentialsLayer = Layer.effect(
  Credentials,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* CliConfig;
    const tokenPath = path.join(config.homeDir, "access-token");
    // ... full keyring + filesystem implementation ...
    return Credentials.of({ getAccessToken: ..., saveAccessToken: ... });
  }),
);
```

**Example — Tty service pair (synchronous):**

```typescript
// tty.service.ts — INTERFACE ONLY (no runtime imports)
import { ServiceMap } from "effect";

interface TtyShape {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
  readonly isCi: boolean;
}

export class Tty extends ServiceMap.Service<Tty, TtyShape>()(
  "@myapp/cli/runtime/Tty",
) {}
```

```typescript
// tty.layer.ts — IMPLEMENTATION ONLY (runtime access here)
import * as clack from "@clack/prompts";
import { Layer } from "effect";
import { Tty } from "./tty.service.ts";

export const ttyLayer = Layer.succeed(Tty, {
  stdinIsTty: Boolean(process.stdin.isTTY),
  stdoutIsTty: Boolean(process.stdout.isTTY),
  stderrIsTty: Boolean(process.stderr.isTTY),
  isCi: clack.isCI(),
});
```

### 2.2 Command / Handler Split

A CLI command is **always** split across exactly two files:

| File | Contains | Imports |
|---|---|---|
| `*.command.ts` | Flags, `Command.make`, `Command.provide` (layer wiring) | handler, layer files, `effect/unstable/cli` |
| `*.handler.ts` | ALL business logic via `Effect.fnUntraced` | service files only (via `yield*`) |

**Invariants:**

1. **Command files contain zero business logic.** They define flags, call the handler function, provide layers, and nothing else. No `if/else`, no data transformation, no string formatting.
2. **Handler files import only service interfaces** (`.service.ts` files), never layer files (`.layer.ts`). They access services exclusively via `yield*`. They are the pure "what to do" — agnostic of "where the services come from."
3. **Handler files import only the *type* from their command file** (`import type { MyFlags } from "./my.command.ts"`). They never import the command's `Command.make` or flag definitions at runtime.
4. **Errors bubble up.** Handlers `Effect.fail(...)` with tagged errors. They do NOT catch errors to display them — that's the job of the error boundary in `main.ts` (or `withJsonErrorHandling`).
5. **All user-facing output goes through the Output service.** Handlers never call `console.log`, `process.stdout.write`, or any other direct I/O.

**Example — the complete stop command:**

```typescript
// stop.command.ts — FLAG DEFINITION + WIRING ONLY
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type * as CliCommand from "effect/unstable/cli/Command";
import { withJsonErrorHandling } from "../../output/json-error-handling.ts";
import { stop } from "./stop.handler.ts";

const flags = {
  noBackup: Flag.boolean("no-backup").pipe(
    Flag.withDescription("Delete local data after stopping."),
    Flag.withDefault(false),
  ),
} as const;

export type StopFlags = CliCommand.Command.Config.Infer<typeof flags>;

export const stopCommand = Command.make("stop", flags).pipe(
  Command.withDescription("Stop the local development stack."),
  Command.withShortDescription("Stop local stack"),
  Command.withHandler((flags) =>
    stop(flags).pipe(Effect.withSpan("command.stop"), withJsonErrorHandling),
  ),
  // No Command.provide here — stop doesn't need command-specific layers
);
```

```typescript
// stop.handler.ts — BUSINESS LOGIC ONLY
import { Effect } from "effect";
import { Output } from "../../output/output.service.ts";          // service interface
import { RuntimeInfo } from "../../runtime/runtime-info.service.ts"; // service interface
import { CliConfig } from "../../config/cli-config.service.ts";     // service interface
import type { StopFlags } from "./stop.command.ts";                 // TYPE-ONLY import

export const stop = Effect.fnUntraced(function* (flags: StopFlags) {
  const output = yield* Output;
  const config = yield* CliConfig;
  const runtimeInfo = yield* RuntimeInfo;

  yield* output.intro("Stop local stack");

  if (flags.noBackup) {
    yield* deleteData(runtimeInfo.cwd, config.homeDir);
    yield* output.success("Stopped and local data deleted");
    yield* output.outro("Stack stopped and data deleted.");
    return;
  }

  yield* stopDaemon(runtimeInfo.cwd, config.homeDir);
  yield* output.success("Stopped");
  yield* output.outro("Stack stopped.");
});
```

**What the handler does NOT do:**
- Import any `.layer.ts` file
- Call `process.exit()` or `process.env`
- Write to `console.log` or `process.stdout`
- Catch and display errors (they bubble to `main.ts`)
- Know which output mode is active (text, json, stream-json)

### 2.3 Output Service as the Sole User-Facing Boundary

The `Output` service is the **only** way any command communicates with the user. This is not a convenience — it's a structural invariant that enables the three output modes (text, json, stream-json) to work transparently.

**Invariants:**

1. **Handlers NEVER call `console.log`, `process.stdout.write`, or import `@clack/prompts`.** They call `output.info(...)`, `output.success(...)`, `output.confirm(...)`, etc.
2. **The Output service file (`output.service.ts`) defines the contract only.** It has no idea whether output goes to a terminal, a JSON payload, or an NDJSON stream.
3. **Three independent layers implement the same contract:**
   - `textOutputLayer` — interactive terminal with `@clack/prompts`, styled text via `node:util styleText`
   - `jsonOutputLayer` — machine-readable JSON to stdout, logs to stderr, prompts return `NonInteractiveError`
   - `streamJsonOutputLayer` — timestamped NDJSON events to stdout, prompts return `NonInteractiveError`
4. **`outputLayerFor(format)` dispatches to the correct layer.** Called once in `root.ts` (via `Layer.unwrap`) or `main.ts`.
5. **Non-interactive modes fail prompts with `NonInteractiveError`.** This forces command authors to always provide flag-based alternatives for any interactive prompt.

**The handler doesn't know or care which mode is active:**

```typescript
// This code works identically in text, json, and stream-json modes
const output = yield* Output;
yield* output.info("Analyzing schema...");
yield* output.success("Migration plan generated", { changes: 42 });
// In text mode: prints styled text. In json mode: emits JSON. In stream-json: emits NDJSON event.
```

### 2.4 Error Flow & Boundary Rules

Errors flow upward through a well-defined chain. Each layer has a specific responsibility:

```
Handler                    → Effect.fail(new MyTaggedError({...}))
  ↓ (error bubbles up)
Command (withJsonErrorHandling) → In json/stream-json mode: catch, normalize, output.fail(), set exit code
  ↓ (in text mode: re-throw)
main.ts (handledProgram)   → Catch any remaining failure, normalizeCause(), output.fail(), process.exit
```

**Invariants:**

1. **Handlers fail with domain-specific tagged errors.** They use `Effect.fail(new MyError({...}))` and DO NOT try to format or display the error.
2. **`withJsonErrorHandling`** is applied in every command handler pipe. It intercepts errors in non-text modes, calls `output.fail(normalizeCliError(error))`, and sets exit code 1. In text mode, it re-throws so `main.ts` handles it.
3. **`main.ts` is the last error boundary.** It catches any unhandled failure, calls `normalizeCause(cause)` to convert it to `{ code, message, detail?, suggestion? }`, calls `output.fail(...)`, and exits with code 1.
4. **All errors use the `detail` + `suggestion` convention.** The `detail` field explains what went wrong. The `suggestion` field tells the user what to do about it.

```typescript
// withJsonErrorHandling — applied in Command.withHandler pipe
export const withJsonErrorHandling = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | void, E, R | Output | ProcessControl> =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const output = yield* Output;
        const processControl = yield* ProcessControl;
        if (output.format === "text") return yield* Effect.fail(error);
        yield* output.fail(normalizeCliError(error));
        yield* processControl.setExitCode(1);
      }),
    ),
  );
```

### 2.5 Layer Provision Strategy

Layers are provided at exactly one of three scopes. Never mix them.

| Scope | Where | Examples |
|---|---|---|
| **Command-specific** | `Command.provide(...)` in `*.command.ts` | `credentialsLayer`, `apiLayer`, `browserLayer`, `stdinLayer` |
| **Shared / root** | `Command.provide(...)` in `root.ts` or layer stack in `main.ts` | `outputLayerFor(format)`, `cliConfigLayer` |
| **Platform / runtime** | `Effect.provide(...)` in `main.ts` | `processControlLayer`, `runtimeInfoLayer`, `ttyLayer`, `BunServices.layer` |

**Invariants:**

1. **Command-specific layers are provided in the command file only.** If only the `login` command needs `credentialsLayer`, it goes in `login.command.ts`, not in `root.ts` or `main.ts`.
2. **Shared layers go in `root.ts` or `main.ts`.** The Output layer is provided at the root level because every command needs it.
3. **Platform layers are provided last in `main.ts`.** `BunServices.layer` (or `NodeServicesLive`) is always the outermost layer.
4. **Layer ordering matters.** Most specific first, most general last. Inside `main.ts`:
   ```typescript
   Effect.provide(formatterLayer),     // most specific
   Effect.provide(appSpecificLayers),
   Effect.provide(cliConfigLayer),
   Effect.provide(runtimeLayer),       // processControl + runtimeInfo + tty
   Effect.provide(BunServices.layer),  // most general (platform)
   ```
5. **Dynamic layers use `Layer.unwrap`.** When the layer depends on a runtime value (e.g., `OutputFormatFlag`), wrap it:
   ```typescript
   Command.provide(
     Layer.unwrap(
       Effect.gen(function* () {
         const format = yield* OutputFormatFlag;
         return outputLayerFor(format);
       }),
     ),
   )
   ```

### 2.6 Import Direction Rules (Summary)

These rules prevent circular dependencies and enforce the separation of concerns:

| From → To | Allowed? | Notes |
|---|---|---|
| `handler.ts` → `service.ts` | **YES** | Handlers depend on abstract interfaces |
| `handler.ts` → `command.ts` | **TYPE ONLY** | `import type { MyFlags }` only |
| `handler.ts` → `layer.ts` | **NEVER** | Handlers must not know about implementations |
| `handler.ts` → `errors.ts` | **YES** | Handlers construct and fail with errors |
| `command.ts` → `handler.ts` | **YES** | Command calls handler in `Command.withHandler` |
| `command.ts` → `layer.ts` | **YES** | Command wires layers via `Command.provide` |
| `command.ts` → `service.ts` | **YES** | May need service type for dynamic `Command.provide` |
| `layer.ts` → `service.ts` | **YES** | Layer implements the service interface |
| `layer.ts` → another `service.ts` | **YES** | Layer may depend on other services |
| `service.ts` → `layer.ts` | **NEVER** | Interface must not know about implementations |
| `service.ts` → `types.ts` / `errors.ts` | **YES** | Interface may reference shared types/errors |
| `main.ts` → `layer.ts` | **YES** | Wires the root layer stack |
| `main.ts` → `service.ts` | **YES** | Needs service tags for the error boundary |
| `test` → `handler.ts` | **YES** | Tests call handlers directly |
| `test` → `service.ts` | **YES** | Tests provide mock layers for services |
| `test` → `layer.ts` | **NEVER** | Tests use mock layers, not live implementations |
| `test` → `command.ts` | **TYPE ONLY** | For the `Flags` type |

---

## 3. Core Effect v4 Patterns

### 3.1 Service Definition (`ServiceMap.Service`)

Every service is defined as a class extending `ServiceMap.Service`. The class doubles as both the tag (for dependency injection) and the type. Service definition files are **pure interface** — see [Section 2.1](#21-service--layer-split-the-fundamental-rule) for the strict separation rules.

**Convention:**
- Interface named `<Name>Shape` or `<Name>Api` (not exported if only used in the same file)
- Tag string: `"@scope/package/ServiceName"` (e.g., `"@myapp/cli/output/Output"`)
- Consumption: `yield* MyService` inside `Effect.gen`
- **Service files contain zero implementation, zero runtime imports** (see [Section 2.1](#21-service--layer-split-the-fundamental-rule))

```typescript
// output.service.ts
import type { Effect } from "effect";
import { ServiceMap } from "effect";

interface OutputShape {
  readonly format: string;
  readonly interactive: boolean;
  readonly info: (message: string) => Effect.Effect<void>;
  readonly warn: (message: string) => Effect.Effect<void>;
  readonly error: (message: string) => Effect.Effect<void>;
  readonly success: (message: string) => Effect.Effect<void>;
  readonly fail: (err: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
    readonly suggestion?: string;
  }) => Effect.Effect<void>;
}

export class Output extends ServiceMap.Service<Output, OutputShape>()(
  "@myapp/cli/output/Output",
) {}
```

**Consuming a service:**

```typescript
import { Effect } from "effect";
import { Output } from "./output.service.ts";

const doSomething = Effect.gen(function* () {
  const output = yield* Output;
  yield* output.info("Starting operation...");
  // ... business logic ...
  yield* output.success("Done!");
});
```

### 3.2 Layer Construction

Layers provide concrete implementations for services. v4 `Layer.effect` auto-memoizes (no `Effect.once` needed). Layer files are **pure implementation** — see [Section 2.1](#21-service--layer-split-the-fundamental-rule).

**Effectful layer** (runs once, result cached):

```typescript
// credentials.layer.ts
import { Effect, FileSystem, Layer, Option, Path, Redacted } from "effect";
import { Credentials } from "./credentials.service.ts";
import { CliConfig } from "../config/cli-config.service.ts";

const makeCredentials = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* CliConfig;
  const tokenPath = path.join(config.homeDir, "access-token");

  return Credentials.of({
    getAccessToken: Effect.gen(function* () {
      const exists = yield* fs.exists(tokenPath);
      if (!exists) return Option.none();
      const content = yield* fs.readFileString(tokenPath);
      return content.trim()
        ? Option.some(Redacted.make(content.trim()))
        : Option.none();
    }).pipe(Effect.orElseSucceed(() => Option.none())),

    saveAccessToken: (token: string | Redacted.Redacted<string>) =>
      Effect.gen(function* () {
        const plain = typeof token === "string" ? token : Redacted.value(token);
        yield* fs.writeFileString(tokenPath, plain, { mode: 0o600 });
      }).pipe(Effect.orDie),
  });
});

export const credentialsLayer = Layer.effect(Credentials, makeCredentials);
```

**Synchronous layer** (constant value, test mocks):

```typescript
import { Effect, Layer } from "effect";
import { Browser } from "./browser.service.ts";

export const browserLayer = Layer.succeed(Browser, {
  open: (url: string) =>
    Effect.tryPromise({ try: () => import("open").then((m) => m.default(url)), catch: () => undefined }),
});
```

**Layer composition:**

```typescript
import { Layer } from "effect";

// Merge independent layers (all provided in parallel)
const runtimeLayer = Layer.mergeAll(processControlLayer, runtimeInfoLayer, ttyLayer);

// Provide dependencies to a layer that needs them
const appLayer = credentialsLayer.pipe(Layer.provide(configLayer));

// Dynamic dispatch based on runtime value
const outputLayer = Layer.unwrap(
  Effect.gen(function* () {
    const format = yield* OutputFormatFlag;
    return outputLayerFor(format);
  }),
);
```

### 3.3 Error Handling

**Tagged errors with `detail` + `suggestion` fields:**

```typescript
// errors.ts
import { Data } from "effect";

// Base error factory for a domain — reuse across related errors
function CliError<Tag extends string>(tag: Tag) {
  return class extends Data.TaggedError(tag)<{
    readonly detail: string;
    readonly suggestion: string;
  }> {
    override get message() {
      return `${this.detail}\n  Suggestion: ${this.suggestion}`;
    }
  };
}

export class InvalidTokenError extends CliError("InvalidTokenError") {}
export class ConnectionError extends CliError("ConnectionError") {}

// One-off error without the factory (when fields differ)
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly statusCode?: number;
  readonly detail: string;
}> {}
```

**Error recovery patterns:**

```typescript
import { Effect } from "effect";

// Catch a specific tagged error
myEffect.pipe(
  Effect.catchTag("InvalidTokenError", (e) =>
    Effect.fail(new LoginFailedError({
      detail: e.detail,
      suggestion: "Check your token and try again",
    })),
  ),
);

// Retry with conditions
verifyCode.pipe(
  Effect.tapError((e) =>
    e._tag === "VerificationError" ? output.error("Verification failed") : Effect.void,
  ),
  Effect.retry({
    times: 2,
    while: (e) => e._tag === "VerificationError",
  }),
  Effect.catchTag("VerificationError", () =>
    Effect.fail(new LoginFailedError({
      detail: "Failed after maximum retries",
      suggestion: "Try again",
    })),
  ),
);
```

**Error normalization at CLI boundary:**

Convert any error to a uniform `{ code, message, detail?, suggestion? }` shape before displaying:

```typescript
// normalize-error.ts
import { Cause, Option } from "effect";

type NormalizedCliError = {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
  readonly suggestion?: string;
};

export function normalizeCliError(error: unknown): NormalizedCliError {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const code = typeof record._tag === "string" ? record._tag : "UnknownError";
    const message =
      typeof record.message === "string" ? record.message :
      typeof record.detail === "string" ? record.detail : code;
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const suggestion = typeof record.suggestion === "string" ? record.suggestion : undefined;
    return {
      code,
      message,
      ...(detail && detail !== message ? { detail } : {}),
      ...(suggestion ? { suggestion } : {}),
    };
  }
  if (error instanceof Error) {
    return { code: error.name || "Error", message: error.message || "Unknown error" };
  }
  return { code: "UnknownError", message: String(error) || "Unknown error" };
}

export function normalizeCause(cause: Cause.Cause<unknown>): NormalizedCliError {
  const errorOption = Cause.findErrorOption(cause);
  return normalizeCliError(Option.getOrElse(errorOption, () => Cause.squash(cause)));
}
```

### 3.4 Schema

Schema is the most error-prone area in v4. Pay close attention to the API differences:

```typescript
import { Schema } from "effect";

// Multiple literal values — use Schema.Literals (plural, array argument)
const Status = Schema.Literals(["active", "inactive", "pending"]);

// Single literal — Schema.Literal (singular, one argument)
const Active = Schema.Literal("active");

// Union — array argument
const MyUnion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("a"), value: Schema.String }),
  Schema.Struct({ type: Schema.Literal("b"), count: Schema.Number }),
]);

// Record — positional arguments (key schema, value schema)
const MyRecord = Schema.Record(Schema.String, Schema.Number);

// mutable — ONLY valid on Array/Tuple, NOT on Struct
const Tags = Schema.mutable(Schema.Array(Schema.String));      // OK
const Props = Schema.Struct({ name: Schema.String });           // OK (readonly by default)
// Schema.mutable(Schema.Struct({ ... }))                      // CRASHES at runtime

// BigInt
const BigVal = Schema.BigInt;  // was BigIntFromSelf in v3
```

### 3.5 `Effect.gen` and `Effect.fnUntraced`

**`Effect.fnUntraced`** — preferred for handlers, helpers, and reusable functions when tracing isn't needed:

```typescript
// Preferred: Effect.fnUntraced
const myHandler = Effect.fnUntraced(function* (input: string) {
  const output = yield* Output;
  yield* output.info(`Processing: ${input}`);
  return input.toUpperCase();
});
```

**`Effect.gen`** — use for inline, one-off effects:

```typescript
// Inline usage inside a layer or command
const result = Effect.gen(function* () {
  const config = yield* CliConfig;
  return config.apiUrl;
});
```

**Rule of thumb:** If a function returns `Effect.gen(function* () { ... })`, refactor it to `Effect.fnUntraced(function* (...args) { ... })`.

---

## 4. CLI Architecture (`effect/unstable/cli`)

The CLI module moved from `@effect/cli` into `effect/unstable/cli`. `Options` was renamed to `Flag`.

### 4.1 Command Definition Pattern

File: `<name>.command.ts` — **wiring only, zero business logic** (see [Section 2.2](#22-command--handler-split)).

```typescript
// plan.command.ts
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import type * as CliCommand from "effect/unstable/cli/Command";
import { withJsonErrorHandling } from "../../output/json-error-handling.ts";
import { databaseLayer } from "../../core/services/database-live.ts";  // layer import OK here
import { plan } from "./plan.handler.ts";                              // handler import

const flags = {
  source: Flag.string("source").pipe(
    Flag.withAlias("s"),
    Flag.withDescription("Source database connection string"),
    Flag.optional,
  ),
  target: Flag.string("target").pipe(
    Flag.withAlias("t"),
    Flag.withDescription("Target database connection string"),
  ),
  format: Flag.choice("format", ["sql", "json"]).pipe(
    Flag.withDescription("Output format"),
    Flag.withDefault("sql"),
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Enable verbose output"),
    Flag.withDefault(false),
  ),
} as const;

// Infer the flags type for the handler
export type PlanFlags = CliCommand.Command.Config.Infer<typeof flags>;

export const planCommand = Command.make("plan", flags).pipe(
  Command.withDescription("Generate a migration plan between two databases"),
  Command.withShortDescription("Generate migration plan"),
  Command.withExamples([
    { command: "mycli plan --target postgres://...", description: "Plan against target" },
  ]),
  // Handler call + tracing + error handling — nothing else
  Command.withHandler((flags) =>
    plan(flags).pipe(Effect.withSpan("command.plan"), withJsonErrorHandling),
  ),
  // Command-specific layers wired here (NOT in handler, NOT in main)
  Command.provide(databaseLayer),
);
```

**Key conventions:**
- `flags` as a `const` object with `as const`
- Type inference via `CliCommand.Command.Config.Infer<typeof flags>`
- Handler piped with `Effect.withSpan` + `withJsonErrorHandling`
- Command-specific layers provided via `Command.provide` (only layers this command needs)
- Optional flags use `Flag.optional` (produces `Option<T>`)
- Boolean flags use `Flag.withDefault(false)`
- **No `if/else`, no data transformation, no string formatting** — that all goes in the handler

### 4.2 Handler Pattern

File: `<name>.handler.ts` — **all business logic, only service interfaces** (see [Section 2.2](#22-command--handler-split)).

```typescript
// plan.handler.ts
import { Effect, Option } from "effect";
import { Output } from "../../output/output.service.ts";       // service interface (NOT layer)
import { DatabaseService } from "../../core/services/database.ts"; // service interface (NOT layer)
import type { PlanFlags } from "./plan.command.ts";              // TYPE-ONLY import

export const plan = Effect.fnUntraced(function* (flags: PlanFlags) {
  const output = yield* Output;          // access via yield* (never import the layer)
  const db = yield* DatabaseService;     // access via yield*

  yield* output.info("Generating migration plan...");

  const source = Option.isSome(flags.source)
    ? yield* db.connect(flags.source.value)
    : null;
  const target = yield* db.connect(flags.target);

  const result = yield* db.diff(source, target);

  if (flags.format === "json") {
    yield* output.write(JSON.stringify(result, null, 2));
  } else {
    yield* output.write(result.sql);
  }

  yield* output.success(`Plan generated: ${result.changes} changes`);
});
```

**Key conventions:**
- Uses `Effect.fnUntraced` (not a function returning `Effect.gen`)
- **Imports only `.service.ts` files** — never `.layer.ts` files
- **Type-only import** from `.command.ts` for the flags type
- Accesses all services via `yield*`
- Contains ALL business logic
- Pure: no `console.log`, no `process.stdout`, no direct I/O
- Errors bubble up via `Effect.fail(...)` — handler does NOT catch-and-display

### 4.3 Root Command and Global Flags

**Root command** (`root.ts`):

```typescript
// root.ts
import { Effect, Layer } from "effect";
import { CliOutput, Command } from "effect/unstable/cli";
import { OutputFormatFlag, UsageFlag } from "./global-flags.ts";
import { planCommand } from "../commands/plan/plan.command.ts";
import { applyCommand } from "../commands/apply/apply.command.ts";
import { outputLayerFor } from "../output/output.layer.ts";

export const root = Command.make("mycli").pipe(
  Command.withSubcommands([planCommand, applyCommand]),
  // Dynamic output layer based on global flag value
  Command.provide(
    Layer.unwrap(
      Effect.gen(function* () {
        const format = yield* OutputFormatFlag;
        return outputLayerFor(format);
      }),
    ),
  ),
  Command.withGlobalFlags([OutputFormatFlag, UsageFlag]),
);
```

**Global flags** (`global-flags.ts`):

```typescript
// global-flags.ts
import { Console, Effect } from "effect";
import { Flag, GlobalFlag } from "effect/unstable/cli";
import type { OutputFormat } from "../output/types.ts";

// Value flag — exposes its value to the Effect context (readable via yield*)
export const OutputFormatFlag = GlobalFlag.setting("output-format")({
  flag: Flag.choice("output-format", ["text", "json", "stream-json"]).pipe(
    Flag.withDescription("Output format: text (default), json, or stream-json (NDJSON)"),
    Flag.withDefault("text" as OutputFormat),
  ),
});

// Action flag — runs a side effect and exits
export const UsageFlag = GlobalFlag.action({
  flag: Flag.boolean("usage").pipe(
    Flag.withDescription("Output CLI spec in usage format and exit"),
    Flag.withDefault(false),
  ),
  run: (_value, { command, version }) =>
    Console.log(JSON.stringify({ command, version })),
});
```

**Two global flag types:**
- `GlobalFlag.setting("name")({ flag })` — value flags, readable from Effect context via `yield* MyFlag`
- `GlobalFlag.action({ flag, run })` — side-effect flags that run and exit

### 4.4 Output Service

The Output service is the **sole user-facing boundary** (see [Section 2.3](#23-output-service-as-the-sole-user-facing-boundary)). It abstracts all user-facing I/O behind three interchangeable layers.

**Types** (`output/types.ts`):

```typescript
export type OutputFormat = "text" | "json" | "stream-json";

export type StreamEvent =
  | { readonly type: "log"; readonly level: "info" | "warn" | "success" | "error"; readonly message: string; readonly timestamp: string }
  | { readonly type: "result"; readonly data: unknown; readonly timestamp: string }
  | { readonly type: "error"; readonly error: { readonly code: string; readonly message: string; readonly detail?: string; readonly suggestion?: string }; readonly timestamp: string }
  | { readonly type: "progress"; readonly status: "start" | "active" | "done"; readonly current: number; readonly max: number; readonly message: string; readonly timestamp: string };
```

**Error** (`output/errors.ts`):

```typescript
import { Data } from "effect";

export class NonInteractiveError extends Data.TaggedError("NonInteractiveError")<{
  readonly detail: string;
  readonly suggestion?: string;
}> {
  override get message() {
    return `${this.detail}${this.suggestion ? `\n  Suggestion: ${this.suggestion}` : ""}`;
  }
}
```

**Service** (`output/output.service.ts`):

```typescript
import type { Effect } from "effect";
import { ServiceMap } from "effect";
import type { NonInteractiveError } from "./errors.ts";
import type { OutputFormat, StreamEvent } from "./types.ts";

interface OutputShape {
  readonly format: OutputFormat;
  readonly interactive: boolean;
  readonly write: (message: string) => Effect.Effect<void>;
  readonly info: (message: string) => Effect.Effect<void>;
  readonly warn: (message: string) => Effect.Effect<void>;
  readonly error: (message: string) => Effect.Effect<void>;
  readonly success: (message: string) => Effect.Effect<void>;
  readonly event: (event: StreamEvent) => Effect.Effect<void>;
  readonly confirm: (message: string) => Effect.Effect<boolean, NonInteractiveError>;
  readonly fail: (err: {
    readonly code: string;
    readonly message: string;
    readonly detail?: string;
    readonly suggestion?: string;
  }) => Effect.Effect<void>;
}

export class Output extends ServiceMap.Service<Output, OutputShape>()(
  "@myapp/cli/output/Output",
) {}
```

**Layer dispatcher** (`output/output.layer.ts`):

```typescript
import type { Layer } from "effect";
import type { OutputFormat } from "./types.ts";
import { Output } from "./output.service.ts";

// Three concrete implementations:
// - textOutputLayer: interactive terminal (clack prompts, styled text)
// - jsonOutputLayer: single JSON payload to stdout, logs to stderr
// - streamJsonOutputLayer: NDJSON events to stdout

export function outputLayerFor(format: OutputFormat): Layer.Layer<Output, never, /* deps */> {
  switch (format) {
    case "text": return textOutputLayer;
    case "json": return jsonOutputLayer;
    case "stream-json": return streamJsonOutputLayer;
  }
}
```

**Key conventions:**
- `text` mode: interactive prompts via `@clack/prompts`, styled output
- `json` mode: single machine-readable payload, prompts return `NonInteractiveError`
- `stream-json` mode: NDJSON events with timestamps, prompts return `NonInteractiveError`
- All non-interactive modes write logs to stderr, structured output to stdout

### 4.5 Main Entry Point

The main entry point wires up the full layer stack and handles top-level errors.

```typescript
#!/usr/bin/env bun
// main.ts
import { BunServices } from "@effect/platform-bun";
import { Cause, Effect, Exit, Fiber, Layer, Stdio } from "effect";
import { Command } from "effect/unstable/cli";
import { root } from "./root.ts";
import { outputLayerFor } from "../output/output.layer.ts";
import { normalizeCause } from "../output/normalize-error.ts";
import type { OutputFormat } from "../output/types.ts";
import { Output } from "../output/output.service.ts";
import { processControlLayer } from "../runtime/process-control.layer.ts";
import { runtimeInfoLayer } from "../runtime/runtime-info.layer.ts";
import { ttyLayer } from "../runtime/tty.layer.ts";
import { ProcessControl } from "../runtime/process-control.service.ts";

// 1. Early format detection (before Effect runs)
function outputFormatFor(args: ReadonlyArray<string>): OutputFormat {
  const inline = args.find((arg) => arg.startsWith("--output-format="));
  if (inline) {
    const value = inline.slice("--output-format=".length);
    if (value === "json" || value === "stream-json" || value === "text") return value;
  }
  const idx = args.indexOf("--output-format");
  const format = idx !== -1 ? args[idx + 1] : undefined;
  return format === "json" || format === "stream-json" ? format : "text";
}

// 2. Program construction with layer stack
function cliProgramFor(args: ReadonlyArray<string>) {
  const runtimeLayer = Layer.mergeAll(processControlLayer, runtimeInfoLayer, ttyLayer);
  return Command.runWith(root, { version: "1.0.0" })(args).pipe(
    Effect.provide(runtimeLayer),
    Effect.provide(BunServices.layer),
  );
}

// 3. Read args
const args = await Effect.runPromise(
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return yield* stdio.args;
  }).pipe(Effect.provide(BunServices.layer)),
);

const cliProgram = cliProgramFor(args);

// 4. Signal handling (fork + race)
const signalAwareProgram = Effect.scoped(
  Effect.gen(function* () {
    const processControl = yield* ProcessControl;
    const cliFiber = yield* cliProgram.pipe(Effect.forkScoped);
    const outcome = yield* Effect.raceFirst(
      Fiber.await(cliFiber).pipe(
        Effect.map((exit) => ({ _tag: "cli" as const, exit })),
      ),
      processControl.awaitSignal().pipe(
        Effect.map((signal) => ({ _tag: "signal" as const, signal })),
      ),
    );
    if (outcome._tag === "signal") {
      yield* Fiber.interrupt(cliFiber);
      return yield* Effect.interrupt;
    }
    return yield* outcome.exit;
  }),
).pipe(
  Effect.provide(processControlLayer),
  Effect.provide(BunServices.layer),
);

// 5. Top-level error boundary
const handledProgram = (program: Effect.Effect<unknown, unknown, never>) =>
  Effect.gen(function* () {
    const processControl = yield* ProcessControl;
    const output = yield* Output;
    const exit = yield* program.pipe(Effect.exit);
    if (Exit.isFailure(exit)) {
      const interrupted = Cause.hasInterruptsOnly(exit.cause);
      if (!interrupted) {
        yield* output.fail(normalizeCause(exit.cause));
      }
      return yield* processControl.exit(interrupted ? 130 : 1);
    }
    return yield* processControl.exit(0);
  }).pipe(
    Effect.provide(outputLayerFor(outputFormatFor(args))),
    Effect.provide(processControlLayer),
    Effect.provide(BunServices.layer),
  );

await Effect.runPromise(handledProgram(signalAwareProgram));
```

**Key conventions:**
- Format detected from raw `args` *before* Effect runs (so the output layer is correct from the start)
- Layer ordering: most specific first, `BunServices.layer` last
- Signal handling: fork CLI fiber + race against `awaitSignal`
- Exit codes: 0 = success, 1 = error, 130 = interrupted (SIGINT)

### 4.6 Runtime Services

Thin service boundaries around process-level operations. Each service gets a `.service.ts` (interface + tag) and a `.layer.ts` (live implementation).

**ProcessControl** — exit, signal handling, exit code:

```typescript
// process-control.service.ts
import type { Effect } from "effect";
import { ServiceMap } from "effect";

export type CliProcessSignal = "SIGINT" | "SIGTERM";

interface ProcessControlShape {
  readonly awaitSignal: (signals?: ReadonlyArray<CliProcessSignal>) => Effect.Effect<CliProcessSignal>;
  readonly awaitShutdown: Effect.Effect<void>;
  readonly exit: (code: number) => Effect.Effect<never>;
  readonly setExitCode: (code: number) => Effect.Effect<void>;
}

export class ProcessControl extends ServiceMap.Service<ProcessControl, ProcessControlShape>()(
  "@myapp/cli/runtime/ProcessControl",
) {}
```

**Tty** — TTY detection:

```typescript
// tty.service.ts
import { ServiceMap } from "effect";

interface TtyShape {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly stderrIsTty: boolean;
  readonly isCi: boolean;
}

export class Tty extends ServiceMap.Service<Tty, TtyShape>()(
  "@myapp/cli/runtime/Tty",
) {}
```

**RuntimeInfo** — cwd, platform, home dir:

```typescript
// runtime-info.service.ts
import { ServiceMap } from "effect";

interface RuntimeInfoShape {
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly homeDir: string;
  readonly execPath: string;
  readonly pid: number;
}

export class RuntimeInfo extends ServiceMap.Service<RuntimeInfo, RuntimeInfoShape>()(
  "@myapp/cli/runtime/RuntimeInfo",
) {}
```

**Stdin** — piped input reading:

```typescript
// stdin.service.ts
import type { Effect, Option } from "effect";
import { ServiceMap } from "effect";

interface StdinShape {
  readonly isTTY: boolean;
  readonly readPipedText: Effect.Effect<Option.Option<string>>;
}

export class Stdin extends ServiceMap.Service<Stdin, StdinShape>()(
  "@myapp/cli/runtime/Stdin",
) {}
```

**Browser** — URL opening:

```typescript
// browser.service.ts
import type { Effect } from "effect";
import { ServiceMap } from "effect";

interface BrowserShape {
  readonly open: (url: string) => Effect.Effect<void>;
}

export class Browser extends ServiceMap.Service<Browser, BrowserShape>()(
  "@myapp/cli/runtime/Browser",
) {}
```

---

## 5. Package Export Pattern

### 5.1 Three-tier exports

Every library package exposes three entry points:

```
src/effect.ts  → Canonical Effect-native API (source of truth)
src/node.ts    → Promise facade via ManagedRuntime (for Node consumers)
src/bun.ts     → Re-exports from node.ts (Bun and Node share the same facade)
src/index.ts   → Re-exports for backward compatibility
```

**`effect.ts`** — the canonical API:

```typescript
// src/effect.ts
export { MyService } from "./core/services/my-service.ts";
export { myFunction } from "./core/my-function.ts";
export type { MyType } from "./core/types.ts";
// ... all Effect-native exports
```

**`node.ts`** — Promise facade:

```typescript
// src/node.ts
import { Layer, ManagedRuntime } from "effect";
import {
  myFunction as myFunctionEffect,
  MyService,
} from "./effect.ts";

// Long-lived runtime for repeated calls (avoids repeated layer construction)
const runtime = ManagedRuntime.make(Layer.empty);

// Re-export everything from effect.ts
export * from "./effect.ts";

// Promise wrappers for the most common operations
export const myFunction = (input: string) =>
  runtime.runPromise(myFunctionEffect(input));
```

**`bun.ts`** — thin re-export:

```typescript
// src/bun.ts
export * from "./node.ts";
```

### 5.2 `package.json` exports field

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./effect": "./src/effect.ts",
    "./bun": {
      "bun": "./src/bun.ts",
      "default": "./src/bun.ts"
    },
    "./node": "./src/node.ts"
  }
}
```

The `bun` condition serves TypeScript source directly; `default` serves compiled JS.

---

## 6. File Organization

### 6.1 Directory layout

```
src/
  cli/
    main.ts                          # Entry point (layer stack, error boundary)
    root.ts                          # Root command + subcommands + global flags
    global-flags.ts                  # GlobalFlag definitions
    commands/
      <name>/
        <name>.command.ts            # Command definition (flags, handler wiring)
        <name>.handler.ts            # Handler (business logic)
        <name>.errors.ts             # Command-specific error types
        <name>.integration.test.ts   # Integration tests
    output/
      output.service.ts              # Output service interface
      output.layer.ts                # text/json/stream-json layer implementations
      types.ts                       # OutputFormat, StreamEvent types
      errors.ts                      # NonInteractiveError
      normalize-error.ts             # Error normalization for CLI boundary
    runtime/
      process-control.service.ts     # ProcessControl interface
      process-control.layer.ts       # Live implementation
      tty.service.ts                 # Tty interface
      tty.layer.ts                   # Live implementation
      runtime-info.service.ts        # RuntimeInfo interface
      runtime-info.layer.ts          # Live implementation
      stdin.service.ts               # Stdin interface
      stdin.layer.ts                 # Live implementation
      browser.service.ts             # Browser interface
      browser.layer.ts               # Live implementation
  core/
    services/
      <name>.ts                      # Service interface (ServiceMap.Service)
      <name>-live.ts                 # Live layer implementation
    <domain modules>/                # Business logic organized by domain
  effect.ts                          # Canonical Effect-native API
  node.ts                            # Promise facade via ManagedRuntime
  bun.ts                             # Re-exports from node.ts
  index.ts                           # Backward-compat re-exports
```

### 6.2 File naming conventions

| Pattern | Purpose |
|---|---|
| `*.service.ts` | Service class + interface (ServiceMap.Service) |
| `*.layer.ts` | Live layer implementation |
| `*.command.ts` | CLI command definition (flags, handler wiring, layers) |
| `*.handler.ts` | Command handler (business logic, Effect.fnUntraced) |
| `*.errors.ts` | Error types (Data.TaggedError) |
| `*.test.ts` | Unit tests (colocated with source) |
| `*.integration.test.ts` | Integration tests (colocated or in tests/) |
| `*.e2e.test.ts` | E2E subprocess tests |
| `types.ts` | Shared type definitions for a module |

---

## 7. Testing Patterns

### 7.1 Testing pyramid

1. **Unit tests** — pure functions, no Effect context needed. Standard `describe`/`test`/`expect`.
2. **Integration tests** — handler logic with mocked services. Uses `@effect/vitest` + `it.live`. Compose mock layers, assert on accumulated state.
3. **E2E tests** — subprocess-based, golden path only. Spawn the real CLI binary and assert on stdout/stderr/exit code.

### 7.2 Mock factory pattern

Mock factories return `{ layer, state }` where `state` is exposed via getters. No `vi.fn()` spies — assert on accumulated state after the effect runs.

```typescript
// tests/helpers/mocks.ts
import { Effect, Layer, Option, Redacted } from "effect";
import { Output } from "../../src/output/output.service.ts";
import { Credentials } from "../../src/auth/credentials.service.ts";
import { Browser } from "../../src/runtime/browser.service.ts";
import { Stdin } from "../../src/runtime/stdin.service.ts";
import { Tty } from "../../src/runtime/tty.service.ts";

// --- Message accumulator type ---
type OutputMessage = {
  type: "intro" | "outro" | "info" | "warn" | "error" | "success" | "fail";
  message: string;
  data?: Record<string, unknown>;
};

// --- Stateless mocks ---

export function mockBrowser(): Layer.Layer<Browser> {
  return Layer.succeed(Browser, {
    open: () => Effect.void,
  });
}

export function mockStdin(isTTY: boolean, pipedToken?: string): Layer.Layer<Stdin> {
  return Layer.succeed(Stdin, {
    isTTY,
    readPipedText: Effect.succeed(
      pipedToken ? Option.some(pipedToken) : Option.none(),
    ),
  });
}

export function mockTty(opts: { stdinIsTty?: boolean; stdoutIsTty?: boolean } = {}): Layer.Layer<Tty> {
  return Layer.succeed(Tty, {
    stdinIsTty: opts.stdinIsTty ?? false,
    stdoutIsTty: opts.stdoutIsTty ?? false,
    stderrIsTty: false,
    isCi: false,
  });
}

// --- Stateful mocks ---

export function mockCredentials(opts: { existingToken?: string } = {}) {
  let savedToken: string | undefined;
  return {
    layer: Layer.succeed(Credentials, {
      getAccessToken: Effect.sync(() => {
        const token = opts.existingToken ?? savedToken;
        return token ? Option.some(Redacted.make(token)) : Option.none();
      }),
      saveAccessToken: (token: string | Redacted.Redacted<string>) =>
        Effect.sync(() => {
          savedToken = typeof token === "string" ? token : Redacted.value(token);
        }),
    }),
    get savedToken() {
      return savedToken;
    },
  };
}

export function mockOutput(opts: { format?: string; interactive?: boolean } = {}) {
  const messages: OutputMessage[] = [];
  return {
    layer: Layer.succeed(Output, {
      format: opts.format ?? "text",
      interactive: opts.interactive ?? true,
      write: (message: string) => Effect.sync(() => { messages.push({ type: "info", message }); }),
      info: (message: string) => Effect.sync(() => { messages.push({ type: "info", message }); }),
      warn: (message: string) => Effect.sync(() => { messages.push({ type: "warn", message }); }),
      error: (message: string) => Effect.sync(() => { messages.push({ type: "error", message }); }),
      success: (message: string, data?: Record<string, unknown>) =>
        Effect.sync(() => { messages.push({ type: "success", message, data }); }),
      event: () => Effect.void,
      confirm: () => Effect.succeed(true),
      fail: (err) => Effect.sync(() => { messages.push({ type: "fail", message: err.message }); }),
    }),
    messages,
  };
}
```

### 7.3 Integration test structure

```typescript
// login.integration.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import type { LoginFlags } from "./login.command.ts";
import { login } from "./login.handler.ts";
import {
  mockBrowser, mockCredentials, mockOutput, mockStdin, mockTty,
} from "../../../tests/helpers/mocks.ts";

const VALID_TOKEN = "sbp_" + "a".repeat(40);
const NO_FLAGS: LoginFlags = { token: Option.none(), name: Option.none(), noBrowser: false };

// Setup helper — composes mock layers and returns state handles
function setupTty(opts: { existingToken?: string } = {}) {
  const creds = mockCredentials({ existingToken: opts.existingToken });
  const out = mockOutput();
  const layer = Layer.mergeAll(
    creds.layer,
    out.layer,
    mockBrowser(),
    mockStdin(true),
    mockTty({ stdinIsTty: true, stdoutIsTty: true }),
  );
  return { layer, creds, out };
}

// Helper for asserting failure tags
function expectFailureTag(exit: Exit.Exit<unknown, unknown>, tag: string) {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.findErrorOption(exit.cause);
    expect(Option.isSome(failure)).toBe(true);
    if (Option.isSome(failure)) {
      expect((failure.value as { _tag: string })._tag).toBe(tag);
    }
  }
}

describe("login", () => {
  // Success case — assert on accumulated state
  it.live("saves token on login", () => {
    const { layer, creds, out } = setupTty();
    return Effect.gen(function* () {
      yield* login({ ...NO_FLAGS, token: Option.some(VALID_TOKEN) });
      expect(creds.savedToken).toBe(VALID_TOKEN);
      expect(out.messages).toContainEqual(
        expect.objectContaining({ type: "success", message: "Logged in successfully." }),
      );
    }).pipe(Effect.provide(layer));
  });

  // Failure case — assert on exit
  it.live("fails with InvalidTokenError for bad token", () => {
    const { layer } = setupTty();
    return Effect.gen(function* () {
      const exit = yield* login({
        ...NO_FLAGS,
        token: Option.some("bad_token"),
      }).pipe(Effect.exit);
      expectFailureTag(exit, "InvalidTokenError");
    }).pipe(Effect.provide(layer));
  });
});
```

**Key conventions:**
- `setup*()` functions compose mock layers + return state handles
- `it.live("description", () => { ... }.pipe(Effect.provide(layer)))` — always provide the layer
- Assert on `creds.savedToken`, `out.messages`, etc. (accumulated state)
- Use `Effect.exit` + `expectFailureTag` for failure assertions
- No `vi.fn()` spies — the mock factories accumulate state internally

---

## 8. Reference Submodule Setup

The `.repos/dx-lab/` directory is a git submodule containing the reference implementation (the new Supabase CLI built with Effect v4). It's optional — this guide is self-contained.

### Setup

```bash
# Initial fetch (one-time)
bun run repos:install

# Pull latest
bun run repos:pull
```

### What's inside

```
.repos/dx-lab/
  apps/cli/          # CLI application (commands, output, runtime services)
  packages/api/      # Typed API client
  packages/stack/    # Programmatic local stack runtime
  packages/config/   # Configuration schema
```

### Key reference files

| Pattern | File |
|---|---|
| Service definition | `apps/cli/src/output/output.service.ts` |
| Layer with deps | `apps/cli/src/auth/credentials.layer.ts` |
| Command definition | `apps/cli/src/commands/login/login.command.ts` |
| Handler pattern | `apps/cli/src/commands/login/login.handler.ts` |
| Error types | `apps/cli/src/auth/errors.ts` |
| Error normalization | `apps/cli/src/output/normalize-error.ts` |
| Main entry point | `apps/cli/src/cli/main.ts` |
| Root command | `apps/cli/src/cli/root.ts` |
| Global flags | `apps/cli/src/cli/global-flags.ts` |
| Integration tests | `apps/cli/src/commands/login/login.integration.test.ts` |
| Mock factories | `apps/cli/tests/helpers/mocks.ts` |
| Package exports | `packages/stack/package.json` |

---

## 9. Checklists

### 9.1 New Command Checklist

1. **Create handler** `src/cli/commands/<name>/<name>.handler.ts`
   - `export const myCmd = Effect.fnUntraced(function* (flags: MyCmdFlags) { ... })`
   - Access services via `yield*`
   - Contain ALL business logic

2. **Create command** `src/cli/commands/<name>/<name>.command.ts`
   - Define `flags` object with `as const`
   - Export `type MyCmdFlags = CliCommand.Command.Config.Infer<typeof flags>`
   - `Command.make("name", flags).pipe(...)`
   - `Command.withHandler((flags) => myCmd(flags).pipe(Effect.withSpan("command.name")))`
   - `Command.provide(...)` for command-specific layers

3. **Create errors** (if needed) `src/cli/commands/<name>/<name>.errors.ts`
   - Extend `Data.TaggedError` with `detail` + `suggestion`

4. **Register in root** `src/cli/root.ts`
   - Add to `Command.withSubcommands([...])` array

5. **Write integration tests** `src/cli/commands/<name>/<name>.integration.test.ts`
   - `setup*()` helper composing mock layers
   - `it.live(...)` with `Effect.provide(layer)`
   - Assert on accumulated mock state

6. **Run checks**
   - `bun run test` (or targeted test file)
   - `bun run check-types`

### 9.2 New Service Checklist

1. **Define service** `src/<location>/<name>.service.ts`
   - Interface `<Name>Shape` with all methods
   - `export class MyService extends ServiceMap.Service<MyService, MyShape>()("@scope/pkg/MyService") {}`

2. **Implement layer** `src/<location>/<name>.layer.ts` (or `<name>-live.ts`)
   - `Layer.effect(MyService, Effect.gen(function* () { ... }))` for effectful
   - `Layer.succeed(MyService, { ... })` for synchronous

3. **Provide layer** in the appropriate scope:
   - Command-level: `Command.provide(myLayer)` in the `.command.ts`
   - Root-level: in `root.ts` or `main.ts`
   - Test: `Layer.succeed(MyService, { ... })` in mock factory

4. **Consume** `const svc = yield* MyService` inside `Effect.gen` / `Effect.fnUntraced`

5. **Write mock factory** in `tests/helpers/mocks.ts`
   - Return `{ layer, ...stateGetters }`
   - No `vi.fn()` — accumulate state and expose via getters

6. **Export** (if part of public API)
   - Add to `src/effect.ts`
   - Add Promise wrapper to `src/node.ts` if needed
