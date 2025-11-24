# Foreign Data Wrapper Implementation

This document summarizes the implementation of Foreign Data Wrapper (FDW) support in the PostgreSQL diff tool.

## Overview

Added support for diffing four PostgreSQL Foreign Data Wrapper object types:
1. **FOREIGN DATA WRAPPER** - The foundation wrapper that defines how to access external data
2. **SERVER** - Represents a connection to an external data source
3. **USER MAPPING** - Maps local database users to remote server users
4. **FOREIGN TABLE** - Tables that reference data stored on a foreign server

## Implementation Order

The implementation followed a logical dependency order:
1. **FOREIGN DATA WRAPPER** (Phase 1) - No dependencies
2. **SERVER** (Phase 2) - Depends on FOREIGN DATA WRAPPER
3. **USER MAPPING** (Phase 3) - Depends on SERVER
4. **FOREIGN TABLE** (Phase 4) - Depends on SERVER

## Directory Structure

All FDW objects are organized under `src/objects/foreign-data-wrapper/`:

```
src/objects/foreign-data-wrapper/
├── foreign-data-wrapper.types.ts          # Union type for all FDW changes
├── foreign-data-wrapper/
│   ├── foreign-data-wrapper.model.ts      # Model and extraction
│   ├── foreign-data-wrapper.diff.ts        # Diff logic
│   └── changes/
│       ├── foreign-data-wrapper.base.ts    # Base change classes
│       ├── foreign-data-wrapper.create.ts  # CREATE statements
│       ├── foreign-data-wrapper.alter.ts   # ALTER statements
│       ├── foreign-data-wrapper.drop.ts    # DROP statements
│       ├── foreign-data-wrapper.comment.ts # COMMENT statements
│       ├── foreign-data-wrapper.privilege.ts # GRANT/REVOKE statements
│       └── foreign-data-wrapper.types.ts   # Change type union
├── server/
│   ├── server.model.ts
│   ├── server.diff.ts
│   └── changes/
│       ├── server.base.ts
│       ├── server.create.ts
│       ├── server.alter.ts
│       ├── server.drop.ts
│       ├── server.comment.ts
│       ├── server.privilege.ts
│       └── server.types.ts
├── user-mapping/
│   ├── user-mapping.model.ts
│   ├── user-mapping.diff.ts
│   └── changes/
│       ├── user-mapping.base.ts
│       ├── user-mapping.create.ts
│       ├── user-mapping.alter.ts
│       ├── user-mapping.drop.ts
│       └── user-mapping.types.ts
└── foreign-table/
    ├── foreign-table.model.ts
    ├── foreign-table.diff.ts
    └── changes/
        ├── foreign-table.base.ts
        ├── foreign-table.create.ts
        ├── foreign-table.alter.ts
        ├── foreign-table.drop.ts
        ├── foreign-table.comment.ts
        ├── foreign-table.privilege.ts
        └── foreign-table.types.ts
```

## Object Details

### FOREIGN DATA WRAPPER

**Stable ID Format:** `foreignDataWrapper:${name}`

**Properties:**
- `name` (identity)
- `owner`
- `handler` (function reference, nullable)
- `validator` (function reference, nullable)
- `options` (array of key-value pairs, nullable)
- `comment` (nullable)
- `privileges` (USAGE only)

**Supported Operations:**
- CREATE FOREIGN DATA WRAPPER
- ALTER FOREIGN DATA WRAPPER (OWNER TO, OPTIONS)
- DROP FOREIGN DATA WRAPPER
- COMMENT ON FOREIGN DATA WRAPPER
- GRANT/REVOKE USAGE

**PostgreSQL Catalog:** `pg_foreign_data_wrapper`

**Note:** Rename operations are not supported (handled as drop + create since stableId is name-based).

### SERVER

**Stable ID Format:** `server:${name}`

**Properties:**
- `name` (identity)
- `owner`
- `foreign_data_wrapper` (reference to FDW)
- `type` (nullable)
- `version` (nullable)
- `options` (array of key-value pairs, nullable)
- `comment` (nullable)
- `privileges` (USAGE only)

