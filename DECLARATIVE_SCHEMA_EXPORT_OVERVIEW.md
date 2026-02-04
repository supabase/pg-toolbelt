# Declarative Schema Export - Implementation Overview

This document provides a comprehensive overview of the declarative schema export feature implementation for pg-delta.

---

## Executive Summary

The declarative schema export feature enables pg-delta to generate organized, executable SQL files from database schemas. Instead of producing migration diffs, this mode exports the complete schema as a structured file hierarchy, suitable for version control and declarative database management.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Declarative Schema Export                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐ │
│  │   Source     │    │   Target     │    │    Diff      │    │  Export   │ │
│  │   Database   │───▶│   Database   │───▶│   Engine     │───▶│  Module   │ │
│  │  (empty)     │    │  (schema)    │    │              │    │           │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └─────┬─────┘ │
│                                                                     │       │
│                                         ┌───────────────────────────┘       │
│                                         ▼                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                    DeclarativeSchemaOutput (JSON)                      │ │
│  │  {                                                                     │ │
│  │    version: 1,                                                         │ │
│  │    mode: "declarative",                                                │ │
│  │    files: [{ path, order, sql, metadata }, ...]                       │ │
│  │  }                                                                     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Output File Structure

The exported schema follows a hierarchical organization:

```
output/
├── cluster/                          # Cluster-wide objects
│   ├── roles.sql                     # Database roles
│   ├── extensions.sql                # PostgreSQL extensions
│   ├── foreign_data_wrappers.sql     # FDW, servers, user mappings
│   ├── publications.sql              # Logical replication publishers
│   ├── subscriptions.sql             # Logical replication subscribers
│   ├── event_triggers.sql            # Event triggers
│   └── languages.sql                 # Procedural languages
│
├── schemas/
│   └── {schema_name}/                # Per-schema organization
│       ├── schema.sql                # Schema definition + privileges
│       │
│       ├── types/                    # Custom types
│       │   └── {type_name}.sql
│       │
│       ├── domains/                  # Domain types
│       │   └── {domain_name}.sql
│       │
│       ├── sequences/                # Sequences
│       │   └── {sequence_name}.sql
│       │
│       ├── tables/                   # Tables with constraints
│       │   └── {table_name}.sql
│       │
│       ├── foreign_tables/           # Foreign tables
│       │   └── {foreign_table_name}.sql
│       │
│       ├── views/                    # Regular views
│       │   └── {view_name}.sql
│       │
│       ├── matviews/                 # Materialized views
│       │   └── {matview_name}.sql
│       │
│       ├── functions/                # Functions
│       │   └── {function_name}.sql
│       │
│       ├── procedures/               # Stored procedures
│       │   └── {procedure_name}.sql
│       │
│       ├── aggregates/               # Aggregate functions
│       │   └── {aggregate_name}.sql
│       │
│       ├── indexes/                  # Indexes (standalone)
│       │   └── {index_name}.sql
│       │
│       └── policies/                 # Policies, triggers, FK constraints
│           └── {object_name}.sql     # Deferred dependency objects
│
└── collations/                       # Collation definitions
    └── {collation_name}.sql
```

---

## Task Dependency Graph

