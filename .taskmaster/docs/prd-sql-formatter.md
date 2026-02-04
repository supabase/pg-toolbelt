# PRD: SQL Formatter for pg-delta

## Overview

Add a minimal, tailored SQL formatter to pg-delta that formats the SQL statements it generates, making output more readable and diff-friendly.

**Key principle**: Format only the hand-built SQL patterns, not PostgreSQL-provided definitions (functions, triggers, indexes already come pre-formatted from pg_catalog).

## Goals

1. Improve readability of generated migration SQL
2. Make migrations more diff-friendly for version control
3. Maintain backward compatibility (opt-in formatting)
4. Store format options in plans for reproducibility

## Non-Goals

- Formatting PostgreSQL-provided definitions (pg_get_functiondef, pg_get_indexdef, pg_get_triggerdef)
- Deep formatting of SELECT queries inside views
- Parsing and reformatting arbitrary SQL strings

## Requirements

### Functional Requirements

#### FR-1: Core Formatter Module
- Create `SqlFormatOptions` interface with configurable options
- Create `SqlFormatter` helper class with utility methods
- Support keyword case transformation (preserve, upper, lower)
- Support configurable indentation (spaces per level)
- Support configurable line width
- Support trailing or leading comma style

#### FR-2: Format Options Interface
```typescript
interface SqlFormatOptions {
  enabled?: boolean;           // default: false (opt-in)
  keywordCase?: 'preserve' | 'upper' | 'lower';  // default: 'upper'
  lineWidth?: number;          // default: 80
  indentWidth?: number;        // default: 2
  commaStyle?: 'trailing' | 'leading';  // default: 'trailing'
  alignColumns?: boolean;      // default: true
}
```

#### FR-3: Statements to Format
The following statement types must support formatted output:
1. **CREATE TABLE** - columns on separate lines, indented, with aligned column names, types, and constraints
2. **CREATE TYPE (ENUM)** - enum values on separate lines
3. **CREATE TYPE (COMPOSITE)** - attributes on separate lines
4. **CREATE AGGREGATE** - clauses on separate lines
5. **CREATE POLICY** - clauses (AS, FOR, TO, USING, WITH CHECK) on separate lines
6. **CREATE VIEW** - AS clause on new line
7. **CREATE MATERIALIZED VIEW** - AS clause on new line

#### FR-4: Plan Integration
- Format options stored in plan JSON for reproducibility
- Format options passed through serialize DSL
- Formatting applied at serialize time, not post-processing

#### FR-5: CLI Integration
- `--format-sql` flag to enable formatting (opt-in)
- `--keyword-case <value>` flag for keyword casing
- `--line-width <value>` flag for max line width
- `--indent-width <value>` flag for indentation
- `--comma-style <value>` flag for comma placement
- `--align-columns` flag for column alignment in CREATE TABLE (default: true when formatting enabled)
- Flags available on both `plan` and `sync` commands

### Non-Functional Requirements

#### NFR-1: Backward Compatibility
- Formatting disabled by default
- Existing behavior unchanged when formatting disabled
- No breaking changes to public API

#### NFR-2: Performance
- No regex parsing of generated SQL
- Format at serialize time using structural knowledge
- Minimal overhead when disabled

#### NFR-3: Testability
- Unit tests for SqlFormatter helper methods
- Unit tests for each formatted statement type
- Integration tests with real plan generation

## Technical Design

### File Structure
```
src/core/format/
├── format.types.ts      # SqlFormatOptions interface and defaults
├── format.ts            # SqlFormatter class with helper methods
├── format.test.ts       # Unit tests for formatter
└── index.ts             # Exports
```

### SqlFormatter Class API
```typescript
class SqlFormatter {
  constructor(options: SqlFormatOptions);

  /** Transform keyword to configured case */
  keyword(kw: string): string;

  /** Create indentation string for given level */
  indent(level?: number): string;

  /** Join items with proper comma placement and line breaks */
  list(items: string[], indent?: number): string;

  /** Wrap content in parentheses, optionally multi-line */
  parens(content: string, multiline?: boolean): string;

  /** Align multi-column data by padding each column to max width */
  alignColumns(rows: string[][], separators?: string[]): string[];
}
```

### Integration Points

1. **serialize.types.ts** - Add `format?: SqlFormatOptions` to SerializeOptions
2. **plan/types.ts** - Add `format?: SqlFormatOptions` to Plan schema and CreatePlanOptions
3. **plan/create.ts** - Pass format options through to serialize
4. **serialize/dsl.ts** - Include format in compiled serializer options

