# pg-delta

PostgreSQL migrations made easy.

Generate migration scripts by comparing two PostgreSQL databases. Automatically detects schema differences and creates safe, ordered migration scripts. Supports both imperative diff-based migrations and declarative file-based schema management.

## Features

- 🔍 Compare databases and generate migration scripts automatically
- 🔒 Safety-first: detects data-loss operations and requires explicit confirmation
- 📋 Plan-based workflow: preview changes before applying, store plans for version control
- 📁 Declarative schemas: export/apply schemas as version-controlled `.sql` files
- 🎯 Integration DSL: filter and customize serialization with JSON-based rules
- 🛠️ Developer-friendly: clack-powered interactive CLI with tree-formatted change previews

## Installation

```bash
npm install @supabase/pg-delta
```

Or use with `npx`:

```bash
npx @supabase/pg-delta --source <source> --target <target>
```

## Quick Start

### CLI Usage

The CLI provides two paradigms: **imperative** (diff-based migrations) and **declarative** (file-based schemas).

#### Imperative: diff-based migrations

**Sync (default)** - Plan and apply changes in one go:

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Plan** - Preview changes before applying:

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --output plan.json
```

**Apply** - Apply a previously created plan:

```bash
pg-delta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

#### Declarative: file-based schemas

**Declarative export** - Export a database schema as `.sql` files:

```bash
pg-delta declarative export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output ./declarative-schemas/
```

**Declarative apply** - Apply `.sql` files to a database:

```bash
pg-delta declarative apply \
  --path ./declarative-schemas/ \
  --target postgresql://user:pass@localhost:5432/fresh_db
```

#### Utilities

**Catalog export** - Snapshot a database catalog to JSON for offline diffing:

```bash
pg-delta catalog-export \
  --target postgresql://user:pass@localhost:5432/mydb \
  --output snapshot.json
```

The snapshot can be used as `--source` or `--target` for `plan` and `declarative export`, enabling offline diffs without a live database connection.

See the [Workflow Guide](./docs/workflow.md) for end-to-end examples combining these commands.

### Using Integrations

Use built-in integrations or custom JSON files:

```bash
# Built-in Supabase integration
pg-delta sync --source <source> --target <target> --integration supabase

# Custom integration file
pg-delta sync --source <source> --target <target> --integration ./my-integration.json
```

### Programmatic Usage

```typescript
import { main } from "@supabase/pg-delta";

const result = await main(
  "postgresql://source",
  "postgresql://target"
);

if (result) {
  console.log(result.migrationScript);
}
```

For plan-based workflow:

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";

// Create a plan
const planResult = await createPlan(sourceUrl, targetUrl, {
  filter: { schema: "public" },
  serialize: [{ when: { type: "schema" }, options: { skipAuthorization: true } }]
});

if (planResult) {
  // Apply the plan
  const result = await applyPlan(
    planResult.plan,
    sourceUrl,
    targetUrl
  );
}
```

## Documentation

- [Workflow Guide](./docs/workflow.md) - Full flow documentation for all commands and end-to-end workflows
- [CLI Reference](./docs/cli.md) - Complete CLI documentation with all commands and options
- [API Reference](./docs/api.md) - Programmatic API documentation
- [Integrations](./docs/integrations.md) - Using and creating integrations with the DSL system
- [Sorting & Safety](./docs/sorting.md) - How migrations are ordered for safety

## Key Concepts

### Plan-Based Workflow

`pg-delta` uses a plan-based workflow that provides:

- **Preview before apply**: Review changes before executing them
- **Self-contained plans**: Plans store filtering and serialization rules
- **Reproducibility**: Plans can be version-controlled and shared
- **Safety checks**: Automatic detection of data-loss operations

### Integration DSL

Integrations use a JSON-based DSL for filtering and serialization:

- **Filter DSL**: Pattern matching to include/exclude changes
- **Serialization DSL**: Rules to customize SQL generation
- **Serializable**: Can be stored in plans and passed as CLI flags

See [Integrations Documentation](./docs/integrations.md) for complete details.

## Use Cases

- Generate migrations between environments (dev → staging → production)
- Compare database states and review differences
- Automate migration creation in CI/CD pipelines
- Maintain schema version control with plan files
- Export and version-control schemas as declarative `.sql` files
- Apply declarative schemas to fresh databases (provisioning, restore)
- Snapshot databases for offline, reproducible diffs
- Filter platform-specific changes (e.g., Supabase system schemas)

## Contributing

Contributions welcome! Feel free to submit issues and pull requests.

## License

MIT