```
                                    ┌─────────────────────────────────────┐
                                    │                                     │
                                    ▼                                     │
┌───────────────────────────────────────────────────────────────────┐    │
│  Task 1: Create TypeScript Interfaces                             │    │
│  ────────────────────────────────────────────────────────────────  │    │
│  • DeclarativeSchemaOutput interface                              │    │
│  • FileEntry interface                                            │    │
│  • FileMetadata interface                                         │    │
│  • FileCategory type + CATEGORY_PRIORITY                          │    │
│  Location: src/core/export/types.ts                               │    │
│  Status: PENDING | Priority: HIGH                                 │    │
└───────────────────────────────────────────────────────────────────┘    │
                    │                                                     │
                    ▼                                                     │
┌───────────────────────────────────────────────────────────────────┐    │
│  Task 2: Implement File Path Mapper                               │    │
│  ────────────────────────────────────────────────────────────────  │    │
│  • getFilePath() function                                         │    │
│  • Object type → file path mapping                                │    │
│  • Category classification                                        │    │
│  Location: src/core/export/file-mapper.ts                         │    │
│  Status: PENDING | Priority: HIGH | Depends: [1]                  │    │
└───────────────────────────────────────────────────────────────────┘    │
                    │                                                     │
                    ▼                                                     │
┌───────────────────────────────────────────────────────────────────┐    │
│  Task 3: Implement Change Grouping & Ordering                     │    │
│  ────────────────────────────────────────────────────────────────  │    │
│  • Group changes by file path                                     │    │
│  • Order by category priority                                     │    │
│  • Topological ordering within categories                         │    │
│  Location: src/core/export/grouper.ts                             │    │
│  Status: PENDING | Priority: MEDIUM | Depends: [1, 2]             │    │
└───────────────────────────────────────────────────────────────────┘    │
                    │                                                     │
                    ▼                                                     │
┌───────────────────────────────────────────────────────────────────┐    │
│  Task 4: Implement exportDeclarativeSchema()                      │    │
│  ────────────────────────────────────────────────────────────────  │    │
│  • Filter CREATE operations only                                  │    │
│  • Apply serialization DSL                                        │    │
│  • Generate fingerprints                                          │    │
│  • Assemble JSON output                                           │    │
│  Location: src/core/export/index.ts                               │    │
│  Status: PENDING | Priority: HIGH | Depends: [1, 2, 3]            │    │
└───────────────────────────────────────────────────────────────────┘    │
                    │                                                     │
        ┌───────────┴───────────────────────────────┐                    │
        ▼                                           ▼                    │
┌─────────────────────────────┐     ┌─────────────────────────────────┐  │
│  Task 9: Export Public API  │     │  Task 5: Test Helper            │  │
│  ─────────────────────────  │     │  ───────────────────────────    │  │
│  • Update src/index.ts      │     │  • testDeclarativeExport()      │  │
│  • Update package.json      │     │  • Execution validation         │  │
│  Status: PENDING | MED      │     │  • Fingerprint verification     │  │
│  Depends: [4]               │     │  Location: tests/integration/   │  │
└─────────────────────────────┘     │  Status: PENDING | MED          │  │
        │                           │  Depends: [4]                   │  │
        ▼                           └─────────────────────────────────┘  │
┌─────────────────────────────┐                     │                    │
│  Task 10: Documentation     │                     ▼                    │
│  ─────────────────────────  │     ┌─────────────────────────────────┐  │
│  • JSDoc comments           │     │  Task 6: Simple Schema Tests    │  │
│  • Usage examples           │     │  ───────────────────────────    │  │
│  Status: PENDING | LOW      │     │  • Tables, indexes              │  │
│  Depends: [9]               │     │  • Basic object types           │  │
└─────────────────────────────┘     │  Location: tests/integration/   │  │
                                    │  Status: PENDING | HIGH         │  │
                                    │  Depends: [5]                   │  │
                                    └─────────────────────────────────┘  │
                                                    │                    │
                                                    ▼                    │
                                    ┌─────────────────────────────────┐  │
                                    │  Task 7: Complex Dep Tests      │  │
                                    │  ───────────────────────────    │  │
                                    │  • Foreign keys                 │  │
                                    │  • Triggers                     │  │
                                    │  • RLS policies                 │  │
                                    │  • Partitioned tables           │  │
                                    │  Status: PENDING | HIGH         │  │
                                    │  Depends: [6]                   │  │
                                    └─────────────────────────────────┘  │
                                                    │                    │
                                                    ▼                    │
                                    ┌─────────────────────────────────┐  │
                                    │  Task 8: Edge Cases             │──┘
                                    │  ───────────────────────────    │
                                    │  • All 20+ object types         │
                                    │  • Complete coverage            │
                                    │  Status: PENDING | MEDIUM       │
                                    │  Depends: [2, 7]                │
                                    └─────────────────────────────────┘
```

---

## Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           Data Flow Pipeline                               │
└────────────────────────────────────────────────────────────────────────────┘

     Source DB            Target DB
   (empty state)        (with schema)
         │                    │
         ▼                    ▼
    ┌─────────────────────────────────────┐
    │        extractCatalog()             │
    │   (pg_catalog metadata extraction)  │
    └─────────────────────────────────────┘
         │                    │
         ▼                    ▼
    ┌─────────┐          ┌─────────┐
    │ Catalog │          │ Catalog │
    │ (empty) │          │ (full)  │
    └─────────┘          └─────────┘
         │                    │
         └────────┬───────────┘
                  ▼
    ┌─────────────────────────────────────┐
    │          diffCatalogs()             │
    │      (generates Change objects)     │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │         Change[] (all types)        │
    │   CREATE / ALTER / DROP operations  │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │     Filter: CREATE operations       │
    │  (declarative mode only)            │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │         sortChanges()               │
    │   (topological dependency order)    │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │         getFilePath()               │      ┌─────────────────────────┐
    │   (maps each change to file)        │─────▶│  FilePath {             │
    │                                     │      │    path: string,        │
    └─────────────────────────────────────┘      │    category: string,    │
                  │                              │    metadata: {...}      │
                  ▼                              │  }                      │
    ┌─────────────────────────────────────┐      └─────────────────────────┘
    │      groupChangesByFile()           │
    │   (groups by path, orders by        │
    │    category + topo position)        │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │      applySerializationOptions()    │
    │   (customize SQL generation)        │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │      change.serialize()             │
    │   (generates SQL statements)        │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌─────────────────────────────────────┐
    │     buildPlanScopeFingerprint()     │
    │   (source + target fingerprints)    │
    └─────────────────────────────────────┘
                  │
                  ▼
    ┌───────────────────────────────────────────────────────────────────────┐
    │                     DeclarativeSchemaOutput                           │
    │  {                                                                    │
    │    version: 1,                                                        │
    │    mode: "declarative",                                               │
    │    generatedAt: "2024-...",                                          │
    │    source: { fingerprint: "abc123..." },                             │
    │    target: { fingerprint: "def456..." },                             │
    │    files: [                                                           │
    │      { path: "cluster/extensions.sql", order: 0, sql: "...", ... },  │
    │      { path: "schemas/public/tables/users.sql", order: 1, ... },     │
    │      ...                                                              │
    │    ]                                                                  │
    │  }                                                                    │
    └───────────────────────────────────────────────────────────────────────┘
