# pg-toolbelt

Monorepo for Supabase PostgreSQL tooling.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@supabase/pg-delta`](./packages/pg-delta) | PostgreSQL schema diff and migration tool | [![npm](https://img.shields.io/npm/v/@supabase/pg-delta)](https://www.npmjs.com/package/@supabase/pg-delta) |
| [`@supabase/pg-topo`](./packages/pg-topo) | Topological sorting for SQL DDL statements | [![npm](https://img.shields.io/npm/v/@supabase/pg-topo)](https://www.npmjs.com/package/@supabase/pg-topo) |

## Development

### Prerequisites

- [Bun](https://bun.sh) (latest)
- [Docker](https://www.docker.com/) (for integration tests)
- Node.js >= 20 (for TypeScript compilation)

### Setup

```bash
bun install
```

### Commands

```bash
bun run build           # Build all packages
bun run test            # Test all packages
bun run test:pg-delta   # Test pg-delta only
bun run test:pg-topo    # Test pg-topo only
bun run check-types     # Type check all packages
bun run format-and-lint # Format and lint all code
```

### Working with individual packages

```bash
# pg-delta
cd packages/pg-delta
bun test src/           # Unit tests only
bun test tests/         # Integration tests only (requires Docker)

# pg-topo
cd packages/pg-topo
bun test                # All tests (requires Docker)
```

### Releasing

This monorepo uses [changesets](https://github.com/changesets/changesets) for versioning.

```bash
bunx changeset          # Create a changeset
bun run version         # Apply changesets to update versions
bunx changeset publish  # Publish to npm
```

## License

MIT
