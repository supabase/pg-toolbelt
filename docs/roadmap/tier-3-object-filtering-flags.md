# Tier 3 — Object-filtering flags (`--schema`, `--exclude`)

- **Status**: 🟡 Substrate exists; build the CLI flags as thin Policy consumers.
- **Linear**: CLI-1006 (schema filtering flag), CLI-1169 (regex flag to exclude
  triggers/indexes), CLI-1432 (cross-schema trigger patterns).
- **One line**: expose the policy DSL's filtering vocabulary as ergonomic CLI
  flags that build a `Policy` on the fly.

## What exists (engine substrate)

The policy DSL already has the full filtering vocabulary
(`packages/pg-delta-next/src/policy/policy.ts`):

```ts
type Predicate =
  | { kind: string | string[] }
  | { schema: string | string[] }
  | { name: string | string[] }
  | { verb: "add"|"remove"|"set"|"link"|"unlink" | (...)[] }
  | { ownedByExtension: string }
  | { parentKind: string }
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { owner: string | string[] }
  | { idField: { field: string; glob: string | string[] } }   // glob matching
  | { target: { kind?; schema?; name? } }
  | { edgeTo: { edgeKind?: EdgeKind; kind?; schema? } };

interface FilterRule { match: Predicate; action: "exclude" | "include"; }
interface Policy { id; filter?: FilterRule[]; serialize?: SerializeRule[]; baseline?; extends?; }
```

A `Policy` is passed into the engine via `PlanOptions.policy`
(`plan(source, desired, { policy })`). Filtered deltas are **reported, never
silently dropped**.

So everything the requested flags need already exists as predicates:
- `--schema X` → `{ schema: "X" }` include / its complement exclude.
- `--exclude <glob>` → `{ idField: { field: "name", glob } }` exclude (the
  `idField` predicate already does glob matching — no regex engine needed).
- CLI-1169's real defect (objects auto-created by user `ddl_command_end` event
  triggers reappearing every diff) → an `{ edgeTo: { … } }` or
  `{ parentKind: "eventTrigger" }` exclude. CLI-1432 (cross-schema triggers) is
  already substantively handled by the Supabase policy Rule 3.

## What's missing (the surface to build)

The CLI commands (`plan`, `diff`, `apply` in
`packages/pg-delta-next/src/cli/commands/`) have **no** `--schema` / `--exclude`
flags today. The work is flag parsing + flag→`Policy` translation, merged with
any `--policy <file>`.

## Implementation plan

### 1. A flags→Policy translator (pure, unit-testable)

Add `packages/pg-delta-next/src/cli/filter-flags.ts`:

```ts
export function policyFromFilterFlags(flags: {
  schema?: string[];          // include only these schemas
  excludeSchema?: string[];
  exclude?: string[];         // glob excludes on object name
}): Policy | undefined;
```

Translation:
- `schema: ["app"]` → `filter: [{ match: { not: { schema: "app" } }, action: "exclude" }]`
  (include-list semantics = exclude everything outside it).
- `excludeSchema: ["audit"]` → `{ match: { schema: "audit" }, action: "exclude" }`.
- `exclude: ["*_tmp"]` → `{ match: { idField: { field: "name", glob: "*_tmp" } }, action: "exclude" }`.

### 2. Wire into the commands

In `plan.ts` / `diff.ts` / `apply.ts`, parse the new repeatable flags via
`packages/pg-delta-next/src/cli/flags.ts`, build the ad-hoc policy, and **merge**
it with a `--policy` file via the DSL's existing `extends` composition (so a file
policy + CLI flags compose with cycle detection already handled). Pass the merged
policy as `PlanOptions.policy`.

### 3. Report what was filtered

The engine already returns filtered deltas — surface a one-line summary
(`"N deltas filtered by --schema/--exclude"`) on stderr so the filtering is never
silent (matches the DSL's reported-not-silent contract).

## Tests (RED first)

- **Unit** (`src/cli/filter-flags.test.ts`): each flag combination produces the
  exact `Policy` shape, including include-list `{ not: { schema } }` semantics.
  Author failing first.
- **Integration**: a diff across two schemas with `--schema app` emits only
  `app` deltas; with `--exclude '*_tmp'` the temp-named objects don't appear.
- **Integration**: `--policy file.ts --exclude '*_tmp'` composes (both apply).
- Assert delta/action *shape*, never SQL bytes.

## Effort / risk

- **Effort**: small. Pure translation + flag wiring; no engine change.
- **Risk**: low. Pure consumer over an existing, reported filtering mechanism.

## Cross-links

- Policy DSL: `packages/pg-delta-next/src/policy/policy.ts`.
- The Supabase policy package (`packages/pg-delta-next/src/policy/supabase.ts`)
  is the worked example of these predicates in production.