**Supported Operations:**
- CREATE SERVER
- ALTER SERVER (OWNER TO, VERSION, OPTIONS)
- DROP SERVER
- COMMENT ON SERVER
- GRANT/REVOKE USAGE

**PostgreSQL Catalog:** `pg_foreign_server`

**Dependencies:** FOREIGN DATA WRAPPER

**Note:** Rename operations are not supported (handled as drop + create since stableId is name-based).

### USER MAPPING

**Stable ID Format:** `userMapping:${server}:${user}`

**Properties:**
- `user` (identity) - Can be role name, CURRENT_USER, PUBLIC, etc.
- `server` (identity) - Reference to server
- `options` (array of key-value pairs, nullable)

**Supported Operations:**
- CREATE USER MAPPING
- ALTER USER MAPPING (OPTIONS)
- DROP USER MAPPING

**PostgreSQL Catalog:** `pg_user_mapping`

**Dependencies:** SERVER

**Note:** User mappings do not support privileges (not a grantable object).

### FOREIGN TABLE

**Stable ID Format:** `foreignTable:${schema}.${name}`

**Properties:**
- `schema` (identity)
- `name` (identity)
- `owner`
- `server` (reference to server)
- `options` (array of key-value pairs, nullable)
- `columns` (array of column definitions)
- `comment` (nullable)
- `privileges` (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)

**Supported Operations:**
- CREATE FOREIGN TABLE
- ALTER FOREIGN TABLE (OWNER TO, ADD COLUMN, DROP COLUMN, ALTER COLUMN TYPE/DEFAULT/NOT NULL, OPTIONS)
- DROP FOREIGN TABLE
- COMMENT ON FOREIGN TABLE
- GRANT/REVOKE privileges

**PostgreSQL Catalog:** `pg_class` (relkind='f') + `pg_foreign_table`

**Dependencies:** SERVER, SCHEMA

**Note:** Rename operations are not supported (handled as drop + create since stableId is name-based).

## Integration Points

### 1. Stable ID Helpers (`src/objects/utils.ts`)

Added four new stableId helper functions:
- `stableId.foreignDataWrapper(name: string)`
- `stableId.server(name: string)`
- `stableId.userMapping(server: string, user: string)`
- `stableId.foreignTable(schema: string, name: string)`

### 2. Catalog Model (`src/catalog.model.ts`)

Added properties to `Catalog` class:
- `foreignDataWrappers: Record<string, ForeignDataWrapper>`
- `servers: Record<string, Server>`
- `userMappings: Record<string, UserMapping>`
- `foreignTables: Record<string, ForeignTable>`

Added extraction functions to `extractCatalog()`:
- `extractForeignDataWrappers()`
- `extractServers()`
- `extractUserMappings()`
- `extractForeignTables()`

### 3. Catalog Diff (`src/catalog.diff.ts`)

Added diff calls in dependency order:
```typescript
// Foreign Data Wrapper objects (in dependency order)
changes.push(...diffForeignDataWrappers(diffContext, main.foreignDataWrappers, branch.foreignDataWrappers));
changes.push(...diffServers(diffContext, main.servers, branch.servers));
changes.push(...diffUserMappings(main.userMappings, branch.userMappings));
changes.push(...diffForeignTables(diffContext, main.foreignTables, branch.foreignTables));
```

Added privilege filtering for dropped objects:
- `foreign_data_wrapper`
- `server`
- `foreign_table`

### 4. Change Types (`src/change.types.ts`)

Added `ForeignDataWrapperChange` to the `Change` union type.

### 5. Filter Utils (`src/filter/utils.ts`)

Added cases for FDW objects in:
- `getSchema()` - Returns schema for foreign_table, null for others
- `getOwner()` - Returns owner for FDW/server/foreign_table, null for user_mapping

### 6. Privilege Support (`src/objects/base.privilege.ts`)

Added privilege universe entries:
- `FOREIGN DATA WRAPPER`: `["USAGE"]`
- `SERVER`: `["USAGE"]`
- `FOREIGN TABLE`: `["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]` (+ MAINTAIN for PG >= 17)

