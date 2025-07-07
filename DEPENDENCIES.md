# PostgreSQL Schema Dependencies

This document explains how dependencies are handled in the PostgreSQL schema inspection system, specifically in the `pgkit` package's `schemainspect` module.

## Overview

The dependency system tracks relationships between database objects to ensure proper ordering during schema operations (creation, modification, deletion). It uses a directed graph representation where nodes are database objects and edges represent dependencies.

## Core Concepts

### Dependency Types

1. **Direct Dependencies** (`dependent_on`): Objects that this object depends on
2. **Reverse Dependencies** (`dependents`): Objects that depend on this object
3. **Transitive Dependencies** (`dependent_on_all`, `dependents_all`): All dependencies reachable through the dependency graph

### Database Objects with Dependencies

The following object types participate in the dependency system:

- **Selectables**: Tables, views, materialized views, composite types, functions
- **Enums**: Enum types
- **Triggers**: Database triggers
- **Constraints**: Foreign key constraints (optional)

## Dependency Discovery

### 1. SQL Query-Based Discovery (`DEPS_QUERY`)

The primary dependency discovery mechanism uses PostgreSQL's system catalogs:

```sql
-- Core dependency query (simplified)
WITH things AS (
  -- Collect all relevant objects (functions, relations)
  SELECT oid, schema, name, identity_arguments, kind
  FROM pg_proc, pg_class, pg_namespace
  WHERE kind IN ('r', 'v', 'm', 'c', 'f')
),
combined AS (
  -- Find dependencies through pg_depend and pg_rewrite
  SELECT t.*, things_dependent_on.*
  FROM pg_depend d
  INNER JOIN things things_dependent_on ON d.refobjid = things_dependent_on.objid
  INNER JOIN pg_rewrite rw ON d.objid = rw.oid
  INNER JOIN things t ON rw.ev_class = t.objid
  WHERE d.deptype = 'n' AND rw.rulename = '_RETURN'
)
```

This query discovers dependencies by:
- Examining `pg_depend` system catalog for object dependencies
- Using `pg_rewrite` to connect dependencies to specific database objects
- Filtering for normal dependencies (`deptype = 'n'`)
- Focusing on `_RETURN` rules which represent object definitions

### 2. Schema-Based Discovery

Additional dependencies are discovered through schema analysis:

#### Enum Dependencies
```typescript
// When a column uses an enum type
if (c.is_enum) {
  const e_sig = c.enum.signature
  if (e_sig in this.enums) {
    r.dependent_on.push(e_sig)
    c.enum.dependents.push(k)
  }
}
```

#### Inheritance Dependencies
```typescript
// When a table inherits from another table
if (r.parent_table) {
  const pt = this.relations[r.parent_table]
  r.dependent_on.push(r.parent_table)
  pt.dependents.push(r.signature)
}
```

#### Trigger Dependencies
```typescript
// Triggers depend on their target tables
for (const [k, t] of Object.entries(this.triggers)) {
  for (const dep_name of t.dependent_on) {
    const dependency = this.selectables[dep_name]
    dependency?.dependents.push(k)
  }
}
```

## Dependency Loading Process

### Phase 1: `load_deps()`

1. **Execute DEPS_QUERY** to get raw dependency data
2. **Process each dependency**:
   - Create signatures for both dependent and dependency objects
   - Add direct dependencies to `dependent_on` arrays
   - Add reverse dependencies to `dependents` arrays
   - Sort arrays for consistency
3. **Handle special cases**:
   - Enum column dependencies
   - Table inheritance dependencies
   - Trigger dependencies

### Phase 2: `load_deps_all()`

1. **Calculate transitive dependencies** using recursive traversal
2. **Build `dependent_on_all`** and `dependents_all` arrays
3. **Sort results** for consistent ordering

```typescript
const get_related_for_item = (
  item: InspectedSelectable | InspectedTrigger | InspectedEnum,
  att: 'dependent_on' | 'dependents',
): string[] => {
  const related = item[att].map((child: string) => 
    this.get_dependency_by_signature(child)
  )
  return [item.signature, ...related.flatMap(d => 
    get_related_for_item(d, att)
  )]
}
```

