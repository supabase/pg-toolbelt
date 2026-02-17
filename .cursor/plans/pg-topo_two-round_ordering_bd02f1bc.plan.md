---
name: pg-topo two-round ordering
overview: "The two-round apply happens because pg-topo's topological order is missing dependency edges: public views/functions that reference auth.can() and public tables/views are executed before those dependencies in the flattened statement list. There is no circular dependency; the graph is acyclic but under-specified."
todos: []
isProject: false
---

# Why pg-topo Produces Two Rounds (No Circular Dependency)

## What’s happening

- **Round 1:** 1871 statements applied, **65 deferred** (dependency errors).
- **Round 2:** Those 65 applied successfully.
- So the dependency graph is **acyclic** (no cycle); the issue is that the **order** used in round 1 is wrong for those 65 statements.

## Where ordering comes from

Ordering is **entirely** from **pg-topo**; pg-delta does not re-sort.

1. [src/core/declarative-apply/index.ts](src/core/declarative-apply/index.ts): `analyzeAndSortFromFiles([schemaPath])` returns `ordered: StatementNode[]`.
2. That array is turned into `StatementEntry[]` and passed to `roundApply()`.
3. [round-apply.ts](src/core/declarative-apply/round-apply.ts) runs statements **in array order**; on dependency errors (42P01, 42704, 42883, etc.) it defers to the next round.

So if 65 statements are deferred, pg-topo’s **topological order** is putting them **before** their dependencies in the flat list.

## What the 65 deferred statements depend on

From the dogfooding log, the deferred items fail because:

1. **auth schema functions**
  - `auth.can(bigint, text, auth.action)` and `auth.can_project(...)` “do not exist”.
  - Failures: `schemas/public/views/billing.sql`, `custom.sql`, `invoices.sql`, `keys.sql`, `members.sql`, `project.sql`, `subscription_usage_exceeded.sql` (and public functions that use those views).
2. **public schema objects**
  - `public.projects`, `public.members`, `public.billing_*`, `public.gotrue_config`, etc. “do not exist”.
  - Failures: same views plus `schemas/public/tables/project.sql`, `owner_reassign.sql`, `user.sql`, and public functions (billing, gotrue_config, project, etc.).

So in pg-topo’s order we effectively have:

- Some **public** views/functions/tables running **before**:
  - `auth.can` / `auth.can_project` (auth schema), and/or
  - `public.projects`, `public.members`, billing views, etc.

That implies **missing edges** in the dependency graph pg-topo uses for the topological sort, not a cycle.

## Why edges are likely missing (root cause)

pg-topo builds a dependency graph from the SQL and then topologically sorts. For the order to be wrong, some “dependent → dependency” edges must be absent.

**Cross-schema / view-body references:**

- Example: [declarative-schemas/schemas/public/views/billing.sql](declarative-schemas/schemas/public/views/billing.sql) defines views that call `auth.can(...)` and `auth.gotrue_id()` in the view body.
- For correct order, pg-topo would need to:
  - Parse the **body** of each view/function.
  - Resolve calls like `auth.can(...)` to the object `auth.can` and add an edge: “this view depends on auth.can”.
- If pg-topo does **not** extract dependencies from view/function **bodies** (e.g. only from object signatures or same-file refs), then:
  - There is **no edge** from “public.billing_customers view” → “auth.can”.
  - In the topological sort, the view and `auth.can` are unordered relative to each other; their order is then decided by a **tie-breaker** (e.g. file path, discovery order).
  - That tie-breaker can put public views before auth schema functions, causing the 65 deferrals.

**Same-schema / table order:**

- Errors like `relation "public.projects" does not exist` in `schemas/public/tables/project.sql` suggest either:
  - Statements **within** the same file are ordered so that a later statement (e.g. constraint/trigger) runs before the CREATE TABLE that defines `public.projects`, or
  - Different files: something that references `public.projects` runs before the file that creates it.
- Again, that’s consistent with missing or incomplete edges (e.g. “constraint/trigger depends on table X”) rather than a cycle.

So the most plausible root cause is **incomplete dependency extraction** in pg-topo (e.g. no or limited cross-schema/view-body/function-body dependency detection), leading to an under-constrained graph and a topological order that violates real dependencies.

## Summary diagram

```mermaid
flowchart LR
  subgraph pg_topo ["pg-topo"]
    A[Analyze SQL files]
    B[Build dependency graph]
    C[Topological sort]
    A --> B --> C
  end
  subgraph pg_delta ["pg-delta"]
    D[ordered StatementNode[]]
    E[roundApply in order]
    D --> E
  end
  C -->|"ordered (missing edges → wrong order)"| D
  E -->|"Round 1: 65 dependency errors"| F[Defer to Round 2]
  F --> E
```



- **No cycle:** Round 2 succeeds; the real dependency graph is acyclic.
- **Wrong order:** In round 1, 65 statements run before their dependencies because pg-topo’s graph is missing edges (e.g. view → auth.can, view → public.projects).

## What you can do

1. **Inspect pg-topo (if you have the repo)**
  - Check how it builds the graph: does it parse view/function bodies and add edges for `auth.can`, `public.projects`, etc.?  
  - Check tie-breaking when two nodes are not comparable (e.g. file path order).
2. **Improve pg-topo**
  - Add (or fix) extraction of cross-schema and view/function-body references so that:
    - “public view that calls auth.can()” depends on “auth.can”,
    - “public object that references public.projects” depends on “public.projects”.
  - Then the existing topological sort should put dependencies before dependents and reduce or remove round-2 deferrals.
3. **Optional: re-order in pg-delta**
  - If pg-topo cannot be changed soon, you could add a post-pass that:
    - Infers extra dependencies (e.g. from view/function body parsing in pg-delta), and  
    - Re-sorts the flat list (e.g. stable topological sort with these extra edges).
  - This duplicates some of pg-topo’s responsibility and may be brittle.
4. **Document / accept**
  - Document that multi-round apply is expected when the schema has cross-schema or view-body dependencies that pg-topo doesn’t model.  
  - The round-based engine is already the safety net; two rounds is correct behavior given the current ordering.

## Conclusion

- **There is no circular dependency;** the schema is acyclic and round 2 succeeds.  
- **pg-topo’s topological order is wrong** for 65 statements because the dependency graph it uses is **missing edges** (likely cross-schema and view/function-body references).  
- Fixing or extending pg-topo’s dependency extraction (so that view → auth.can and similar are modeled) is the direct way to get a single-round apply when the graph is acyclic.

