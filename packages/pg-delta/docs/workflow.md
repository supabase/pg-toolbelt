# Workflow Guide

`pg-delta` supports two paradigms for managing PostgreSQL schemas: **imperative diff-based migrations** and **declarative file-based schemas**. A utility command, `catalog-export`, bridges both by snapshotting a live database for offline use.

## Overview

```mermaid
flowchart LR
  subgraph imperative ["Imperative: diff-based migrations"]
    plan[plan] --> review[Review]
    review --> applyCmd[apply]
  end

  subgraph declarativeFlow ["Declarative: file-based schema"]
    declExport["declarative export"] --> sqlFiles[".sql files"]
    sqlFiles --> edit["Edit / version-control"]
    edit --> declApply["declarative apply"]
  end

  catExport["catalog-export"] -->|"snapshot JSON"| plan
  catExport -->|"snapshot JSON"| declExport
```

| Paradigm | Commands | Best for |
|----------|----------|----------|
| Imperative | `plan`, `apply`, `sync` | Generating migrations between two database states |
| Declarative | `declarative export`, `declarative apply` | Version-controlling a schema as `.sql` files |
| Utility | `catalog-export` | Snapshotting a database for offline diffing |

---

## 1. `catalog-export`

Snapshot a live PostgreSQL database's catalog to a JSON file. The snapshot can later replace a live connection URL in `plan`, `declarative export`, or any command that accepts `--source` / `--target`.

### When to use

- Create an empty-database baseline for full exports.
- Snapshot production to generate revert migrations offline.
- Enable offline or CI-friendly diffs without a live database connection.

### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--target` | `-t` | Yes | Database connection URL to extract the catalog from |
| `--output` | `-o` | Yes | Output file path for the JSON snapshot |
| `--role` | | No | Role to assume via `SET ROLE` during extraction |

### Examples

Snapshot a production database:

```bash
pgdelta catalog-export \
  --target postgresql://user:pass@prod:5432/mydb \
  --output prod-snapshot.json
```

Use the snapshot as `--source` for a plan (offline diff):

```bash
pgdelta plan \
  --source prod-snapshot.json \
  --target postgresql://user:pass@staging:5432/mydb \
  --output migration.sql
```

---

## 2. `declarative export`

Export the desired schema state from a database as a directory of `.sql` files, organized by object type. The output represents the *desired state* -- only `CREATE` and `ALTER` statements are emitted, never `DROP`.

### When to use

- Bootstrap a declarative schema from an existing database.
- Version-control your schema as human-readable SQL files.
- Generate an incremental re-export to see what changed.

### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--target` | `-t` | Yes | Target database URL or catalog snapshot (desired state) |
| `--output` | `-o` | Yes | Output directory for `.sql` files |
| `--source` | `-s` | No | Source database URL or catalog snapshot (current state). Omit for full export |
| `--integration` | | No | Integration name (e.g. `supabase`) or path to JSON file |
| `--filter` | | No | Filter DSL as inline JSON |
| `--serialize` | | No | Serialize DSL as inline JSON array |
| `--grouping-mode` | | No | `single-file` or `subdirectory` for grouped entities |
| `--group-patterns` | | No | JSON array of `{pattern, name}` for name-based grouping |
| `--flat-schemas` | | No | Comma-separated schemas to flatten (one file per category) |
| `--format-options` | | No | SQL format options as inline JSON |
| `--force` | | No | Remove output directory before writing |
| `--dry-run` | | No | Show file tree and summary without writing |
| `--diff-focus` | | No | Show only changed files in the tree |
| `--verbose` | | No | Show detailed output |

### Output structure

```
schemas/
  public/
    tables/
      users.sql
      orders.sql
    functions/
      calculate_total.sql
    views/
      active_users.sql
    types/
      status_enum.sql
    sequences/
      users_id_seq.sql
cluster/
  roles.sql
  extensions/
    pgcrypto.sql
```

Files are organized by:
- **Cluster-level objects** (roles, extensions) go under `cluster/`.
- **Schema-level objects** go under `schemas/<schema>/<category>/<object>.sql`.
- Related objects (indexes, triggers, RLS policies) are placed in the same file as their parent table or view.
- Partitions are placed in the same file as their root partition table.

### Examples

Full export from a live database:

```bash
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/
```

Export with the Supabase integration (filters system schemas):

```bash
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --integration supabase
```

Dry-run to preview what would be exported:

```bash
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --dry-run
```

Incremental re-export showing only changed files:

```bash
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --diff-focus
```

Export with SQL formatting options:

```bash
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --format-options '{"keywordCase":"lower","maxWidth":120}'
```

