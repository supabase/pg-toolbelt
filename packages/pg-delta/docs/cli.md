# CLI Reference

The `pg-delta` CLI provides a command-line interface for managing PostgreSQL schemas. It supports imperative diff-based migrations (`plan`, `apply`, `sync`), declarative file-based schemas (`declarative export`, `declarative apply`), and catalog snapshotting (`catalog-export`).

For end-to-end workflow examples, see the [Workflow Guide](./workflow.md).

## Installation

```bash
npm install -g @supabase/pg-delta
```

Or use with `npx`:

```bash
npx @supabase/pg-delta sync --source <source> --target <target>
```

## Commands

### `sync` (default)

Plan and apply schema changes in one go with confirmation prompt. This is the default command when no command is specified.

#### Usage

```bash
pg-delta sync --source <source-url> --target <target-url> [options]
# or simply
pg-delta --source <source-url> --target <target-url> [options]
```

#### Options

- `-s, --source <url>` (required): Source database connection URL (current state)
- `-t, --target <url>` (required): Target database connection URL (desired state)
- `--role <role>`: Role to use when executing the migration (SET ROLE will be added to statements)
- `--filter <json>`: Filter DSL as inline JSON to filter changes (e.g., `'{"schema":"public"}'`)
- `--serialize <json>`: Serialize DSL as inline JSON array (e.g., `'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'`)
- `--integration <name|path>`: Integration name (e.g., `supabase`) or path to integration JSON file (must end with `.json`)
- `-y, --yes`: Skip confirmation prompt and apply changes automatically
- `-u, --unsafe`: Allow data-loss operations (unsafe mode)

#### Examples

**Basic usage:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Skip confirmation:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --yes
```

**Use Supabase integration:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration supabase
```

**Use custom integration file:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration ./my-integration.json
```

**Filter changes:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --filter '{"schema":"public"}'
```

#### Exit Codes

- `0`: Success (changes applied or no changes detected)
- `1`: Error occurred
- `2`: User cancelled or changes detected but not applied

---

### `plan`

Compute schema diff and preview changes. Defaults to tree display; json/sql outputs are available for artifacts or piping.

