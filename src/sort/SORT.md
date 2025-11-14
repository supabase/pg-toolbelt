# Change Sorting Algorithm

This document explains how the `sortChanges` function orders an array of `Change` objects to produce a valid migration script that respects PostgreSQL's dependency system.

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Phase Partitioning](#phase-partitioning)
4. [Dependency Graph Construction](#dependency-graph-construction)
5. [Edge Sources](#edge-sources)
6. [Topological Sorting](#topological-sorting)
7. [Key Concepts](#key-concepts)
8. [Examples](#examples)
9. [Algorithm Flow](#algorithm-flow)

## Overview

The sorting algorithm ensures that schema changes are executed in the correct order by:

1. **Respecting PostgreSQL's dependency system** - Uses `pg_depend` catalog data to understand object dependencies
2. **Handling explicit requirements** - Changes declare what they require via the `requires` getter
3. **Applying custom constraints** - Domain-specific ordering rules (e.g., ALTER DEFAULT PRIVILEGES before CREATE)
4. **Maintaining stability** - Preserves input order when dependencies don't dictate a stricter ordering

## High-Level Architecture

The algorithm operates in **two phases** that mirror how PostgreSQL applies DDL:

```
┌─────────────────────────────────────────────────────────────┐
│                    Input: Changes Array                      │
│  [Change1, Change2, Change3, Change4, Change5, ...]         │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │   Phase Partitioning    │
         └────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│  DROP Phase  │    │ CREATE/ALTER Phase   │
│  (inverted)  │    │   (forward)          │
└──────┬───────┘    └──────────┬───────────┘
       │                       │
       │  ┌─────────────────┐ │
       └─▶│ Graph Building   │◀┘
          │ & Topological    │
          │    Sort          │
          └────────┬──────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Sorted Changes Array │
        │  [Drop1, Drop2, ...   │
        │   Create1, Create2...] │
        └───────────────────────┘
```

### Why Two Phases?

- **DROP Phase**: Destructive operations must run in **reverse dependency order**. If table A depends on table B, we must drop A before B.
- **CREATE/ALTER Phase**: Constructive operations run in **forward dependency order**. If table A depends on table B, we must create B before A.

## Phase Partitioning

Changes are partitioned based on whether they have a `drops` array:

```typescript
if (change.drops.length > 0) {
  // → DROP phase (inverted edges)
} else {
  // → CREATE/ALTER phase (forward edges)
}
```

### Example Partitioning

```
Input Changes:
  [DropTable(users), CreateTable(posts), DropView(old_view), 
   CreateRole(admin), AlterTable(users)]

Partitioned:
  DROP Phase:     [DropTable(users), DropView(old_view)]
  CREATE/ALTER:   [CreateTable(posts), CreateRole(admin), AlterTable(users)]
```

## Dependency Graph Construction

For each phase, we build a **directed acyclic graph (DAG)** where:
- **Nodes** = Change indices (0, 1, 2, ...)
- **Edges** = "must run before" relationships

### Graph Data Structures

The algorithm builds several data structures to efficiently map between changes and stable IDs:

```typescript
GraphData {
  // For each change index, what stable IDs does it create?
  createdStableIdSets: [
    [0] → Set{"table:public.users", "column:public.users.id"},
    [1] → Set{"table:public.posts"},
    ...
  ]
  
  // For each change index, what stable IDs does it explicitly require?
  explicitRequirementSets: [
    [0] → Set{},  // DropTable doesn't require anything
    [1] → Set{"role:admin"},  // CreateTable requires role
    ...
  ]
  
  // Reverse index: which changes create a given stable ID?
  changeIndexesByCreatedId: {
    "table:public.users" → Set{0},
    "role:admin" → Set{2},
    ...
  }
  
  // Reverse index: which changes require a given stable ID?
  changeIndexesByExplicitRequirementId: {
    "role:admin" → Set{1, 3},
    ...
  }
  
  // From pg_depend: what depends on what?
  dependenciesByReferencedId: {
    "table:public.users" → Set{"table:public.posts"},
    ...
  }
}
```

### Stable IDs

**Stable IDs** are unique identifiers for database objects that remain constant across dumps/restores. Examples:

- `table:public.users` - a table
- `column:public.users.id` - a column
- `role:admin` - a role
- `schema:public` - a schema

Changes declare what they create and require via getters:

```typescript
class CreateTable extends Change {
  get creates(): string[] {
    return [
      this.table.stableId,  // "table:public.users"
      ...this.table.columns.map(col => col.stableId)  // column IDs
    ];
  }
  
  get requires(): string[] {
    return [stableId.role(this.table.owner)];  // "role:admin"
  }
}
```

## Edge Sources

The dependency graph is built from **three sources of edges**:

### 1. pg_depend Catalog Rows

PostgreSQL's `pg_depend` catalog tracks object dependencies. We extract these and map them to changes:

```
pg_depend row: {
  dependent_stable_id: "table:public.posts",
  referenced_stable_id: "table:public.users"
}

Meaning: posts table depends on users table

Algorithm:
  1. Filter out cycle-breaking dependencies (e.g., sequence ownership)
  2. Find changes that create "table:public.users" → [Change A]
  3. Find changes that create/require "table:public.posts" → [Change B]
  4. Check if Change B accepts the dependency
  5. Add edge: A → B (A must run before B)
```

**Cycle-Breaking Filters:**

Some dependencies in `pg_depend` create cycles that would prevent valid ordering. We filter these out before building edges:

- **Sequence Ownership Dependencies**: When a sequence is owned by a table column that also uses the sequence (via DEFAULT), `pg_depend` creates a cycle:
  - `sequence → table/column` (ownership)
  - `table/column → sequence` (column default)
  
  We filter out the ownership dependency because:
  - **CREATE phase**: Sequences should be created before tables (ownership is set via `ALTER SEQUENCE OWNED BY` after both exist)
  - **DROP phase**: Prevents cycles when dropping sequences owned by tables that aren't being dropped
  
  This filtering is done by `shouldFilterSequenceOwnershipDependency()` before edges are created.

**Visualization:**

```
pg_depend says: posts depends on users

Changes:
  [0] CreateTable(users)  creates: "table:public.users"
  [1] CreateTable(posts)  creates: "table:public.posts"

Graph Edge:
  0 ──────▶ 1
  (users)   (posts)
```

### 2. Explicit Creates/Requires Relationships

Some dependencies aren't in `pg_depend` (e.g., privileges computed from default privileges). We handle these explicitly:

```
Change A requires: ["role:admin"]
Change B creates:  ["role:admin"]

Algorithm:
  1. For each required ID in Change A
  2. Find changes that create that ID → [Change B]
  3. Check if Change A accepts the dependency
  4. Add edge: B → A (B must run before A)
```

**Visualization:**

```
Changes:
  [0] CreateRole(admin)     creates: "role:admin"
  [1] CreateTable(posts)    requires: "role:admin"

Graph Edge:
  0 ──────▶ 1
  (role)    (table)
```

### 3. Custom Constraint Specs

Domain-specific ordering rules that supplement the dependency graph:

```typescript
// Example: ALTER DEFAULT PRIVILEGES must come before CREATE statements
constraintSpecs: [{
  pairwise: (a, b) => {
    if (a is ALTER DEFAULT PRIVILEGES && b is CREATE && !b is CREATE ROLE/SCHEMA) {
      return "a_before_b";
    }
  }
}]
```

**Visualization:**

```
Changes:
  [0] AlterDefaultPrivileges(...)
  [1] CreateTable(posts)

Constraint Edge:
  0 ──────▶ 1
```

### Edge Inversion for DROP Phase

In the DROP phase, edges are **inverted**:

```
CREATE Phase (forward):
  CreateTable(users) → CreateTable(posts)
  (users must exist before posts)

DROP Phase (inverted):
  DropTable(posts) → DropTable(users)
  (posts must be dropped before users)
```

This is handled by the `invert` option:

```typescript
registerEdge(producerIndex, consumerIndex);
// In DROP phase: stores [consumerIndex, producerIndex] instead
// In CREATE phase: stores [producerIndex, consumerIndex]
```

## Topological Sorting

Once the graph is built, we perform a **stable topological sort**:

### Algorithm (Kahn's Algorithm)

1. **Build adjacency list and in-degree counts**
   ```
   Adjacency: {
     0 → [1, 2],
     1 → [3],
     2 → [3],
     3 → []
   }
   
   In-degrees: [0: 0, 1: 1, 2: 1, 3: 2]
   ```

2. **Initialize queue with zero in-degree nodes**
   ```
   Queue: [0]  (only node 0 has in-degree 0)
   ```

3. **Process nodes**
   ```
   While queue not empty:
     - Remove node with smallest index (stability)
     - Add to result
     - Decrement in-degrees of neighbors
     - Add neighbors with zero in-degree to queue (maintaining sorted order)
   ```

4. **Result**: Topologically sorted indices

### Stability

The sort is **stable**, meaning:
- When multiple nodes have zero in-degree, we pick the **smallest index first**
- This preserves the input order when dependencies don't dictate otherwise

**Example:**

```
Input order: [Change A, Change B, Change C]
Dependencies: A → C

Without stability: Could be [A, C, B] or [A, B, C]
With stability:    Always [A, B, C] (B comes before C if no dependency)
```

### Cycle Detection

If the graph contains a cycle, the algorithm detects it and throws an error:

```
Cycle detected: A → B → C → A

Error message includes:
  - Which changes are in the cycle
  - Their class names and created IDs
  - Helpful debugging information
```

## Key Concepts

### Multiple Created IDs

Some changes create multiple stable IDs (e.g., `CreateTable` creates the table + all columns). All dependencies are accepted - cycle-breaking filters are applied at the graph construction level before edges are created.

### Unknown Dependencies

Dependencies with `"unknown:"` prefix are filtered out:

```typescript
// These cannot be reliably used for ordering
"unknown:some_object"  → filtered out
```

These typically occur when objects don't exist in the catalog or cannot be uniquely identified.

## Examples

### Example 1: Simple Table Dependency

**Input:**
```typescript
[
  CreateTable(posts),      // requires: ["role:admin"]
  CreateRole(admin),       // creates: ["role:admin"]
  CreateTable(users)        // no requirements
]
```

**Graph Construction:**
```
Step 1: Build data structures
  createdStableIdSets:
    [0] → {"table:public.posts"}
    [1] → {"role:admin"}
    [2] → {"table:public.users"}
  
  explicitRequirementSets:
    [0] → {"role:admin"}
    [1] → {}
    [2] → {}

Step 2: Add edges from explicit requirements
  Change[0] requires "role:admin"
  Change[1] creates "role:admin"
  → Edge: 1 → 0

Step 3: Topological sort
  In-degrees: [0: 1, 1: 0, 2: 0]
  Queue: [1, 2] → sorted: [1, 2]
  Process 1: decrement 0 → [0: 0], add 0 to queue → [2, 0]
  Process 2: no changes
  Process 0: no changes
  Result: [1, 2, 0]
```

**Result:**
```typescript
[
  CreateRole(admin),      // First (no dependencies)
  CreateTable(users),     // Second (no dependencies, stable order)
  CreateTable(posts)      // Third (depends on role)
]
```

### Example 2: DROP Phase with Inversion

**Input:**
```typescript
[
  DropTable(users),       // drops: ["table:public.users"]
  DropTable(posts)        // drops: ["table:public.posts"]
]
```

**pg_depend (from main catalog):**
```
posts depends on users
```

**Graph Construction:**
```
Step 1: Build data structures (with invert=true)
  createdStableIdSets:
    [0] → {"table:public.users"}  // includes drops in invert mode
    [1] → {"table:public.posts"}

Step 2: Add edges from pg_depend
  posts depends on users
  → Normal edge would be: 0 → 1 (users before posts)
  → Inverted edge: 1 → 0 (posts before users)

Step 3: Topological sort
  Result: [1, 0]
```

**Result:**
```typescript
[
  DropTable(posts),   // First (drop dependent before dependency)
  DropTable(users)    // Second
]
```

### Example 3: Custom Constraint

**Input:**
```typescript
[
  CreateTable(posts),
  AlterDefaultPrivileges(...),
  CreateRole(admin)
]
```

**Constraint Spec:**
```typescript
{
  pairwise: (a, b) => {
    if (a is AlterDefaultPrivileges && b is Create && !b is CreateRole) {
      return "a_before_b";
    }
  }
}
```

**Graph Construction:**
```
Step 1: Dependency edges (none in this example)

Step 2: Constraint edges
  AlterDefaultPrivileges vs CreateTable(posts)
  → Edge: 1 → 0
  
  AlterDefaultPrivileges vs CreateRole(admin)
  → No edge (CreateRole excluded)

Step 3: Topological sort
  Result: [1, 2, 0]
```

**Result:**
```typescript
[
  AlterDefaultPrivileges(...),  // First (constraint)
  CreateRole(admin),            // Second (no dependencies)
  CreateTable(posts)            // Third (after default privileges)
]
```

## Algorithm Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ sortChanges(changes, catalogs)                              │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │ Partition into Phases   │
         │ - DROP (has drops)      │
         │ - CREATE/ALTER (else)   │
         └────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│ DROP Phase   │    │ CREATE/ALTER Phase  │
│ (invert=true)│    │ (invert=false)      │
└──────┬───────┘    └──────────┬───────────┘
       │                       │
       │  ┌─────────────────┐ │
       └─▶│ sortPhaseChanges │◀┘
          └────────┬──────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────────┐  ┌──────────────────────┐
│ buildGraphData   │  │ Build Edges:          │
│ - created IDs    │  │ 1. pg_depend          │
│ - required IDs   │  │ 2. explicit requires  │
│ - reverse indexes│  │ 3. constraint specs   │
└────────┬─────────┘  └──────────┬─────────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ dedupeEdges           │
         │ (remove duplicates)   │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ performStableTopoSort │
         │ (Kahn's algorithm)    │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Validate & Return    │
         │ - Check for cycles    │
         │ - Map indices→changes │
         └──────────────────────┘
```

### Step-by-Step Pseudocode

```python
function sortChanges(changes, catalogs):
    # 1. Partition
    drop_changes = [c for c in changes if c.drops.length > 0]
    create_changes = [c for c in changes if c.drops.length == 0]
    
    # 2. Sort each phase
    sorted_drops = sortPhaseChanges(
        drop_changes,
        catalogs.mainCatalog.depends,
        invert=True
    )
    
    sorted_creates = sortPhaseChanges(
        create_changes,
        catalogs.branchCatalog.depends,
        invert=False
    )
    
    # 3. Combine
    return sorted_drops + sorted_creates

function sortPhaseChanges(changes, dependency_rows, invert=False):
    if changes.length <= 1:
        return changes
    
    # Build graph data structures
    graph_data = buildGraphData(changes, dependency_rows, invert)
    
    edges = []
    
    # Add edges from pg_depend (with cycle-breaking filters applied)
    buildEdgesFromCatalogDependencies(
        dependency_rows, changes, graph_data, edges
    )
    
    # Add edges from explicit requirements
    buildEdgesFromExplicitRequirements(changes, graph_data, edges)
    
    # Add edges from constraints
    edges += generateConstraintEdges(changes, constraint_specs)
    
    # Deduplicate
    edges = dedupeEdges(edges)
    
    # Topological sort
    sorted_indices = performStableTopologicalSort(
        changes.length, edges
    )
    
    # Validate
    if sorted_indices.length != changes.length:
        throw CycleError
    
    # Map indices to changes
    return [changes[i] for i in sorted_indices]
```

## Summary

The sorting algorithm:

1. **Partitions** changes into DROP and CREATE/ALTER phases
2. **Builds** a dependency graph from three sources:
   - PostgreSQL's `pg_depend` catalog (with cycle-breaking filters applied)
   - Explicit `creates`/`requires` declarations
   - Custom constraint specs
3. **Filters** cycle-causing dependencies before building edges (e.g., sequence ownership dependencies)
4. **Inverts** edges in the DROP phase
5. **Sorts** topologically while preserving input order (stability)
6. **Validates** for cycles and provides helpful error messages

This approach ensures migrations execute in the correct order while staying aligned with PostgreSQL's native dependency system and handling edge cases that would create cycles.

