# pg-toolbelt

PostgreSQL tooling for comparing schemas, planning migrations, and ordering DDL safely. This context captures the project language used when discussing pg-delta migration planning and dependency-cycle handling.

## Language

**Migration plan**:
An ordered set of DDL changes that transforms a source database schema into a target database schema.
_Avoid_: Script, diff output

**Change**:
A single schema operation emitted by a diff, carrying the stable identifiers it creates, drops, or requires.
_Avoid_: Statement, when referring to the typed operation before serialization

**Stable identifier**:
An environment-independent name for a schema object used to connect changes to catalog dependencies.
_Avoid_: OID

**Dependency cycle**:
A cycle in the migration-plan dependency graph that prevents topological ordering.
_Avoid_: Circular diff

**Structural normalization**:
A deterministic rewrite of the final change list before dependency sorting.
_Avoid_: Cycle breaker

**Cycle-breaking change injection**:
A sort-phase rewrite that injects or rebuilds changes after an unbreakable dependency cycle is detected.
_Avoid_: Post-diff normalization, when the fix is specific to a detected graph cycle

**Publication FK-chain constraint-drop cycle**:
A dependency cycle where publication membership is being removed for dropped tables, those dropped tables carry a foreign-key chain, and the chain ends at a separately dropped referenced constraint.
_Avoid_: Publication drop cycle, dropped-table publication membership cycle

**FK constraint-drop injection**:
Cycle-breaking change injection that creates explicit foreign-key constraint drops and makes table drops stop claiming those constraint stable identifiers.
_Avoid_: Relaxed publication requirement, when resolving dropped-table publication membership cycles

## Relationships

- A **Migration plan** contains one or more **Changes**.
- A **Change** names the **Stable identifiers** it creates, drops, or requires.
- **Structural normalization** happens before dependency sorting and does not inspect a specific cycle path.
- **Cycle-breaking change injection** happens during dependency sorting and responds to a concrete **Dependency cycle**.
- A **Publication FK-chain constraint-drop cycle** is resolved by **Cycle-breaking change injection**, not by structural normalization.
- A **Publication FK-chain constraint-drop cycle** is resolved with **FK constraint-drop injection** while leaving publication membership and referenced-constraint drop changes unchanged.
- In a **Publication FK-chain constraint-drop cycle**, the terminal referenced-constraint drop table must be part of the publication membership being removed.
- **FK constraint-drop injection** for a **Publication FK-chain constraint-drop cycle** is cycle-local: inject only FK drops that point to a dropped table in the cycle or to the terminal referenced constraint being dropped.
- **FK constraint-drop injection** can be shared by multiple cycle breakers; each breaker still owns its own matcher and safety checks.

## Example dialogue

> **Dev:** "Should this publication/table drop issue be handled by structural normalization?"
> **Domain expert:** "No. The final change list is valid; the problem appears only after dependency sorting detects the specific cycle, so it belongs in cycle-breaking change injection."

## Flagged ambiguities

- "Whole-plan interaction" was used for both **Structural normalization** and **Cycle-breaking change injection**. Resolved: deterministic rewrites of the final change list are structural normalization; rewrites triggered by a concrete unbreakable dependency cycle are cycle-breaking change injection.
- `AlterTableDropConstraint` was first described as optional in the publication/table drop cycle. Resolved: the observed production cycle is a **Publication FK-chain constraint-drop cycle**, so a separately emitted referenced-constraint drop is part of that specific matcher.
- Rebuilding `AlterPublicationDropTables` with relaxed requirements was considered for **Publication FK-chain constraint-drop cycles**. Resolved: keep publication membership changes unchanged and break the foreign-key chain with **FK constraint-drop injection**.
