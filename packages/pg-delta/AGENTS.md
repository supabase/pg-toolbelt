# AGENTS.md -- Using pg-delta

This file is for AI agents that need to use pg-delta as a tool to manage PostgreSQL schemas. For guidance on _developing_ pg-delta itself, see `CLAUDE.md`.

## What pg-delta does

pg-delta compares PostgreSQL database schemas and generates ordered DDL migration scripts. It supports two paradigms:

- **Imperative (diff-based):** Compare two databases (or catalog snapshots), produce a migration plan, apply it. Commands: `plan`, `apply`, `sync`.
- **Declarative (file-based):** Export a schema as `.sql` files, version-control them, apply them to a database. Commands: `declarative export`, `declarative apply`.
- **Utility:** `catalog-export` snapshots a live database catalog to JSON for offline use.

## Running pg-delta

```bash
# If installed globally or via npx
pgdelta <command> [flags]

# From the pg-delta package directory (development)
bun run pgdelta <command> [flags]
```

## Decision tree: which workflow to use

| Task | Command(s) |
|------|------------|
| Generate a migration between two databases | `plan` then `apply` (or `sync` for one-shot) |
| Bootstrap/version-control a schema as SQL files | `declarative export` |
| Apply SQL schema files to a database | `declarative apply` |
| Snapshot a database for offline diffing | `catalog-export` |

## Workflow A: Declarative schema management

Use this when you need to export a database schema as `.sql` files, edit them, and apply them to another database.

### Step 1 -- Export

```bash
pgdelta declarative export \
  --target <database_url> \
  --output ./declarative-schemas/
```

Add `--integration supabase` for Supabase projects (filters system schemas).
Add `--force` to replace an existing output directory.
Add `--dry-run` to preview without writing files.

The output directory structure:

```
declarative-schemas/
  cluster/
    roles.sql
    extensions/
      pgcrypto.sql
  schemas/
    public/
      tables/
        users.sql
        orders.sql
      functions/
        calculate_total.sql
      views/
        active_users.sql
```

### Step 2 -- Edit

Edit the `.sql` files as needed. Each file contains `CREATE` or `ALTER` statements for that object. Related objects (indexes, triggers, RLS policies) share the file with their parent table.

### Step 3 -- Apply

```bash
pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target <database_url>
```

Add `--verbose` to see per-round progress.
Add `--skip-function-validation` if functions reference objects outside the schema.

#### Interpreting exit codes

| Exit code | Meaning | Action |
|-----------|---------|--------|
| 0 | All statements applied | Done |
| 1 | Hard failure | Read stderr for the error |
| 2 | Stuck (unresolvable dependencies) | Check diagnostics; may need `--skip-function-validation` or manual fixes |

#### Debugging apply failures

```bash
DEBUG=pg-delta:declarative-apply pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target <database_url> \
  --verbose
```

This shows which statements are deferred and why in each round.

## Workflow B: Migration diff generation

Use this when you need to generate a migration script between two database states.

### Step 1 -- Plan

```bash
pgdelta plan \
  --source <source_url_or_snapshot> \
  --target <target_url_or_snapshot> \
  --output migration.sql
```

`--source` and `--target` accept PostgreSQL URLs or catalog snapshot JSON files.
Omit `--source` to diff from an empty baseline (full export).
Use `--format sql` for a migration script, `--format json` for a plan file, or omit for a tree preview.

#### Exit codes

| Exit code | Meaning |
|-----------|---------|
| 0 | No changes detected |
| 2 | Changes detected |
| 1 | Error |

### Step 2 -- Review

If output was a tree (default), review it in stdout. If saved to a file, read the file.

### Step 3 -- Apply

```bash
pgdelta apply \
  --plan plan.json \
  --source <source_url> \
  --target <target_url>
```

Add `--unsafe` if the plan contains data-loss operations (drops, truncates). Without it, pg-delta refuses to apply.

### Offline variant with catalog-export

```bash
# Snapshot the current state
pgdelta catalog-export --target <database_url> --output baseline.json

# Later, generate a migration against the snapshot
pgdelta plan --source baseline.json --target <database_url> --output migration.sql
```

## Quick reference

| Command | Key flags | Description |
|---------|-----------|-------------|
| `catalog-export` | `--target`, `--output`, `--role` | Snapshot DB catalog to JSON |
| `declarative export` | `--target`, `--output`, `--source`, `--integration`, `--force`, `--dry-run` | Export schema as `.sql` files |
| `declarative apply` | `--path`, `--target`, `--verbose`, `--skip-function-validation` | Apply `.sql` files to DB |
| `plan` | `--source`, `--target`, `--output`, `--format`, `--integration` | Compute diff, output plan |
| `apply` | `--plan`, `--source`, `--target`, `--unsafe` | Apply a saved plan file |
| `sync` | `--source`, `--target`, `--yes`, `--unsafe`, `--integration` | Plan + apply in one step |

## Supabase integration

When working with Supabase projects, always use `--integration supabase`. This:

- Filters out system schemas (`pg_catalog`, `information_schema`, `supabase_*`, etc.).
- Customizes SQL serialization for Supabase conventions.
- Provides the correct empty-catalog baseline so `--source` can be omitted for full exports.

```bash
pgdelta declarative export --target $DATABASE_URL --output ./schemas/ --integration supabase
pgdelta plan --target $DATABASE_URL --integration supabase --output migration.sql
```

## Filter and serialize DSL

Fine-grained control over which changes are included and how SQL is generated:

```bash
# Only include changes in the public schema
--filter '{"schema":"public"}'

# Exclude specific schemas
--filter '{"not":{"schema":["pg_catalog","information_schema"]}}'

# Skip AUTHORIZATION on schema creation
--serialize '[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'
```

These flags are available on `plan`, `sync`, and `declarative export`.

## Debugging

| Method | When to use |
|--------|-------------|
| `DEBUG=pg-delta:*` | Full debug output for any command |
| `DEBUG=pg-delta:declarative-apply` | Declarative apply: deferred statements, per-round summaries |
| `--verbose` | Declarative apply: per-round applied/deferred/failed counts |
| `--ungroup-diagnostics` | Declarative apply: full per-diagnostic detail |
