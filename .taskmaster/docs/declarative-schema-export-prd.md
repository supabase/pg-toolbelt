<context>
# Overview

This PRD describes the **Declarative Schema Export** feature for pg-delta. This feature allows pg-delta to output database schemas as structured, organized SQL files with a JSON manifest that guarantees correct execution order.

**Problem Solved**: Currently, pg-delta outputs a single SQL file with all migration statements. Users need a way to version-control their database schema as organized files (like the Supabase CLI's declarative schema feature) while leveraging pg-delta's robust dependency resolution.

**Target Users**: Developers using pg-delta for database schema management who want:
- Version-controlled schema files organized by object type
- Self-contained JSON output that can be processed by other tools
- Guaranteed correct execution order without manual ordering

**Value Proposition**: Leverages pg-delta's existing topological sorting and dependency resolution to produce organized schema files that are guaranteed to execute correctly in order.

# Core Features

## 1. Declarative Schema JSON Export
**What it does**: New `exportDeclarativeSchema()` function that outputs a self-contained JSON with:
- Ordered list of file entries
- Actual SQL content for each file
- Metadata (object type, schema name, etc.)

**Why it's important**:
- Self-contained output can be processed by CLI tools, CI/CD pipelines
- No need for separate file generation step
- Execution order is guaranteed by the ordering in the JSON

**How it works**:
1. Filter changes to CREATE operations only (final state, not migration)
2. Map each change to a file path based on object type
3. Group changes by file path with category priority ordering
4. Serialize to JSON with SQL content included

## 2. Object-Based File Organization
**What it does**: Organizes SQL statements into files following a directory structure:
```
cluster/           # Cluster-wide: roles, extensions, FDWs, publications
schemas/{schema}/  # Per-schema: tables, views, functions, indexes, policies
```

**Why it's important**:
- Matches familiar CLI directory structure
- Easy to navigate and understand
- Each file has a clear purpose

**How it works**:
- Changes are mapped to file paths based on their object type
- Category priority determines base ordering (cluster → schemas → types → tables → ... → policies)
- Topological sort position within category ensures correct ordering

## 3. Deferred Dependencies Handling
**What it does**: Separates statements that depend on external objects into a `policies/` directory that runs last.

**Why it's important**:
- Avoids cross-file dependency issues
- All `tables/*.sql` files can run in any order
- FK constraints, triggers, RLS policies run after all base objects exist

**How it works**:
- FK constraints → `schemas/{schema}/policies/{table}.sql`
- Triggers → `schemas/{schema}/policies/{table}.sql`
- RLS policies → `schemas/{schema}/policies/{table}.sql`
- Rules → `schemas/{schema}/policies/{table}.sql`

# User Experience

## User Persona
- **Developer using pg-delta** for database schema management
- Wants to integrate pg-delta with CI/CD pipelines or other tools
- Needs organized, version-controllable schema output

## Key User Flow
1. User has source database (empty or current state) and target database (desired state)
2. User calls `exportDeclarativeSchema(ctx, sortedChanges)`
3. User receives JSON with ordered files and SQL content
4. User can execute files in order or process JSON further

## API Usage
```typescript
import { extractCatalog, diffCatalogs, sortChanges, exportDeclarativeSchema } from "pg-delta";

// Extract and diff
const sourceCatalog = await extractCatalog(sourcePool);
const targetCatalog = await extractCatalog(targetPool);
const ctx = { mainCatalog: sourceCatalog, branchCatalog: targetCatalog };
const changes = diffCatalogs(sourceCatalog, targetCatalog);
const sortedChanges = sortChanges(ctx, changes);

// Export
const output = exportDeclarativeSchema(ctx, sortedChanges);

// Use output
for (const file of output.files) {
  await db.query(file.sql);
}
```
</context>
<PRD>
# Technical Architecture

## System Components

### New Module: `src/core/export/`

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces for `DeclarativeSchemaOutput`, `FileEntry` |
| `file-mapper.ts` | Maps changes to file paths based on object type and category |
| `grouper.ts` | Groups changes by file path with category priority ordering |
| `index.ts` | Main `exportDeclarativeSchema()` function |

### Data Flow

```
sortedChanges (from sortChanges())
    ↓
Filter to CREATE only
    ↓
Map each change to FilePath (path + category)
    ↓
Group by file path
    ↓
Order by: 1) category priority, 2) min topo position
    ↓
Serialize to JSON with SQL content
    ↓
DeclarativeSchemaOutput
```

## Data Models

### DeclarativeSchemaOutput
```typescript
interface DeclarativeSchemaOutput {
  version: 1;
  mode: "declarative";
  generatedAt: string;
  source: { fingerprint: string };
  target: { fingerprint: string };
  files: FileEntry[];
}
```

### FileEntry
```typescript
interface FileEntry {
  path: string;        // e.g., "schemas/public/tables/users.sql"
  order: number;       // Execution order (0 = first)
  statements: number;  // Count of SQL statements
  sql: string;         // Actual SQL content
  metadata: {
    objectType: string;
    schemaName?: string;
    objectName?: string;
  };
}
```

### FileCategory Priority
```typescript
const CATEGORY_PRIORITY = {
  cluster: 0,        // roles, extensions, FDWs
  schema: 1,         // CREATE SCHEMA
  types: 2,          // enums, composites, ranges
  sequences: 3,      // standalone sequences
  tables: 4,         // base tables (no FK)
  foreign_tables: 5,
  views: 6,
  matviews: 7,
  functions: 8,
  procedures: 9,
  aggregates: 10,
  domains: 11,
  collations: 12,
  indexes: 13,       // indexes after tables
  policies: 14,      // FK, triggers, RLS LAST
};
```

## APIs and Integrations

### Existing APIs Used (No Changes)
- `extractCatalog()` - Extract catalog from database
- `diffCatalogs()` - Compute changes between catalogs
- `sortChanges()` - Topologically sort changes
- `change.serialize()` - Generate SQL for each change
- `getObjectSchema()`, `getParentInfo()` - From `plan/serialize.ts`

### New API
```typescript
export function exportDeclarativeSchema(
  ctx: DiffContext,
  sortedChanges: Change[],
  options?: { integration?: Integration }
): DeclarativeSchemaOutput;
```

## Infrastructure Requirements

- No new dependencies
- No external services
- No database changes
- Reuses existing pg-delta infrastructure

# Development Roadmap

## Phase 1: Core Types and File Mapping (Foundation)

### Scope
- Create `src/core/export/types.ts` with interfaces
- Create `src/core/export/file-mapper.ts` with `getFilePath()` function
- Handle all 20+ object types
- Implement category assignment for each object type
- Handle special cases: indexes → `indexes/`, FK/triggers/RLS → `policies/`

### Deliverables
- [ ] `DeclarativeSchemaOutput` and `FileEntry` interfaces
- [ ] `FileCategory` type and `CATEGORY_PRIORITY` mapping
- [ ] `getFilePath(change)` function returning `{ path, category, metadata }`
- [ ] Unit tests for file path mapping

## Phase 2: Grouper Implementation

### Scope
- Create `src/core/export/grouper.ts`
- Group changes by file path
- Order files by category priority, then topological position
- Preserve statement order within files

### Deliverables
- [ ] `FileGroup` interface
- [ ] `groupChangesByFile(sortedChanges)` function
- [ ] Unit tests for grouping logic

## Phase 3: Main Export Function

### Scope
- Create `src/core/export/index.ts`
- Implement `exportDeclarativeSchema()` function
- Filter to CREATE operations only
- Serialize changes to SQL
- Build final JSON output

### Deliverables
- [ ] `exportDeclarativeSchema()` function
- [ ] Integration with existing `change.serialize()`
- [ ] Fingerprint generation for source/target

## Phase 4: Integration Tests (Critical Validation)

### Scope
- Create `tests/integration/declarative-schema-export.test.ts`
- Test that exported files execute in order without errors
- Reuse fixtures from existing integration tests
- Cover all object types and edge cases

### Deliverables
- [ ] Test helper: `testDeclarativeExport()`
- [ ] Tests for simple schemas (tables, indexes)
- [ ] Tests for complex dependencies (FK, triggers, RLS)
- [ ] Tests for partitioned tables
- [ ] Tests for views and materialized views
- [ ] Tests reusing existing fixtures

## Phase 5: Edge Cases and Polish

### Scope
- Handle edge cases discovered during testing
- Ensure comprehensive object type coverage
- Optimize and refactor if needed

### Deliverables
- [ ] Fix any edge cases found
- [ ] Complete test coverage
- [ ] Documentation

# Logical Dependency Chain

## Foundation (Must Build First)
1. **Types** (`types.ts`) - Interfaces define the contract
2. **File Mapper** (`file-mapper.ts`) - Core logic for path assignment

## Core Logic (Builds on Foundation)
3. **Grouper** (`grouper.ts`) - Depends on file mapper
4. **Main Export** (`index.ts`) - Combines all components

## Validation (Proves Correctness)
5. **Integration Tests** - Validates the entire flow works

## Dependency Graph
```
types.ts
    ↓
file-mapper.ts ←── (uses types)
    ↓
grouper.ts ←── (uses file-mapper)
    ↓
index.ts ←── (uses grouper, types)
    ↓
integration tests ←── (validates index.ts)
```

## Atomic Development Units

Each phase produces a working, testable unit:

1. **types.ts** - Can be reviewed/tested independently
2. **file-mapper.ts** - Unit testable with mock changes
3. **grouper.ts** - Unit testable with mock file paths
4. **index.ts** - Integration testable against real databases
5. **Integration tests** - Validates end-to-end correctness

# Risks and Mitigations

## Technical Challenges

### Risk: Complex FK constraint detection
**Challenge**: Detecting if a table change is specifically an FK constraint addition
**Mitigation**: Inspect change type - pg-delta already has distinct change classes for different operations

### Risk: Cross-file dependency ordering
**Challenge**: Files might have statements that depend on statements in other files
**Mitigation**: The `policies/` category runs last, separating deferred dependencies from base objects

### Risk: Object type coverage
**Challenge**: Ensuring all 20+ object types are correctly mapped
**Mitigation**: Exhaustive switch statements with TypeScript's never check, comprehensive tests

## MVP Definition

**Minimum Viable Product**:
1. `exportDeclarativeSchema()` produces valid JSON
2. Files can be executed in order without errors
3. Only CREATE statements (no ALTER, no DROP)
4. Core object types: schemas, tables, indexes, views, functions, triggers, RLS policies

**Deferred to Future**:
- Entity-based grouping (table + children in one file)
- CLI command integration
- File writing to disk
- View forward declarations

## Resource Constraints

### Constraint: No core changes
**Mitigation**: Feature is purely additive - only adds new `export/` module

### Constraint: Must work with existing tests
**Mitigation**: Reuse existing test fixtures, follow established patterns

# Appendix

## File Structure Reference

```
cluster/
  roles.sql              # CREATE ROLE, GRANT role TO role
  extensions.sql         # CREATE EXTENSION
  foreign_data_wrappers.sql  # FDWs, servers, user mappings
  publications.sql       # CREATE PUBLICATION
  subscriptions.sql      # CREATE SUBSCRIPTION
  event_triggers.sql     # CREATE EVENT TRIGGER
schemas/
  {schema}/
    schema.sql           # CREATE SCHEMA, default privileges
    types.sql            # Enums, composite types, ranges
    sequences.sql        # Standalone sequences
    tables/
      {table}.sql        # CREATE TABLE, CHECK, PK/UNIQUE
    indexes/
      {table}.sql        # All indexes for a table
    views/
      {view}.sql         # CREATE VIEW
    materialized_views/
      {mview}.sql        # CREATE MATERIALIZED VIEW
    functions/
      {function}.sql     # CREATE FUNCTION
    procedures/
      {procedure}.sql    # CREATE PROCEDURE
    aggregates/
      {aggregate}.sql    # CREATE AGGREGATE
    foreign_tables/
      {ftable}.sql       # CREATE FOREIGN TABLE
    domains/
      {domain}.sql       # CREATE DOMAIN
    policies/
      {table}.sql        # FK constraints, triggers, RLS, rules
    collations/
      {collation}.sql    # CREATE COLLATION
```

## Existing Code References

| File | Relevance |
|------|-----------|
| `src/core/plan/hierarchy.ts` | Reference for object type grouping |
| `src/core/plan/serialize.ts` | `getObjectSchema()`, `getParentInfo()` helpers |
| `src/core/sort/sort-changes.ts` | Topological sorting (source of truth for order) |
| `src/core/change.types.ts` | All Change union types |
| `tests/integration/roundtrip.ts` | Test infrastructure to reuse |

## Example JSON Output

```json
{
  "version": 1,
  "mode": "declarative",
  "generatedAt": "2024-01-15T10:30:00Z",
  "source": { "fingerprint": "abc123" },
  "target": { "fingerprint": "def456" },
  "files": [
    {
      "path": "cluster/roles.sql",
      "order": 0,
      "statements": 2,
      "sql": "CREATE ROLE app_user;\n\nCREATE ROLE app_admin;",
      "metadata": { "objectType": "role" }
    },
    {
      "path": "schemas/public/schema.sql",
      "order": 1,
      "statements": 1,
      "sql": "CREATE SCHEMA public;",
      "metadata": { "objectType": "schema", "schemaName": "public" }
    },
    {
      "path": "schemas/public/tables/users.sql",
      "order": 2,
      "statements": 1,
      "sql": "CREATE TABLE public.users (id integer PRIMARY KEY, name text);",
      "metadata": { "objectType": "table", "schemaName": "public", "objectName": "users" }
    },
    {
      "path": "schemas/public/indexes/users.sql",
      "order": 3,
      "statements": 1,
      "sql": "CREATE INDEX users_name_idx ON public.users (name);",
      "metadata": { "objectType": "index", "schemaName": "public", "objectName": "users" }
    }
  ]
}
```
</PRD>