Both `--source` and `--target` accept either a PostgreSQL connection URL or a catalog snapshot file path (from `catalog-export`), enabling offline diffs without live database connections. When `--source` is omitted, diffing starts from an empty baseline (or the integration's empty catalog if `--integration` is set).

#### Usage

```bash
pg-delta plan --target <target-url-or-snapshot> [options]
```

#### Options

- `-s, --source <url|path>`: Source (current state): Postgres URL or catalog snapshot file path. Omit for empty baseline
- `-t, --target <url|path>` (required): Target (desired state): Postgres URL or catalog snapshot file path
- `-o, --output <file>`: Write output to file (stdout by default). If format is not set: `.sql` infers sql, `.json` infers json, otherwise uses human output
- `--format <format>`: Output format override: `json` (plan) or `sql` (script)
- `--role <role>`: Role to use when executing the migration (SET ROLE will be added to statements)
- `--filter <json>`: Filter DSL as inline JSON to filter changes (e.g., `'{"schema":"public"}'`)
- `--serialize <json>`: Serialize DSL as inline JSON array (e.g., `'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'`)
- `--integration <name|path>`: Integration name (e.g., `supabase`) or path to integration JSON file (must end with `.json`)
- `--sql-format`: Format SQL output (opt-in for `--format sql` or `.sql` output)
- `--sql-format-options <json>`: SQL format options as inline JSON (e.g., `'{"keywordCase":"upper","maxWidth":100"}'`)

#### Examples

**Preview changes (tree format):**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Save plan as JSON:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --output plan.json
```

**Generate SQL script:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --format sql \
  --output migration.sql
```

**Use integration:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration supabase \
  --output plan.json
```

**Offline diff with catalog snapshot:**

```bash
pg-delta plan \
  --source prod-snapshot.json \
  --target postgresql://user:pass@localhost:5432/staging_db \
  --output migration.sql
```

#### Exit Codes

- `0`: Success - no changes detected
- `2`: Changes detected (plan generated)
- `1`: Error - command execution failed

---

### `apply`

Apply a plan's migration script to a target database.

#### Usage

```bash
pg-delta apply --plan <plan-file> --source <source-url> --target <target-url> [options]
```

#### Options

- `-p, --plan <file>` (required): Path to plan file (JSON format)
- `-s, --source <url>` (required): Source database connection URL (current state)
- `-t, --target <url>` (required): Target database connection URL (desired state)
- `-u, --unsafe`: Allow data-loss operations (unsafe mode)

#### Examples

**Apply a plan:**

```bash
pg-delta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Apply unsafe plan:**

```bash
pg-delta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --unsafe
```

#### Exit Codes

- `0`: Success (changes applied)
- `1`: Error occurred

**Note:** Safe by default - will refuse plans containing data-loss unless `--unsafe` is set.

---

### `catalog-export`

Extract the full catalog from a live PostgreSQL database and save it as a JSON snapshot file. The snapshot can be used as `--source` or `--target` for `plan` and `declarative export`, enabling offline diffs without a live database connection.

#### Usage

```bash
pg-delta catalog-export --target <target-url> --output <file> [options]
```

#### Options

- `-t, --target <url>` (required): Database connection URL to extract the catalog from
- `-o, --output <file>` (required): Output file path for the catalog snapshot JSON
- `--role <role>`: Role to assume via `SET ROLE` during extraction

#### Examples

**Snapshot a database:**

```bash
pg-delta catalog-export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output snapshot.json
```

**Snapshot with a specific role:**

```bash
pg-delta catalog-export \
  --target postgresql://user:pass@prod:5432/mydb \
  --output prod-snapshot.json \
  --role readonly_role
```

---

### `declarative export`

Export a declarative SQL schema by comparing two databases (source -> target). Writes `.sql` files to the output directory, organized by object type. Only `CREATE` and `ALTER` statements are emitted (desired state, not migration steps).

When `--source` is omitted, all objects from the target database are exported (equivalent to diffing from an empty database).

#### Usage

```bash
pg-delta declarative export --target <target-url> --output <dir> [options]
```

#### Options

- `-t, --target <url|path>` (required): Target (desired state): Postgres URL or catalog snapshot file path
- `-o, --output <dir>` (required): Output directory for `.sql` files
- `-s, --source <url|path>`: Source (current state): Postgres URL or catalog snapshot. Omit for full export
- `--integration <name|path>`: Integration name (e.g., `supabase`) or path to integration JSON file
- `--filter <json>`: Filter DSL as inline JSON (e.g., `'{"schema":"public"}'`)
- `--serialize <json>`: Serialize DSL as inline JSON array
- `--grouping-mode <mode>`: How grouped entities are organized: `single-file` or `subdirectory`
- `--group-patterns <json>`: JSON array of `{pattern, name}` objects for name-based grouping
- `--flat-schemas <list>`: Comma-separated schemas to flatten (one file per category)
- `--format-options <json>`: SQL format options as inline JSON (e.g., `'{"keywordCase":"lower","maxWidth":180"}'`)
- `--force`: Remove entire output directory before writing
- `--dry-run`: Show tree and summary without writing files
- `--diff-focus`: Show only files that changed (created/updated/deleted) in the tree
- `--verbose`: Show detailed output

#### Examples

**Full export:**

```bash
pg-delta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/
```

**Export with Supabase integration:**

```bash
pg-delta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --integration supabase
```

**Dry-run preview:**

```bash
pg-delta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --dry-run
```

**Re-export showing only changed files:**

```bash
pg-delta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/ \
  --diff-focus
```

---

### `declarative apply`

Apply SQL files from a declarative schema directory to a target database. Uses `pg-topo` for static dependency analysis and topological ordering, then applies statements round-by-round to handle any remaining dependency gaps.

Function body checks are disabled during rounds to avoid false failures from functions referencing not-yet-created objects. A final validation pass re-runs all function/procedure definitions with body checks enabled.

#### Usage

```bash
pg-delta declarative apply --path <dir-or-file> --target <target-url> [options]
```

#### Options

- `-p, --path <dir|file>` (required): Path to the schema directory (containing `.sql` files) or a single `.sql` file
- `-t, --target <url>` (required): Target database connection URL
- `--max-rounds <n>`: Maximum application rounds before giving up (default: 100)
- `--no-validate-functions`: Skip final function body validation pass
- `-v, --verbose`: Show detailed per-round progress (applied/deferred/failed)
- `--ungroup-diagnostics`: Show full per-diagnostic detail instead of grouped summary

#### Examples

**Apply a schema:**

```bash
pg-delta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db
```

**Verbose mode:**

```bash
pg-delta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --verbose
```

**Skip function validation:**

```bash
pg-delta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db \
  --no-validate-functions
```

**Debug logging:**

```bash
DEBUG=pg-delta:declarative-apply pg-delta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db
```

`DEBUG` accepts debug-style category patterns (for example: `pg-delta:*`, `pg-delta:graph`, `pg-delta:declarative-apply`).

#### Exit Codes

- `0`: Success (all statements applied and validation passed)
- `1`: Error (hard failures or validation errors)
- `2`: Stuck (dependency cycle or unresolvable ordering)

---

## Connection URLs

The connection URL follows the standard PostgreSQL connection string format:

```
postgresql://[user[:password]@][host][:port][/database][?params...]
```

Examples:

- `postgresql://localhost/mydb`
- `postgresql://user:password@localhost:5432/mydb`
- `postgresql://user@localhost/mydb?sslmode=require`

---

## Integrations

Integrations provide pre-configured filter and serialization rules for specific database platforms or use cases. See [Integrations Documentation](./integrations.md) for details.

Available built-in integrations:
- `supabase` - Supabase-specific filtering and serialization rules

You can also create custom integrations by providing a JSON file. See the integrations documentation for the DSL format.

---

## Help

Get help for any command:

```bash
pg-delta --help
pg-delta sync --help
pg-delta plan --help
pg-delta apply --help
pg-delta catalog-export --help
pg-delta declarative export --help
pg-delta declarative apply --help
```

---

## Logging

The CLI uses `logtape` for internal logging and `clack` for interactive UX.

- `DEBUG`: enable debug categories (e.g. `DEBUG=pg-delta:*` or `DEBUG=pg-delta:declarative-apply`)
- `PGDELTA_LOG_LEVEL`: set default logger threshold (`trace`, `debug`, `info`, `warning`, `error`, `fatal`)
