# pg-diff

Postgres migrations made easy. :sparkles:

A modern alternative to `pg_dump` that generates migrations by diffing PostgreSQL databases.

## Features

- 🔍 Compare databases and generate migration scripts
- 🚀 More powerful than traditional `pg_dump`
- 🔒 Safe and reliable schema evolution
- 🛠️ Developer-friendly workflow
- 📦 Support for PGlite (local Postgres WASM databases)

## Quick Start

```bash
npm install pg-diff
pg-diff diff source_db target_db
```

## PGlite Support

pg-diff now supports [PGlite](https://pglite.dev) - a WASM build of Postgres that runs locally in Node.js, Bun, or Deno. This allows you to diff a remote Postgres instance against a local PGlite database file.

### Example: Diff Remote Postgres and PGlite

```typescript
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { main } from "pg-diff";

// Create or open a PGlite database file
const pglite = await PGlite.create("./data/pgdata");

// Connect to a remote Postgres database
const remoteDb = postgres("postgres://user:pass@localhost:5432/db");

// Generate migration script by comparing the two databases
const migrationScript = await main(
  remoteDb,   // main database (remote Postgres)
  pglite,     // branch database (local PGlite)
);

console.log(migrationScript);

// Clean up
await remoteDb.end();
await pglite.close();
```

### CLI Usage with PGlite

You can also use PGlite from the command line:

```bash
# Compare a remote database with a local PGlite file
npx pg-diff diff postgres://user:pass@host:5432/db ./data/pgdata
```

Both connection types (connection URLs and PGlite instances) can be used interchangeably for either the source or target database.

## Use Cases

- Generate migrations between environments
- Compare database states
- Automate migration creation
- Maintain schema version control

## Contributing

Contributions welcome! Feel free to submit issues and pull requests.

## License

MIT