```

---

## File Category Priority (Execution Order)

The following priority determines the order in which file categories are executed:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Execution Order (Lower = Earlier)                                   │
├────────┬──────────────────┬──────────────────────────────────────────┤
│ Order  │ Category         │ Description                              │
├────────┼──────────────────┼──────────────────────────────────────────┤
│   0    │ cluster          │ Roles, extensions, FDW, etc.             │
│   1    │ schema           │ Schema definitions                       │
│   2    │ types            │ Custom types, enums                      │
│   3    │ sequences        │ Sequences                                │
│   4    │ tables           │ Table definitions                        │
│   5    │ foreign_tables   │ Foreign tables                           │
│   6    │ views            │ Regular views                            │
│   7    │ matviews         │ Materialized views                       │
│   8    │ functions        │ Functions                                │
│   9    │ procedures       │ Stored procedures                        │
│  10    │ aggregates       │ Aggregate functions                      │
│  11    │ domains          │ Domain types                             │
│  12    │ collations       │ Collations                               │
│  13    │ indexes          │ Indexes                                  │
│  14    │ policies         │ RLS policies, triggers, FK constraints   │
└────────┴──────────────────┴──────────────────────────────────────────┘
```

---

## Core Interfaces

### DeclarativeSchemaOutput

```typescript
interface DeclarativeSchemaOutput {
  version: 1;
  mode: "declarative";
  generatedAt: string;           // ISO 8601 timestamp
  source: { fingerprint: string };
  target: { fingerprint: string };
  files: FileEntry[];
}
```

### FileEntry

```typescript
interface FileEntry {
  path: string;      // e.g., "schemas/public/tables/users.sql"
  order: number;     // Execution order (0-indexed)
  statements: number; // Count of SQL statements
  sql: string;       // Actual SQL content
  metadata: FileMetadata;
}
```

### FileMetadata

```typescript
interface FileMetadata {
  objectType: string;     // e.g., "table", "index", "view"
  schemaName?: string;    // Present for schema-scoped objects
  objectName?: string;    // Present for named objects
}
```

---

## Module Structure

```
src/core/export/
├── index.ts          # Main entry: exportDeclarativeSchema()
├── types.ts          # TypeScript interfaces
├── file-mapper.ts    # getFilePath() - object → path mapping
└── grouper.ts        # groupChangesByFile() - grouping & ordering
```

---

## Task Summary Table

| ID | Title | Priority | Status | Dependencies |
|----|-------|----------|--------|--------------|
| 1 | Create TypeScript interfaces | HIGH | PENDING | - |
| 2 | Implement file path mapper | HIGH | PENDING | 1 |
| 3 | Implement change grouping & ordering | MEDIUM | PENDING | 1, 2 |
| 4 | Implement exportDeclarativeSchema() | HIGH | PENDING | 1, 2, 3 |
| 5 | Create integration test helper | MEDIUM | PENDING | 4 |
| 6 | Write integration tests (simple) | HIGH | PENDING | 5 |
| 7 | Write integration tests (complex deps) | HIGH | PENDING | 6 |
| 8 | Handle edge cases for all object types | MEDIUM | PENDING | 2, 7 |
| 9 | Export public API | MEDIUM | PENDING | 4 |
| 10 | Write documentation | LOW | PENDING | 9 |

---