Added object kind prefix:
- `FOREIGN TABLE`: `"ON FOREIGN TABLE"`

### 7. Supabase Integration (`src/integrations/supabase.ts`)

Updated to handle null owner values (user_mapping has no owner).

## Key Implementation Details

### Options Handling

All FDW objects support OPTIONS clauses. Options are stored as arrays of strings in key-value pairs: `[key1, value1, key2, value2, ...]`.

The diff logic compares options and generates:
- `ADD` for new options
- `SET` for changed option values
- `DROP` for removed options

### Handler and Validator Functions

FDW handlers and validators are stored as function references in the format: `schema.function_name(args)`. If changed, the FDW must be recreated (drop + create) as these cannot be altered directly.

### Column Support (Foreign Tables)

Foreign tables support column operations similar to regular tables:
- ADD COLUMN
- DROP COLUMN
- ALTER COLUMN TYPE
- ALTER COLUMN SET/DROP DEFAULT
- ALTER COLUMN SET/DROP NOT NULL

Column-level OPTIONS are not yet implemented but can be added in the future.

### Rename Operations

Rename operations are **not supported** for any FDW objects because:
- Stable IDs are based on object names
- Name changes are automatically detected as drop + create by `diffObjects()`
- This is the correct behavior for maintaining referential integrity

## Testing Status

**Status:** ⚠️ **Tests Not Yet Implemented**

The following tests need to be added, following the pattern used in `src/objects/type/`:

### Unit Tests (Change Class Serialization)

Test the `serialize()` method of change classes to ensure correct SQL generation:

#### Foreign Data Wrapper
- [ ] `foreign-data-wrapper.create.test.ts` - CREATE FOREIGN DATA WRAPPER with handler, validator, options
- [ ] `foreign-data-wrapper.alter.test.ts` - ALTER FOREIGN DATA WRAPPER (OWNER TO, OPTIONS ADD/SET/DROP)
- [ ] `foreign-data-wrapper.drop.test.ts` - DROP FOREIGN DATA WRAPPER

#### Server
- [ ] `server.create.test.ts` - CREATE SERVER with type, version, options
- [ ] `server.alter.test.ts` - ALTER SERVER (OWNER TO, VERSION, OPTIONS ADD/SET/DROP)
- [ ] `server.drop.test.ts` - DROP SERVER

#### User Mapping
- [ ] `user-mapping.create.test.ts` - CREATE USER MAPPING with options, different user types (PUBLIC, CURRENT_USER, etc.)
- [ ] `user-mapping.alter.test.ts` - ALTER USER MAPPING (OPTIONS ADD/SET/DROP)
- [ ] `user-mapping.drop.test.ts` - DROP USER MAPPING

#### Foreign Table
- [ ] `foreign-table.create.test.ts` - CREATE FOREIGN TABLE with columns, options
- [ ] `foreign-table.alter.test.ts` - ALTER FOREIGN TABLE (OWNER TO, ADD/DROP COLUMN, ALTER COLUMN TYPE/DEFAULT/NOT NULL, OPTIONS)
- [ ] `foreign-table.drop.test.ts` - DROP FOREIGN TABLE

### Diff Tests

Test the diff logic for detecting changes between main and branch catalogs:

#### Foreign Data Wrapper
- [ ] `foreign-data-wrapper.diff.test.ts`
  - Create/drop detection
  - Owner changes
  - Handler/validator changes (should trigger drop + create)
  - Options changes (ADD/SET/DROP)
  - Comment changes
  - Privilege changes

#### Server
- [ ] `server.diff.test.ts`
  - Create/drop detection
  - Owner changes
  - Type changes (should trigger drop + create)
  - Version changes
  - Options changes (ADD/SET/DROP)
  - Comment changes
  - Privilege changes

#### User Mapping
- [ ] `user-mapping.diff.test.ts`
  - Create/drop detection
  - Options changes (ADD/SET/DROP)