### Change Class Modifications

Each change class serialize() method will:
1. Check if `options?.format?.enabled` is true
2. If enabled, use SqlFormatter helpers to build formatted SQL
3. If disabled, use existing compact serialization (no changes)

## Implementation Tasks

### Task 1: Create Core Formatter Module
**Priority: High**
**Estimated complexity: Medium**

Create the formatter types, SqlFormatter class, and exports:
- Create `src/core/format/format.types.ts` with SqlFormatOptions interface and DEFAULT_FORMAT_OPTIONS
- Create `src/core/format/format.ts` with SqlFormatter class implementing keyword(), indent(), list(), parens() methods
- Create `src/core/format/index.ts` with exports
- Create `src/core/format/format.test.ts` with unit tests for all SqlFormatter methods

**Acceptance Criteria:**
- SqlFormatOptions interface defined with all options (including alignColumns)
- DEFAULT_FORMAT_OPTIONS constant exported
- SqlFormatter class works with all option combinations
- alignColumns() method correctly pads multi-column data
- Unit tests cover edge cases (empty lists, special characters, varying column counts)

### Task 2: Extend Serialize Options with Format Support
**Priority: High**
**Estimated complexity: Low**

Update serialization infrastructure to support format options:
- Update `src/core/integrations/serialize/serialize.types.ts` - Add format to SerializeOptions type
- Update `src/core/integrations/serialize/dsl.ts` - Pass format through compiled serializer

**Acceptance Criteria:**
- SerializeOptions includes optional format field
- compileSerializeDSL passes format options to change.serialize()

### Task 3: Add Format Options to Plan Types
**Priority: High**
**Estimated complexity: Low**

Update plan types to store and pass format options:
- Update `src/core/plan/types.ts` - Add format to PlanSchema and CreatePlanOptions
- Update `src/core/plan/create.ts` - Pass format options through generateStatements

**Acceptance Criteria:**
- Plan JSON schema includes format options
- CreatePlanOptions accepts format options
- Format options flow from createPlan() to serialize()

### Task 4: Implement CREATE TABLE Formatting
**Priority: High**
**Estimated complexity: High**

Add formatted output support to CreateTable change:
- Update `src/core/objects/table/changes/table.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle columns, INHERITS, PARTITION BY, WITH clauses
- Add unit tests for formatted output

**Acceptance Criteria:**
- Columns appear one per line, indented
- Column names, data types, and constraints aligned in columns when alignColumns=true
- Trailing/leading comma style respected
- Keywords use configured case
- INHERITS, PARTITION BY, WITH on separate lines
- Partition tables (PARTITION OF) format correctly
- Unit tests verify all formatting rules including column alignment

### Task 5: Implement CREATE TYPE ENUM Formatting
**Priority: Medium**
**Estimated complexity: Low**

Add formatted output support to CreateEnum change:
- Update `src/core/objects/type/enum/changes/enum.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Add unit tests for formatted output

**Acceptance Criteria:**
- Enum values appear one per line, indented
- Trailing/leading comma style respected
- Keywords use configured case
- Unit tests verify formatting

### Task 6: Implement CREATE TYPE COMPOSITE Formatting
**Priority: Medium**
**Estimated complexity: Medium**

Add formatted output support to CreateCompositeType change:
- Update `src/core/objects/type/composite-type/changes/composite-type.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle attribute definitions with collation
- Add unit tests for formatted output

**Acceptance Criteria:**
- Attributes appear one per line, indented
- COLLATE clause included inline with attribute
- Trailing/leading comma style respected
- Keywords use configured case
- Unit tests verify formatting

### Task 7: Implement CREATE AGGREGATE Formatting
**Priority: Medium**
**Estimated complexity: Medium**

Add formatted output support to CreateAggregate change:
- Update `src/core/objects/aggregate/changes/aggregate.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle SFUNC, STYPE, FINALFUNC, COMBINEFUNC, etc.
- Add unit tests for formatted output

**Acceptance Criteria:**
- Aggregate clauses appear one per line, indented
- Trailing/leading comma style respected
- Keywords use configured case
- Unit tests verify formatting

### Task 8: Implement CREATE POLICY Formatting
**Priority: Medium**
**Estimated complexity: Medium**