After exporting, the CLI prints a tip with the command to apply the schema:

```
Tip: To apply this schema to an empty database, run:
  pgdelta declarative apply --path ./declarative-schemas/ --target <database_url>
```

---

## 3. `declarative apply`

Apply a declarative SQL schema (a directory or single file of `.sql` files) to a target database. Uses `pg-topo` for static dependency analysis and topological ordering, then applies statements in rounds to handle dependency gaps.

### When to use

- Apply a version-controlled schema to a fresh or empty database.
- Restore a database schema from exported SQL files.
- CI/CD schema provisioning.

### How it works

1. **Discover** -- Recursively loads all `.sql` files from the given path.
2. **Analyze** -- `pg-topo` parses the SQL, extracts object dependencies, and produces a topological execution order.
3. **Round-based execution** -- Statements are applied round by round:
   - **Success** -- Statement applied, moves on.
   - **Dependency error** (e.g. missing table, function) -- Deferred to the next round.
   - **Environment error** (e.g. extension not available, superuser required) -- Skipped permanently.
   - **Other error** -- Hard failure.
4. **Stuck detection** -- If a round applies zero statements while deferred ones remain, execution stops.
5. **Function validation** -- An optional final pass re-runs all `CREATE FUNCTION`/`CREATE PROCEDURE` statements with `check_function_bodies = on` to validate function bodies against the now-complete schema.

### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--path` | `-p` | Yes | Path to the schema directory or a single `.sql` file |
| `--target` | `-t` | Yes | Target database connection URL |
| `--max-rounds` | | No | Maximum application rounds before giving up (default: 100) |
| `--no-validate-functions` | | No | Skip final function body validation pass |
| `--verbose` | `-v` | No | Show per-round progress (applied/deferred/failed) |
| `--ungroup-diagnostics` | | No | Show full per-diagnostic detail instead of grouped summary |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All statements applied (and validation passed if enabled) |
| 1 | Hard failure or validation error |
| 2 | Stuck -- dependency cycle or unresolvable ordering |

### Examples

Apply an exported schema to a fresh database:

```bash
pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db
```

With verbose per-round progress:

```bash
pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --verbose
```

Skip function body validation (useful when functions reference external objects):

```bash
pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --no-validate-functions
```

Debug logging for detailed defer/skip/fail information:

```bash
DEBUG=pg-delta:declarative-apply pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db
```

---

## 4. `plan`, `apply`, and `sync`

The imperative workflow compares two database states (source and target), computes a diff, and generates an ordered migration script.

### `plan`

Compute the schema diff and output it for review. Does not apply any changes.

