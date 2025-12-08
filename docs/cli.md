# CLI Reference

The `pg-delta` CLI provides a command-line interface for generating migration scripts by comparing PostgreSQL databases.

## Installation

```bash
npm install -g @supabase/pg-delta
```

Or use with `npx`:

```bash
npx @supabase/pg-delta diff <source> <target>
```

## Commands

### `diff`

Generate a migration script by comparing two databases.

#### Usage

```bash
pg-delta diff <source-url> <target-url> [options]
```

#### Arguments

- `source-url` (required): Connection URL for the source database (main)
- `target-url` (required): Connection URL for the target database (branch)

#### Options

- `-o, --output <file>`: Write output to a file instead of stdout
- `--integration <name>`: Use a specific integration (optional)
  - Available integrations: `supabase`

#### Examples

**Basic usage:**

```bash
pg-delta diff \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db
```

**Save to file:**

```bash
pg-delta diff \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db \
  --output migration.sql
```

**Use Supabase integration:**

```bash
pg-delta diff \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db \
  --integration supabase
```

**Using environment variables:**

```bash
SOURCE_DB="postgresql://..." TARGET_DB="postgresql://..." \
  pg-delta diff "$SOURCE_DB" "$TARGET_DB"
```

## Connection URLs

The connection URL follows the standard PostgreSQL connection string format:

```
postgresql://[user[:password]@][host][:port][/database][?params...]
```

Examples:

- `postgresql://localhost/mydb`
- `postgresql://user:password@localhost:5432/mydb`
- `postgresql://user@localhost/mydb?sslmode=require`

## Exit Codes

- `0`: Success - migration script generated (or no differences found)
- `1`: Error - command execution failed
- Other non-zero codes: Internal errors

## Help

Get help for any command:

```bash
pg-delta --help
pg-delta diff --help
```