## Topological Sorting

### Purpose
Topological sorting provides a safe ordering for operations that respect dependencies:
- **Creation order**: Dependencies before dependents
- **Deletion order**: Dependents before dependencies

### Implementation

The `dependency_order()` method uses a `TopologicalSorter` class:

```typescript
dependency_order({
  drop_order = false,
  selectables = true,
  triggers = true,
  enums = true,
  include_fk_deps = false,
} = {}): string[]
```

#### TopologicalSorter Algorithm

1. **Graph Construction**: Build adjacency list from dependency relationships
2. **Cycle Detection**: Detect circular dependencies using DFS
3. **Topological Sort**: Use Kahn's algorithm:
   - Find nodes with no incoming edges (ready nodes)
   - Remove ready nodes and their outgoing edges
   - Repeat until all nodes are processed

#### States
- `_NODE_OUT = -1`: Node has been passed out (ready)
- `_NODE_DONE = -2`: Node has been processed (done)
- `>= 0`: Number of unprocessed predecessors

## Signature Generation

Dependencies are identified using object signatures:

```typescript
const parenthesize = (expr: string) => (expr ? `(${expr})` : '')
const x = `${quoted_identifier(dep.name, dep.schema)}${parenthesize(dep.identity_arguments)}`
```

### Signature Formats
- **Tables/Views**: `"schema"."name"`
- **Functions**: `"schema"."name"(arg1, arg2)`
- **Enums**: `"schema"."name"`

## Dependency Categories

### 1. Object Dependencies
- Views depend on their underlying tables/functions
- Materialized views depend on their query sources
- Functions depend on types, operators, and other functions

### 2. Type Dependencies
- Columns using enum types depend on those enums
- Composite types depend on their component types

### 3. Structural Dependencies
- Child tables depend on parent tables (inheritance)
- Partitioned tables depend on their partition definitions

### 4. Constraint Dependencies (Optional)
- Foreign key constraints create table-to-table dependencies
- Controlled by `include_fk_deps` parameter

## Error Handling

### Circular Dependencies
The system detects circular dependencies and throws `CycleError`:

```typescript
const cycle = this._find_cycle()
if (cycle) {
  throw new CycleError('nodes are in a cycle', cycle)
}
```

### Missing Dependencies
Graceful handling of missing dependency objects:

```typescript
try {
  this.selectables[x_dependent_on].dependents.push(x)
  this.selectables[x_dependent_on].dependents.sort()
} catch {
  // pass - dependency object may not exist
}
```

## Usage Examples

### Creating Objects in Dependency Order
```typescript
const inspector = await PostgreSQL.create(connection)
const creationOrder = inspector.dependency_order({ drop_order: false })
// Use creationOrder to create objects safely
```

### Dropping Objects in Reverse Dependency Order
```typescript
const dropOrder = inspector.dependency_order({ drop_order: true })
// Use dropOrder to drop objects safely
```

### Checking Object Dependencies
```typescript
const table = inspector.tables['"public"."users"']
console.log('Dependencies:', table.dependent_on)
console.log('Dependents:', table.dependents)
console.log('All dependencies:', table.dependent_on_all)
```

## Performance Considerations

1. **Query Optimization**: DEPS_QUERY uses efficient joins and filtering
2. **Caching**: Dependencies are calculated once during inspection
3. **Memory Usage**: Transitive dependencies can be large for complex schemas
4. **Sorting**: Arrays are sorted for consistent behavior

## Limitations

1. **Extension Objects**: Dependencies on extension objects are excluded
2. **Internal Schemas**: Dependencies in system schemas are filtered out
3. **Dynamic Dependencies**: Runtime dependencies (e.g., dynamic SQL) are not captured
4. **Cross-Database**: Dependencies across different databases are not supported

## Future Enhancements

1. **Incremental Updates**: Support for updating dependencies without full re-inspection
2. **Dependency Validation**: Tools to validate dependency consistency
3. **Visualization**: Graph visualization of dependency relationships
4. **Performance Metrics**: Dependency analysis performance monitoring 