Both `--source` and `--target` accept either a PostgreSQL connection URL or a catalog snapshot file path (from `catalog-export`). When `--source` is omitted, diffing starts from an empty baseline (or the integration's empty catalog if `--integration` is set).

#### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--target` | `-t` | Yes | Target (desired state): Postgres URL or catalog snapshot |
| `--source` | `-s` | No | Source (current state): Postgres URL or catalog snapshot. Omit for empty baseline |
| `--output` | `-o` | No | Write to file. `.sql` infers SQL format, `.json` infers JSON, otherwise tree |
| `--format` | | No | Override output format: `json` or `sql` |
| `--role` | | No | Role for migration (`SET ROLE` added to statements) |
| `--filter` | | No | Filter DSL as inline JSON |
| `--serialize` | | No | Serialize DSL as inline JSON array |
| `--integration` | | No | Integration name or path |
| `--sql-format` | | No | Format SQL output |
| `--sql-format-options` | | No | SQL format options as inline JSON |

#### Exit codes

| Code | Meaning |
|------|---------|
| 0 | No changes detected |
| 2 | Changes detected (plan generated) |
| 1 | Error |

#### Examples

Preview changes as a tree:

```bash
pgdelta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

Save plan as JSON (for later `apply`):

```bash
pgdelta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --output plan.json
```

Generate a formatted SQL migration script:

```bash
pgdelta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --format sql \
  --sql-format \
  --sql-format-options '{"keywordCase":"upper","maxWidth":100}' \
  --output migration.sql
```

Offline diff using a catalog snapshot:

```bash
pgdelta plan \
  --source prod-snapshot.json \
  --target postgresql://user:pass@localhost:5432/staging_db \
  --output migration.sql
```

### `apply`

Apply a previously saved plan file to a target database. Safe by default -- refuses plans containing data-loss operations unless `--unsafe` is set.

#### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--plan` | `-p` | Yes | Path to plan file (JSON) |
| `--source` | `-s` | Yes | Source database connection URL |
| `--target` | `-t` | Yes | Target database connection URL |
| `--unsafe` | `-u` | No | Allow data-loss operations |

#### Example

```bash
pgdelta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

### `sync`

Plan and apply in one step with an interactive confirmation prompt. This is the default command.

#### Flags

| Flag | Alias | Required | Description |
|------|-------|----------|-------------|
| `--source` | `-s` | Yes | Source database URL |
| `--target` | `-t` | Yes | Target database URL |
| `--yes` | `-y` | No | Skip confirmation prompt |
| `--unsafe` | `-u` | No | Allow data-loss operations |
| `--role` | | No | Role for migration |
| `--filter` | | No | Filter DSL as inline JSON |
| `--serialize` | | No | Serialize DSL as inline JSON array |
| `--integration` | | No | Integration name or path |

#### Example

```bash
pgdelta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --yes
```

---

## End-to-end workflows

### Workflow 1: Declarative schema management

Version-control your database schema as `.sql` files and apply it to fresh databases.

```bash
# 1. Export current schema from an existing database
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --integration supabase

# 2. Edit the .sql files as needed (add tables, modify functions, etc.)
#    Commit them to version control.

# 3. Apply the schema to a fresh database
pgdelta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --verbose

# 4. Re-export to see what changed after manual edits on the DB
pgdelta declarative export \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --output ./declarative-schemas/ \
  --integration supabase \
  --diff-focus
```

### Workflow 2: Migration generation with catalog snapshots

Snapshot a production database, then generate migrations offline.

```bash
# 1. Snapshot production
pgdelta catalog-export \
  --target postgresql://user:pass@prod:5432/mydb \
  --output prod-baseline.json

# 2. Make schema changes on a dev database, then generate a migration
pgdelta plan \
  --source prod-baseline.json \
  --target postgresql://user:pass@localhost:5432/dev_db \
  --output migration.sql \
  --format sql \
  --sql-format

# 3. Review the migration script, then apply
pgdelta apply \
  --plan migration.json \
  --source postgresql://user:pass@prod:5432/mydb \
  --target postgresql://user:pass@prod:5432/mydb
```

### Workflow 3: CI/CD pipeline

Automate migration generation and review in a CI pipeline.

```bash
# Step 1: Snapshot the current state (run once or on baseline changes)
pgdelta catalog-export \
  --target $DATABASE_URL \
  --output baseline.json

# Step 2: Generate migration from baseline to desired state
pgdelta plan \
  --source baseline.json \
  --target $DATABASE_URL \
  --output migration.json

# Step 3: Apply if changes are detected (exit code 2 = changes found)
if [ $? -eq 2 ]; then
  pgdelta apply \
    --plan migration.json \
    --source $DATABASE_URL \
    --target $DATABASE_URL \
    --unsafe  # Only if data-loss operations are expected
fi
```

---

## Integrations

Use `--integration supabase` (or a custom JSON file) to apply pre-configured filter and serialization rules. Integrations:

- Filter out system schemas and platform-managed objects.
- Customize SQL serialization (e.g. skip `AUTHORIZATION` on schema creation).
- Provide an empty-catalog baseline so `--source` can be omitted for full exports.

Available with: `plan`, `sync`, `declarative export`.

```bash
pgdelta declarative export \
  --target $DATABASE_URL \
  --output ./schemas/ \
  --integration supabase
```

---

## SQL format options

Commands that produce SQL output (`plan --format sql`, `declarative export`) support formatting via `--sql-format-options` (or `--format-options` for declarative export):

| Option | Values | Description |
|--------|--------|-------------|
| `keywordCase` | `upper`, `lower`, `preserve` | SQL keyword casing |
| `indent` | number | Spaces per indentation level |
| `maxWidth` | number | Line width for wrapping |
| `commaStyle` | `trailing`, `leading` | Comma placement in lists |
| `alignColumns` | boolean | Align column definitions |
| `alignKeyValues` | boolean | Align key-value pairs |
| `preserveRoutineBodies` | boolean | Keep function/procedure bodies as-is |
| `preserveViewBodies` | boolean | Keep view definitions as-is |
| `preserveRuleBodies` | boolean | Keep rule definitions as-is |

---

## Debugging

Enable debug logging for detailed internal output:

```bash
# All pg-delta debug output
DEBUG=pg-delta:* pgdelta <command> ...

# Declarative apply only (shows deferred statements, per-round summaries)
DEBUG=pg-delta:declarative-apply pgdelta declarative apply ...
```

Use `--verbose` with `declarative apply` for per-round applied/deferred/failed counts without full debug output.
