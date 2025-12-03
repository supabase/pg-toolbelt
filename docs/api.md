# API Reference

The `@supabase/pg-delta` package provides a programmatic API for generating migration scripts.

## Installation

```bash
npm install @supabase/pg-delta
```

## Main API

### `main(mainDatabaseUrl, branchDatabaseUrl, options?)`

Generate a migration script by comparing two databases.

#### Parameters

- `mainDatabaseUrl` (string): Connection URL for the main/source database
- `branchDatabaseUrl` (string): Connection URL for the branch/target database
- `options` (Integration, optional): Integration configuration for filtering and serialization

#### Returns

`Promise<DiffResult | null>`

- `DiffResult`: Object containing the migration script
  - `migrationScript` (string): The generated SQL migration script
- `null`: No differences found between the databases

#### Example

```typescript
import { main } from "@supabase/pg-delta";

const result = await main(
  "postgresql://localhost:5432/source_db",
  "postgresql://localhost:5432/target_db"
);

if (result) {
  console.log(result.migrationScript);
  // Write to file, execute, etc.
} else {
  console.log("No differences found");
}
```

## Types

### `DiffResult`

```typescript
interface DiffResult {
  migrationScript: string;
}
```

### `Integration`

An integration provides filtering and serialization logic for handling platform-specific differences.

```typescript
type Integration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};
```

See [Integrations](./integrations.md) for more details.

### `DiffContext`

Context provided to filter and serialize functions.

```typescript
interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}
```

## Exports

The package exports the following:

- `main`: Main function for generating migrations
- `postgresConfig`: PostgreSQL client configuration (includes custom type handlers)
- `DiffContext`: Type for diff context
- `ChangeFilter`: Type for change filter functions
- `ChangeSerializer`: Type for change serializer functions
- `MainOptions`: Alias for `Integration`
- `DiffResult`: Type for the result object

## PostgreSQL Configuration

The package includes a custom PostgreSQL configuration (`postgresConfig`) that handles:

- `int2vector` type parsing
- `bigint` type parsing

This configuration is used internally when connecting to databases. You can import and use it if you need to create your own PostgreSQL connections with the same type handling.

## Error Handling

The `main` function may throw errors in the following cases:

- Invalid database connection URLs
- Connection failures
- Database query errors
- Other unexpected errors during catalog extraction or diffing

Always wrap calls in try-catch blocks:

```typescript
try {
  const result = await main(sourceUrl, targetUrl);
  // Handle result
} catch (error) {
  console.error("Failed to generate migration:", error);
  process.exit(1);
}
```

## Examples

### Basic Usage

```typescript
import { main } from "@supabase/pg-delta";
import { writeFile } from "fs/promises";

const result = await main(
  process.env.SOURCE_DB_URL!,
  process.env.TARGET_DB_URL!
);

if (result) {
  await writeFile("migration.sql", result.migrationScript);
  console.log("Migration script written to migration.sql");
} else {
  console.log("No differences found");
}
```

### Using Integrations

```typescript
import { main } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const result = await main(
  sourceUrl,
  targetUrl,
  supabase // Use Supabase integration
);
```

### Custom Integration

```typescript
import { main, type Integration } from "@supabase/pg-delta";

const customIntegration: Integration = {
  filter: (ctx, change) => {
    // Custom filtering logic
    return true;
  },
  serialize: (ctx, change) => {
    // Custom serialization logic
    return change.serialize();
  },
};

const result = await main(sourceUrl, targetUrl, customIntegration);
```