#### Foreign Table
- [ ] `foreign-table.diff.test.ts`
  - Create/drop detection
  - Owner changes
  - Server changes (should trigger drop + create)
  - Column changes (ADD/DROP/ALTER TYPE/DEFAULT/NOT NULL)
  - Options changes (ADD/SET/DROP)
  - Comment changes
  - Privilege changes

### Integration Tests

Test full CREATE/ALTER/DROP workflows against a real PostgreSQL database:

- [ ] `foreign-data-wrapper-operations.test.ts` - Full FDW lifecycle
- [ ] `server-operations.test.ts` - Full SERVER lifecycle with FDW dependency
- [ ] `user-mapping-operations.test.ts` - Full USER MAPPING lifecycle with SERVER dependency
- [ ] `foreign-table-operations.test.ts` - Full FOREIGN TABLE lifecycle with SERVER dependency
- [ ] `fdw-dependency-ordering.test.ts` - Ensure proper dependency ordering (FDW → SERVER → USER MAPPING/FOREIGN TABLE)
- [ ] `fdw-options-operations.test.ts` - Test options ADD/SET/DROP operations
- [ ] `foreign-table-column-operations.test.ts` - Test column operations on foreign tables

## Files Created

**Total:** ~60+ files

### Models (4 files)
- `foreign-data-wrapper.model.ts`
- `server.model.ts`
- `user-mapping.model.ts`
- `foreign-table.model.ts`

### Diff Functions (4 files)
- `foreign-data-wrapper.diff.ts`
- `server.diff.ts`
- `user-mapping.diff.ts`
- `foreign-table.diff.ts`

### Change Classes (~40 files)
- Base classes (4 files)
- Create classes (4 files)
- Alter classes (4 files)
- Drop classes (4 files)
- Comment classes (3 files - user_mapping doesn't support comments)
- Privilege classes (3 files - user_mapping doesn't support privileges)
- Type union files (4 files)

### Integration Files (1 file)
- `foreign-data-wrapper.types.ts` (parent union type)

## Files Modified

1. `src/objects/utils.ts` - Added stableId helpers
2. `src/catalog.model.ts` - Added FDW objects to catalog
3. `src/catalog.diff.ts` - Added diff calls
4. `src/change.types.ts` - Added to Change union
5. `src/filter/utils.ts` - Added schema/owner getters
6. `src/objects/base.privilege.ts` - Added privilege support
7. `src/integrations/supabase.ts` - Fixed null owner handling
8. `src/sort/utils.ts` - Fixed type annotation

## PostgreSQL Documentation References

- [CREATE FOREIGN DATA WRAPPER](https://www.postgresql.org/docs/17/sql-createforeigndatawrapper.html)
- [ALTER FOREIGN DATA WRAPPER](https://www.postgresql.org/docs/17/sql-alterforeigndatawrapper.html)
- [DROP FOREIGN DATA WRAPPER](https://www.postgresql.org/docs/17/sql-dropforeigndatawrapper.html)
- [CREATE SERVER](https://www.postgresql.org/docs/17/sql-createserver.html)
- [ALTER SERVER](https://www.postgresql.org/docs/17/sql-alterserver.html)
- [DROP SERVER](https://www.postgresql.org/docs/17/sql-dropserver.html)
- [CREATE USER MAPPING](https://www.postgresql.org/docs/17/sql-createusermapping.html)
- [ALTER USER MAPPING](https://www.postgresql.org/docs/17/sql-alterusermapping.html)
- [DROP USER MAPPING](https://www.postgresql.org/docs/17/sql-dropusermapping.html)
- [CREATE FOREIGN TABLE](https://www.postgresql.org/docs/17/sql-createforeigntable.html)
- [ALTER FOREIGN TABLE](https://www.postgresql.org/docs/17/sql-alterforeigntable.html)
- [DROP FOREIGN TABLE](https://www.postgresql.org/docs/17/sql-dropforeigntable.html)

## Next Steps

1. **Add Unit Tests** - Test model extraction, change serialization, and diff logic
2. **Add Integration Tests** - Test full CREATE/ALTER/DROP workflows
3. **Column Options Support** - Add support for column-level OPTIONS in foreign tables
4. **Handler/Validator Parsing** - Parse function references to add proper dependencies