Add formatted output support to CreateRlsPolicy change:
- Update `src/core/objects/rls-policy/changes/rls-policy.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle AS, FOR, TO, USING, WITH CHECK clauses
- Add unit tests for formatted output

**Acceptance Criteria:**
- Policy name and table on first line
- AS, FOR, TO, USING, WITH CHECK each on own line
- Clause keywords not indented (same level as CREATE)
- Keywords use configured case
- Unit tests verify formatting

### Task 9: Implement CREATE VIEW Formatting
**Priority: Medium**
**Estimated complexity: Low**

Add formatted output support to CreateView change:
- Update `src/core/objects/view/changes/view.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle WITH options and AS clause
- Add unit tests for formatted output

**Acceptance Criteria:**
- View name on first line
- WITH options on new line if present
- AS on its own line
- Query body indented one level
- Keywords use configured case
- Unit tests verify formatting

### Task 10: Implement CREATE MATERIALIZED VIEW Formatting
**Priority: Medium**
**Estimated complexity: Low**

Add formatted output support to CreateMaterializedView change:
- Update `src/core/objects/materialized-view/changes/materialized-view.create.ts`
- Add serializeFormatted() private method
- Update serialize() to check format options and branch
- Handle WITH options, TABLESPACE, and AS clause
- Add unit tests for formatted output

**Acceptance Criteria:**
- Materialized view name on first line
- WITH options on new line if present
- TABLESPACE on new line if present
- AS on its own line
- Query body indented one level
- Keywords use configured case
- Unit tests verify formatting

### Task 11: Add CLI Flags for Formatting
**Priority: High**
**Estimated complexity: Medium**

Add formatting flags to plan and sync commands:
- Update `src/cli/commands/plan.ts` - Add --format-sql, --keyword-case, --line-width, --indent-width, --comma-style flags
- Update `src/cli/commands/sync.ts` - Add same flags
- Parse flags and construct SqlFormatOptions
- Pass options to createPlan()

**Acceptance Criteria:**
- `--format-sql` enables formatting (boolean flag)
- `--keyword-case` accepts 'preserve', 'upper', 'lower'
- `--line-width` accepts positive integer
- `--indent-width` accepts positive integer
- `--comma-style` accepts 'trailing', 'leading'
- Flags work on both plan and sync commands
- Help text documents all flags

### Task 12: Integration Tests for Formatted Output
**Priority: Medium**
**Estimated complexity: Medium**

Create integration tests verifying end-to-end formatting:
- Create test file `tests/integration/format.integration.test.ts`
- Test plan generation with formatting enabled
- Verify formatted SQL is valid (can be parsed/executed)
- Test with various option combinations

**Acceptance Criteria:**
- Integration test creates plan with formatting enabled
- Formatted SQL executes successfully against PostgreSQL
- Different option combinations produce expected output
- Plan JSON correctly stores format options

### Task 13: Documentation
**Priority: Low**
**Estimated complexity: Low**

Update documentation with formatting examples:
- Update README.md with formatting section
- Add examples of formatted vs unformatted output
- Document all CLI flags
- Document format options in plan JSON

**Acceptance Criteria:**
- README includes formatting documentation
- CLI help shows all format flags
- Examples demonstrate before/after formatting

## Test Strategy

### Unit Tests
- SqlFormatter class methods (keyword, indent, list, parens)
- Each change class serializeFormatted() method
- Edge cases: empty columns, special characters, quoted identifiers

### Integration Tests
- End-to-end plan creation with formatting
- Verify formatted SQL validity by execution
- Option combinations (leading commas, lower case keywords, etc.)

## Success Metrics

1. All formatted statement types produce valid SQL
2. Formatting is completely opt-in with zero impact when disabled
3. Format options are preserved in plan JSON for reproducibility
4. CLI flags provide full control over formatting options

## Dependencies

- No new npm dependencies required
- Uses existing SqlFormatter pattern from serialize infrastructure

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Formatted SQL invalid | Unit tests verify SQL structure; integration tests execute against PostgreSQL |
| Performance regression | Format at serialize time, not post-process; benchmark if needed |
| Breaking existing behavior | Opt-in only; extensive tests for unformatted path |

## Timeline

Phase 1 (Core): Tasks 1-3 - Formatter module and infrastructure
Phase 2 (Statements): Tasks 4-10 - Update change classes
Phase 3 (CLI): Task 11 - CLI integration
Phase 4 (Quality): Tasks 12-13 - Tests and documentation