## Implementation Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Phase 1: Foundation                                │
│                                                                             │
│  Tasks: 1, 2                                                                │
│  Goal: Establish type system and core mapping logic                         │
│                                                                             │
│  Deliverables:                                                              │
│  • src/core/export/types.ts (interfaces, categories)                        │
│  • src/core/export/file-mapper.ts (getFilePath function)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Phase 2: Core Logic                                │
│                                                                             │
│  Tasks: 3, 4                                                                │
│  Goal: Implement grouping, ordering, and main export function               │
│                                                                             │
│  Deliverables:                                                              │
│  • src/core/export/grouper.ts (grouping & ordering)                         │
│  • src/core/export/index.ts (exportDeclarativeSchema)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Phase 3: Testing                                   │
│                                                                             │
│  Tasks: 5, 6, 7                                                             │
│  Goal: Validate functionality with comprehensive tests                      │
│                                                                             │
│  Deliverables:                                                              │
│  • Test helper in tests/integration/roundtrip.ts                            │
│  • tests/integration/declarative-schema-export.test.ts                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Phase 4: Polish                                    │
│                                                                             │
│  Tasks: 8, 9, 10                                                            │
│  Goal: Complete coverage, public API, documentation                         │
│                                                                             │
│  Deliverables:                                                              │
│  • All 20+ object types handled                                             │
│  • Public exports in src/index.ts                                           │
│  • JSDoc documentation                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Subtasks Breakdown

### Task 1: Create TypeScript Interfaces (5 subtasks)
1. Create export directory and types.ts file
2. Define core DeclarativeSchemaOutput interface
3. Define FileEntry and FileMetadata interfaces
4. Define FileCategory type and CATEGORY_PRIORITY mapping
5. Add type exports and documentation comments

### Task 2: Implement File Path Mapper (4 subtasks)
1. Implement core getFilePath function with cluster object mappings
2. Add schema-scoped object mappings to getFilePath switch
3. Implement child object mappings and special policy detection
4. Complete exhaustive switch with remaining objects and never check

### Task 3: Implement Change Grouping & Ordering (3 subtasks)
1. Implement file grouping logic with Map structure
2. Implement two-level sorting by category priority and topological position
3. Create comprehensive unit tests for grouping and ordering

### Task 4: Implement exportDeclarativeSchema() (4 subtasks)
1. Implement CREATE operation filtering logic
2. Integrate serialization DSL with grouped changes
3. Generate source and target fingerprints
4. Assemble DeclarativeSchemaOutput JSON structure

### Task 5: Create Integration Test Helper (3 subtasks)
1. Basic test helper structure with catalog extraction and change generation
2. File execution validation on fresh database
3. Fingerprint verification of final state

### Task 6: Write Integration Tests (Simple) (3 subtasks)
1. Create test file and implement basic object tests
2. Add cluster-wide object tests
3. Add schema-scoped object tests for views and functions

### Task 7: Write Integration Tests (Complex Deps) (5 subtasks)
1. Write integration test for foreign key constraints in policies/
2. Write integration test for triggers in policies/
3. Write integration test for RLS policies in policies/
4. Write integration test for partitioned tables with dependencies
5. Write integration test for materialized views with indexes

### Task 8: Handle Edge Cases (6 subtasks)
1. Implement cluster-wide object mappings (roles, extensions, languages)
2. Implement foreign data wrapper ecosystem mappings
3. Implement cluster replication and event trigger mappings
4. Implement schema-scoped parent object mappings (tables, views, foreign tables)
5. Implement type system and domain mappings
6. Implement child objects and special case mappings (indexes, triggers, policies, FK constraints)

### Task 9: Export Public API (5 subtasks)
1. Add declarative schema exports to src/index.ts
2. Update package.json exports field with subpath export
3. Run TypeScript build and verify compilation
4. Verify generated type definitions in dist/index.d.ts
5. Create import validation test file

### Task 10: Write Documentation (3 subtasks)
1. Add comprehensive JSDoc comments to public API
2. Add inline code comments explaining design decisions
3. Validate documentation completeness and accuracy

---

## Critical Path

The critical path through the dependency graph:

```
Task 1 ──▶ Task 2 ──▶ Task 3 ──▶ Task 4 ──▶ Task 5 ──▶ Task 6 ──▶ Task 7 ──▶ Task 8
  │                                           │
  │                                           └──▶ Task 9 ──▶ Task 10
  │
  └── Foundation layer that everything depends on
```

**Critical path tasks**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

---

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|------------|
| Circular dependencies in object types | Files may execute out of order | Use deferred constraints, policies folder for late-binding objects |
| Missing object type mappings | Incomplete exports | Task 8 ensures exhaustive coverage with TypeScript never check |
| SQL statement ordering within files | Invalid DDL sequences | Preserve topological order from sortChanges() |
| Cross-schema dependencies | Schema creation order issues | Category priority ensures schemas created before their objects |

---

## Success Criteria

1. **Correctness**: Exported SQL files execute successfully on an empty database
2. **Completeness**: All 20+ PostgreSQL object types are properly mapped
3. **Ordering**: Dependency order is preserved across and within files
4. **Idempotency**: Re-running export produces identical output (same fingerprint)
5. **Integration**: Public API is exported and documented

---

*Generated from task-master tasks for pg-delta declarative schema export feature*
