---
name: "Effect-TS Phase 0: Foundation Setup"
overview: Install Effect ecosystem packages in both packages, verify tsconfig compatibility, ensure build/typecheck/test still pass.
todos:
  - id: install-pg-topo-deps
    content: Install effect and @effect/platform in pg-topo
    status: pending
  - id: install-pg-delta-deps
    content: Install effect, @effect/platform in pg-delta
    status: pending
  - id: install-dev-deps
    content: Install @effect/platform-bun as devDependency in both packages
    status: pending
  - id: verify-tsconfig-topo
    content: Verify pg-topo tsconfig.json is compatible with Effect
    status: pending
  - id: verify-tsconfig-delta
    content: Verify pg-delta tsconfig.json/tsconfig.build.json are compatible with Effect
    status: pending
  - id: verify-build
    content: Run bun install, bun run build, bun run check-types to verify nothing breaks
    status: pending
isProject: false
---

# Phase 0: Foundation Setup — Detailed Implementation

## Goal

Install Effect ecosystem packages in both `pg-topo` and `pg-delta`. Verify tsconfig compatibility. Confirm existing build, typecheck, and tests pass unchanged.

## Prerequisites

- None (first phase)

## Step 1: Install pg-topo dependencies

**File:** `packages/pg-topo/package.json`

Add to `dependencies`:

```json
"effect": "^3.x.x",
"@effect/platform": "^0.x.x"
```

Add to `devDependencies`:

```json
"@effect/platform-bun": "^0.x.x"
```

**Important:** Use `bun add` to get the latest compatible versions. Do NOT pin manually. Run:

```bash
cd packages/pg-topo
bun add effect @effect/platform
bun add -d @effect/platform-bun
```

`@effect/platform` is needed for the `FileSystem` service (used in `discover.ts` and `from-files.ts` migration).
`@effect/platform-bun` is dev-only because it's the runtime layer used in tests and the backward-compatible wrappers in `index.ts`.

## Step 2: Install pg-delta dependencies

**File:** `packages/pg-delta/package.json`

Add to `dependencies`:

```json
"effect": "^3.x.x",
"@effect/platform": "^0.x.x"
```

Add to `devDependencies`:

```json
"@effect/platform-bun": "^0.x.x"
```

Run:

```bash
cd packages/pg-delta
bun add effect @effect/platform
bun add -d @effect/platform-bun
```

`@effect/platform` is needed for `FileSystem` in `declarative-apply/discover-sql.ts`.
`@effect/platform-bun` is dev-only (tests + CLI entry point).

**Note:** Do NOT install `@effect/sql-pg`. We keep the existing `pg` (node-postgres) library with a custom Effect wrapper (Phase 2b). Switching to `postgres.js` would require rewriting all 28 extractors' SQL queries and custom type parsers.

## Step 3: Verify tsconfig compatibility

### pg-topo: `packages/pg-topo/tsconfig.json`

Current config:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2024"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src"]
}
```

**Check:** `strict: true` is good — Effect requires strict mode.
**Check:** `exactOptionalPropertyTypes` is NOT set (defaults to `false`) — this is correct. Effect requires it to be OFF.
**Action:** No changes needed if `exactOptionalPropertyTypes` is absent or `false`.

### pg-delta: `packages/pg-delta/tsconfig.json`

Current config extends `@tsconfig/node24` and `@tsconfig/node-ts`. Need to verify these don't set `exactOptionalPropertyTypes: true`.

**Action:** Check the extended configs. If either sets `exactOptionalPropertyTypes: true`, override it:

```json
{
  "compilerOptions": {
    "exactOptionalPropertyTypes": false
  }
}
```

### pg-delta: `packages/pg-delta/tsconfig.build.json`

Same check — extends the same bases. Add override if needed.

## Step 4: Verify everything passes

Run these commands in order and confirm zero errors:

```bash
# From root
bun install
bun run build
bun run check-types

# Quick smoke tests (no Docker needed for unit tests)
cd packages/pg-topo && bun test
cd packages/pg-delta && bun test src/
```

All existing tests must pass unchanged. This phase adds zero code changes — only dependency additions and tsconfig verification.

## Files Modified

| File                                    | Change                                                               |
| --------------------------------------- | -------------------------------------------------------------------- |
| `packages/pg-topo/package.json`         | Add `effect`, `@effect/platform` deps; `@effect/platform-bun` devDep |
| `packages/pg-delta/package.json`        | Add `effect`, `@effect/platform` deps; `@effect/platform-bun` devDep |
| `packages/pg-topo/tsconfig.json`        | Possibly add `exactOptionalPropertyTypes: false` (only if needed)    |
| `packages/pg-delta/tsconfig.json`       | Possibly add `exactOptionalPropertyTypes: false` (only if needed)    |
| `packages/pg-delta/tsconfig.build.json` | Possibly add `exactOptionalPropertyTypes: false` (only if needed)    |
| `bun.lockb`                             | Updated by `bun install`                                             |

## Verification Checklist

- `bun install` succeeds
- `bun run build` succeeds for both packages
- `bun run check-types` passes for both packages
- `cd packages/pg-topo && bun test` passes
- `cd packages/pg-delta && bun test src/` passes (unit tests)
- No `exactOptionalPropertyTypes` conflict with Effect
