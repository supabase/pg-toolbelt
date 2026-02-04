# SQL Formatter Tasks Overview

## Project Summary

Add a minimal, tailored SQL formatter to pg-delta that formats the SQL statements it generates, making output more readable and diff-friendly.

**Key Principle**: Format only hand-built SQL patterns, not PostgreSQL-provided definitions.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  CLI Layer                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  plan.ts                              sync.ts                           ││
│  │  --format-sql                         --format-sql                      ││
│  │  --keyword-case                       --keyword-case                    ││
│  │  --line-width                         --line-width                      ││
│  │  --indent-width                       --indent-width                    ││
│  │  --comma-style                        --comma-style                     ││
│  └─────────────────────────────────┬─────────────────────────────────────┘ │
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               Plan Layer                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  types.ts                         create.ts                             ││
│  │  ├─ PlanSchema                    ├─ createPlan()                       ││
│  │  │  └─ format: SqlFormatOptions   │  └─ accepts format options          ││
│  │  └─ CreatePlanOptions             └─ passes to generateStatements()     ││
│  │     └─ format?: SqlFormatOptions                                        ││
│  └─────────────────────────────────┬───────────────────────────────────────┘│
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Serialize Layer                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  serialize.types.ts               dsl.ts                                ││
│  │  └─ SerializeOptions              └─ compileSerializeDSL()              ││
│  │     └─ format?: SqlFormatOptions     └─ passes format to serialize()    ││
│  └─────────────────────────────────┬───────────────────────────────────────┘│
└────────────────────────────────────┼───────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Format Module                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  src/core/format/                                                       ││
│  │  ├─ format.types.ts    → SqlFormatOptions interface                     ││
│  │  │                       DEFAULT_FORMAT_OPTIONS constant                ││
│  │  ├─ format.ts          → SqlFormatter class                             ││
│  │  │                       ├─ keyword()  - case transformation            ││
│  │  │                       ├─ indent()   - indentation                    ││
│  │  │                       ├─ list()     - comma-style joining            ││
│  │  │                       └─ parens()   - multiline parentheses          ││
│  │  ├─ format.test.ts     → Unit tests                                     ││
│  │  └─ index.ts           → Exports                                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Change Classes                                    │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐  │
│  │   CreateTable     │ │   CreateEnum      │ │   CreateCompositeType     │  │
│  │   serialize()     │ │   serialize()     │ │   serialize()             │  │
│  │   └─ formatted?   │ │   └─ formatted?   │ │   └─ formatted?           │  │
│  └───────────────────┘ └───────────────────┘ └───────────────────────────┘  │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐  │
│  │  CreateAggregate  │ │  CreateRlsPolicy  │ │   CreateView              │  │
│  │   serialize()     │ │   serialize()     │ │   serialize()             │  │
│  │   └─ formatted?   │ │   └─ formatted?   │ │   └─ formatted?           │  │
│  └───────────────────┘ └───────────────────┘ └───────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │   CreateMaterializedView                                              │  │
│  │   serialize()                                                         │  │
│  │   └─ formatted?                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Task Dependency Graph

```
                           ┌─────────────────────┐
                           │  Task 1: Core       │
                           │  Formatter Module   │
                           │  [HIGH PRIORITY]    │
                           └──────────┬──────────┘
                                      │
                     ┌────────────────┼────────────────┐
                     │                │                │
                     ▼                ▼                ▼
       ┌─────────────────┐  ┌─────────────────┐  (depends on 1)
       │  Task 2:        │  │  Task 3:        │
       │  Serialize      │  │  Plan Schema    │
       │  Options        │  │  [HIGH]         │
       │  [HIGH]         │  │                 │
       └────────┬────────┘  └────────┬────────┘
                │                    │
                │ (depends on 1,2)   │
                ▼                    │
┌───────────────────────────────────────────────────────────────────────────┐
│                    Statement Formatting Tasks                              │
│                                                                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │  Task 4:    │ │  Task 5:    │ │  Task 6:    │ │  Task 7:    │          │
│  │  CREATE     │ │  CREATE     │ │  CREATE     │ │  CREATE     │          │
│  │  TABLE      │ │  TYPE ENUM  │ │  TYPE       │ │  AGGREGATE  │          │
│  │  [HIGH]     │ │  [MEDIUM]   │ │  COMPOSITE  │ │  [MEDIUM]   │          │
│  │             │ │             │ │  [MEDIUM]   │ │             │          │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘          │
│                                                                            │
│  ┌─────────────┐ ┌─────────────────────────────────────────────┐          │
│  │  Task 8:    │ │  Task 9: CREATE VIEW &                      │          │
│  │  CREATE     │ │          CREATE MATERIALIZED VIEW           │          │
│  │  POLICY     │ │          [MEDIUM]                           │          │
│  │  [MEDIUM]   │ │                                             │          │
│  └─────────────┘ └─────────────────────────────────────────────┘          │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
                │
                │ (depends on 1,2,3)
                ▼
       ┌─────────────────┐
       │  Task 10:       │
       │  CLI Flags      │
       │  [HIGH]         │
       └────────┬────────┘
                │
                │ (depends on 4,5,6,7,8,9,10)
                ▼
       ┌─────────────────┐
       │  Task 11:       │
       │  Integration    │
       │  Tests          │
       │  [MEDIUM]       │
       └─────────────────┘
```

---

## SqlFormatOptions Interface

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

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SqlFormatOptions                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  enabled          │  boolean                    │  false                │
│  keywordCase      │  'preserve'|'upper'|'lower' │  'upper'              │
│  lineWidth        │  number                     │  80                   │
│  indentWidth      │  number                     │  2                    │
│  commaStyle       │  'trailing'|'leading'       │  'trailing'           │
│  alignColumns     │  boolean                    │  true                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## SqlFormatter Class API

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           SqlFormatter                                     │
├───────────────────────────────────────────────────────────────────────────┤
│  constructor(options: SqlFormatOptions)                                   │
├───────────────────────────────────────────────────────────────────────────┤
│  keyword(kw: string): string                                              │
│  └─ Transform keyword to configured case                                  │
│     'SELECT' + upper → 'SELECT'                                           │
│     'SELECT' + lower → 'select'                                           │
│     'SELECT' + preserve → 'SELECT'                                        │
├───────────────────────────────────────────────────────────────────────────┤
│  indent(level?: number): string                                           │
│  └─ Create indentation string                                             │
│     indent(1) + width=2 → '  '                                            │
│     indent(2) + width=4 → '        '                                      │
├───────────────────────────────────────────────────────────────────────────┤
│  list(items: string[], indent?: number): string                           │
│  └─ Join items with comma placement                                       │
│     ['a', 'b'] + trailing → 'a,\n  b'                                     │
│     ['a', 'b'] + leading  → 'a\n, b'                                      │
├───────────────────────────────────────────────────────────────────────────┤
│  parens(content: string, multiline?: boolean): string                     │
│  └─ Wrap in parentheses                                                   │
│     'x' + false → '(x)'                                                   │
│     'x' + true  → '(\n  x\n)'                                             │
├───────────────────────────────────────────────────────────────────────────┤
│  alignColumns(rows: string[][], separators?: string[]): string[]          │
│  └─ Align multi-column data by padding each column to max width           │
│     Input:  [['id', 'bigserial', 'PRIMARY KEY'],                          │
│              ['customer_id', 'bigint', 'NOT NULL'],                       │
│              ['notes', 'text', '']]                                       │
│     Output: ['id            bigserial   PRIMARY KEY',                     │
│              'customer_id   bigint      NOT NULL',                        │
│              'notes         text        ']                                │
│     When alignColumns=false, skips padding (just joins with space)        │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Column Alignment Feature

The `alignColumns` option (default: `true`) aligns column definitions in CREATE TABLE statements for improved readability.

### How It Works

```
Input: Array of column definition rows
┌─────────────────────────────────────────────────────────────────────────────┐
│  Column 1 (name)    │  Column 2 (type)     │  Column 3 (constraints)        │
├─────────────────────┼──────────────────────┼────────────────────────────────┤
│  'id'               │  'bigserial'         │  'PRIMARY KEY'                 │
│  'customer_id'      │  'bigint'            │  'NOT NULL'                    │
│  'status'           │  'text'              │  'NOT NULL DEFAULT \'pending\''│
│  'total_cents'      │  'integer'           │  'NOT NULL CHECK (...)'        │
│  'currency_code'    │  'char(3)'           │  'NOT NULL DEFAULT \'EUR\''    │
│  'notes'            │  'text'              │  ''                            │
└─────────────────────┴──────────────────────┴────────────────────────────────┘

Step 1: Calculate max width for each column
  Col 1 max: 13 (currency_code)
  Col 2 max: 11 (timestamptz)
  Col 3 max: varies

Step 2: Pad each cell to column max width
┌─────────────────────────────────────────────────────────────────────────────┐
│  'id            '  │  'bigserial  '  │  'PRIMARY KEY'                       │
│  'customer_id   '  │  'bigint     '  │  'NOT NULL'                          │
│  'status        '  │  'text       '  │  'NOT NULL DEFAULT \'pending\''      │
│  'total_cents   '  │  'integer    '  │  'NOT NULL CHECK (...)'              │
│  'currency_code '  │  'char(3)    '  │  'NOT NULL DEFAULT \'EUR\''          │
│  'notes         '  │  'text       '  │  ''                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Output: Aligned column definition strings
  'id            bigserial   PRIMARY KEY'
  'customer_id   bigint      NOT NULL'
  'status        text        NOT NULL DEFAULT \'pending\''
  ...
```

### Before & After Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WITHOUT ALIGNMENT (alignColumns=false)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (                                               │
│    id bigserial PRIMARY KEY,                                                │
│    customer_id bigint NOT NULL,                                             │
│    status text NOT NULL DEFAULT 'pending',                                  │
│    total_cents integer NOT NULL CHECK (total_cents >= 0),                   │
│    currency_code char(3) NOT NULL DEFAULT 'EUR',                            │
│    notes text,                                                              │
│    created_at timestamptz NOT NULL DEFAULT now(),                           │
│    updated_at timestamptz NOT NULL DEFAULT now()                            │
│  );                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  WITH ALIGNMENT (alignColumns=true) ✓                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (                                               │
│    id            bigserial   PRIMARY KEY,                                   │
│    customer_id   bigint      NOT NULL,                                      │
│    status        text        NOT NULL DEFAULT 'pending',                    │
│    total_cents   integer     NOT NULL CHECK (total_cents >= 0),             │
│    currency_code char(3)     NOT NULL DEFAULT 'EUR',                        │
│    notes         text,                                                      │
│    created_at    timestamptz NOT NULL DEFAULT now(),                        │
│    updated_at    timestamptz NOT NULL DEFAULT now()                         │
│  );                                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Formatting Examples

### CREATE TABLE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  UNFORMATTED                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (id bigserial PRIMARY KEY, customer_id bigint   │
│  NOT NULL, status text NOT NULL DEFAULT 'pending', total_cents integer NOT  │
│  NULL CHECK (total_cents >= 0), currency_code char(3) NOT NULL DEFAULT      │
│  'EUR', notes text, created_at timestamptz NOT NULL DEFAULT now(),          │
│  updated_at timestamptz NOT NULL DEFAULT now());                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  FORMATTED (with column alignment, trailing comma)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (                                               │
│    id            bigserial   PRIMARY KEY,                                   │
│    customer_id   bigint      NOT NULL,                                      │
│    status        text        NOT NULL DEFAULT 'pending',                    │
│    total_cents   integer     NOT NULL CHECK (total_cents >= 0),             │
│    currency_code char(3)     NOT NULL DEFAULT 'EUR',                        │
│    notes         text,                                                      │
│    created_at    timestamptz NOT NULL DEFAULT now(),                        │
│    updated_at    timestamptz NOT NULL DEFAULT now()                         │
│  )                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  FORMATTED (with column alignment, leading comma)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (                                               │
│    id            bigserial   PRIMARY KEY                                    │
│  , customer_id   bigint      NOT NULL                                       │
│  , status        text        NOT NULL DEFAULT 'pending'                     │
│  , total_cents   integer     NOT NULL CHECK (total_cents >= 0)              │
│  , currency_code char(3)     NOT NULL DEFAULT 'EUR'                         │
│  , notes         text                                                       │
│  , created_at    timestamptz NOT NULL DEFAULT now()                         │
│  , updated_at    timestamptz NOT NULL DEFAULT now()                         │
│  )                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  FORMATTED (alignColumns=false, no alignment)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  CREATE TABLE public.orders (                                               │
│    id bigserial PRIMARY KEY,                                                │
│    customer_id bigint NOT NULL,                                             │
│    status text NOT NULL DEFAULT 'pending',                                  │
│    total_cents integer NOT NULL CHECK (total_cents >= 0),                   │
│    currency_code char(3) NOT NULL DEFAULT 'EUR',                            │
│    notes text,                                                              │
│    created_at timestamptz NOT NULL DEFAULT now(),                           │
│    updated_at timestamptz NOT NULL DEFAULT now()                            │
│  )                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### CREATE TYPE ENUM

```
┌───────────────────────────────────┐     ┌───────────────────────────────────┐
│  UNFORMATTED                      │     │  FORMATTED                        │
├───────────────────────────────────┤     ├───────────────────────────────────┤
│  CREATE TYPE status AS ENUM       │     │  CREATE TYPE status AS ENUM (     │
│  ('pending', 'active', 'done')    │     │    'pending',                     │
│                                   │     │    'active',                      │
│                                   │     │    'done'                         │
│                                   │     │  )                                │
└───────────────────────────────────┘     └───────────────────────────────────┘
```

### CREATE POLICY

```
┌─────────────────────────────────────────────────────────────────────────┐
│  UNFORMATTED                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  CREATE POLICY users_policy ON users FOR SELECT TO authenticated        │
│  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  FORMATTED                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│  CREATE POLICY users_policy ON users                                    │
│  FOR SELECT                                                              │
│  TO authenticated                                                        │
│  USING (auth.uid() = user_id)                                           │
│  WITH CHECK (auth.uid() = user_id)                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### CREATE VIEW

```
┌────────────────────────────────────────┐   ┌────────────────────────────────────────┐
│  UNFORMATTED                           │   │  FORMATTED                             │
├────────────────────────────────────────┤   ├────────────────────────────────────────┤
│  CREATE VIEW active_users AS SELECT    │   │  CREATE VIEW active_users              │
│  * FROM users WHERE status = 'active'  │   │  AS                                    │
│                                        │   │    SELECT * FROM users                 │
│                                        │   │    WHERE status = 'active'             │
└────────────────────────────────────────┘   └────────────────────────────────────────┘
```

---

## Detailed Task Breakdown

### Phase 1: Core Infrastructure

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 1: Create Core Formatter Module                          [HIGH PRIORITY] │
│  Dependencies: None                                                            │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Subtask 1.1: Create directory structure and format.types.ts                 │
│   ├─ Create src/core/format/ directory                                        │
│   ├─ Define SqlFormatOptions interface (including alignColumns)               │
│   └─ Export DEFAULT_FORMAT_OPTIONS constant                                   │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 1.2: Implement SqlFormatter class with basic methods                │
│   ├─ keyword() - case transformation                                          │
│   ├─ indent() - indentation generation                                        │
│   └─ parens() - parentheses wrapping                                          │
│                      │                                                         │
│                      ├────────────────────────────┐                            │
│                      ▼                            ▼                            │
│   Subtask 1.3: Implement list()      Subtask 1.4: Implement alignColumns()    │
│   ├─ trailing comma support          ├─ Pad columns to max width              │
│   └─ leading comma support           ├─ Handle varying row lengths            │
│                      │               └─ Respect alignColumns option           │
│                      │                            │                            │
│                      └────────────────────────────┘                            │
│                                      │                                         │
│                                      ▼                                         │
│   Subtask 1.5: Create comprehensive unit tests                                │
│   ├─ Test all methods including alignColumns()                                │
│   └─ Test edge cases                                                          │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 2: Extend SerializeOptions with Format Support           [HIGH PRIORITY] │
│  Dependencies: Task 1                                                          │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Subtask 2.1: Import SqlFormatOptions in serialize modules                   │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 2.2: Add format field to SerializeOptions in dsl.ts                 │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 2.3: Create SerializeOptions type in serialize.types.ts             │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 2.4: Update dsl.ts to import from serialize.types.ts                │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 2.5: Verify BaseChange.serialize() accepts options                  │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 3: Add Format Options to Plan Schema                     [HIGH PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Subtask 3.1: Update plan types.ts with SqlFormatOptions                     │
│   ├─ Add to CreatePlanOptions interface                                       │
│   └─ Add to PlanSchema Zod schema                                             │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 3.2: Update create.ts to accept and store format options            │
│   ├─ Accept format in createPlan()                                            │
│   └─ Pass to generateStatements()                                             │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 3.3: Add unit tests for plan serialization with format              │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Statement Formatting

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 4: Implement CREATE TABLE Formatting                     [HIGH PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Subtask 4.1: Update serialize() signature and add format check              │
│                      │                                                         │
│                      ├─────────────────────────────────────────┐               │
│                      ▼                                         ▼               │
│   Subtask 4.2: Implement serializeFormatted()    Subtask 4.4: Format          │
│   for regular tables with ALIGNED columns         partition tables            │
│   ┌─────────────────────────────────────────┐     (PARTITION OF)              │
│   │ Uses alignColumns() to align:           │                  │               │
│   │ • Column names                          │                  │               │
│   │ • Data types                            │                  │               │
│   │ • Constraints (NOT NULL, DEFAULT, etc.) │                  │               │
│   └─────────────────────────────────────────┘                  │               │
│                      │                                         │               │
│                      ▼                                         │               │
│   Subtask 4.3: Add INHERITS, PARTITION BY,        └────────────┤               │
│   WITH clauses formatting                                      │               │
│                      │                                         │               │
│                      └─────────────────────────────────────────┘               │
│                                         │                                      │
│                                         ▼                                      │
│   Subtask 4.5: Create comprehensive unit tests                                │
│   (including alignColumns=true/false tests)                                    │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 5: CREATE TYPE ENUM Formatting                         [MEDIUM PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│   Subtask 5.1: Update serialize() with format options check                   │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 5.2: Implement serializeFormatted() for enum labels                 │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 5.3: Add comprehensive unit tests                                   │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 6: CREATE TYPE COMPOSITE Formatting                    [MEDIUM PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│   Subtask 6.1: Update serialize() signature and add format check              │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 6.2: Implement serializeFormatted() with attribute formatting       │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 6.3: Add comprehensive unit tests                                   │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 7: CREATE AGGREGATE Formatting                         [MEDIUM PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│   Subtask 7.1: Update serialize() signature and add format check              │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 7.2: Implement serializeFormatted() with keyword formatting         │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 7.3: Format aggregate clauses with indentation                      │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 7.4: Add unit tests for formatted aggregate output                  │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 8: CREATE POLICY Formatting                            [MEDIUM PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│   Subtask 8.1: Update serialize() method signature                            │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 8.2: Implement serializeFormatted() for multiline policy            │
│                      │                                                         │
│                      ▼                                                         │
│   Subtask 8.3: Add comprehensive unit tests                                   │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 9: CREATE VIEW & MATERIALIZED VIEW Formatting          [MEDIUM PRIORITY] │
│  Dependencies: Task 1, Task 2                                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   ┌─────────────────────────┐     ┌─────────────────────────┐                 │
│   │ Subtask 9.1             │     │ Subtask 9.2             │                 │
│   │ Update CreateView       │     │ Update CreateMat.View   │                 │
│   │ serialize()             │     │ serialize()             │                 │
│   └───────────┬─────────────┘     └───────────┬─────────────┘                 │
│               │                               │                                │
│               └───────────┬───────────────────┘                                │
│                           │                                                    │
│                           ▼                                                    │
│   Subtask 9.3: Implement query body indentation                               │
│                           │                                                    │
│                           ▼                                                    │
│   Subtask 9.4: Add comprehensive unit tests                                   │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: CLI Integration

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 10: Add CLI Flags for SQL Formatting                     [HIGH PRIORITY] │
│  Dependencies: Task 1, Task 2, Task 3                                          │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   ┌─────────────────────────┐     ┌─────────────────────────┐                 │
│   │ Subtask 10.1            │     │ Subtask 10.3            │                 │
│   │ Add flags to plan.ts    │     │ Add flags to sync.ts    │                 │
│   └───────────┬─────────────┘     └───────────┬─────────────┘                 │
│               │                               │                                │
│               ▼                               │                                │
│   Subtask 10.2: Construct SqlFormatOptions    │                                │
│   and pass to createPlan in plan.ts           │                                │
│               │                               │                                │
│               └───────────────┬───────────────┘                                │
│                               │                                                │
│                               ▼                                                │
│   Subtask 10.4: Add CLI integration tests                                     │
│                                                                                │
│   CLI Flags:                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐     │
│   │  --format-sql              boolean         Enable formatting        │     │
│   │  --keyword-case <value>    enum            preserve|upper|lower     │     │
│   │  --line-width <value>      number          Maximum line width       │     │
│   │  --indent-width <value>    number          Spaces per indent level  │     │
│   │  --comma-style <value>     enum            trailing|leading         │     │
│   │  --align-columns           boolean         Align column definitions │     │
│   └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Phase 4: Testing & Validation

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  TASK 11: Integration Tests for Formatted SQL Output         [MEDIUM PRIORITY] │
│  Dependencies: Tasks 4, 5, 6, 7, 8, 9, 10                                      │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   Subtask 11.1: Set up integration test file with testcontainers              │
│                      │                                                         │
│                      ├────────────────┬────────────────┐                       │
│                      ▼                ▼                ▼                       │
│   Subtask 11.2:      Subtask 11.3:    Subtask 11.4:                           │
│   Test CREATE TABLE  Test CREATE TYPE Test AGGREGATE,                          │
│   formatting         formatting       POLICY, VIEW,                            │
│                      │                MATERIALIZED VIEW                        │
│                      │                │                                        │
│                      └────────────────┴────────────────┘                       │
│                                       │                                        │
│                                       ▼                                        │
│   Subtask 11.5: Test all format option combinations                           │
│                                       │                                        │
│                                       ▼                                        │
│   Subtask 11.6: Verify formatted vs unformatted produces                      │
│                 identical database state                                       │
│                                                                                │
│   Test Matrix:                                                                 │
│   ┌──────────────┬─────────────────────────────────────────────────────┐      │
│   │ Statement    │ keywordCase  × commaStyle × indentWidth = 12 combos │      │
│   ├──────────────┼─────────────────────────────────────────────────────┤      │
│   │ CREATE TABLE │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ ENUM         │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ COMPOSITE    │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ AGGREGATE    │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ POLICY       │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ VIEW         │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   │ MAT. VIEW    │ upper/lower/preserve × trailing/leading × 2/4      │      │
│   └──────────────┴─────────────────────────────────────────────────────┘      │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Timeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            IMPLEMENTATION PHASES                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PHASE 1: Core Infrastructure                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │  Task 1 ──► Task 2 ──► Task 3                                              ││
│  │  (Formatter)  (Serialize)  (Plan)                                          ││
│  │                                                                             ││
│  │  Deliverables:                                                              ││
│  │  • SqlFormatOptions interface                                               ││
│  │  • SqlFormatter class with all helper methods                               ││
│  │  • Format options integrated into serialize pipeline                        ││
│  │  • Format options stored in plan JSON                                       ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                          │
│                                      ▼                                          │
│  PHASE 2: Statement Formatting (can run in parallel)                           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         ││
│  │  │ Task 4   │ │ Task 5   │ │ Task 6   │ │ Task 7   │ │ Task 8   │         ││
│  │  │ TABLE    │ │ ENUM     │ │ COMPOSITE│ │ AGGREGATE│ │ POLICY   │         ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         ││
│  │                    ┌──────────────────────────┐                             ││
│  │                    │       Task 9             │                             ││
│  │                    │ VIEW + MATERIALIZED VIEW │                             ││
│  │                    └──────────────────────────┘                             ││
│  │                                                                             ││
│  │  Deliverables:                                                              ││
│  │  • All 7 statement types support formatted output                           ││
│  │  • Unit tests for each statement type                                       ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                          │
│                                      ▼                                          │
│  PHASE 3: CLI Integration                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                            Task 10                                          ││
│  │                   CLI Flags (plan + sync)                                   ││
│  │                                                                             ││
│  │  Deliverables:                                                              ││
│  │  • --format-sql, --keyword-case, --line-width, --indent-width, --comma-style││
│  │  • Both plan and sync commands support all flags                            ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                          │
│                                      ▼                                          │
│  PHASE 4: Testing & Validation                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                            Task 11                                          ││
│  │                     Integration Tests                                       ││
│  │                                                                             ││
│  │  Deliverables:                                                              ││
│  │  • End-to-end tests with testcontainers PostgreSQL                          ││
│  │  • All format option combinations tested                                    ││
│  │  • Formatted vs unformatted produce identical database state                ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure After Implementation

```
src/
├── core/
│   ├── format/                          # NEW - Task 1
│   │   ├── format.types.ts              # SqlFormatOptions interface
│   │   ├── format.ts                    # SqlFormatter class
│   │   ├── format.test.ts               # Unit tests
│   │   └── index.ts                     # Exports
│   │
│   ├── integrations/
│   │   └── serialize/
│   │       ├── serialize.types.ts       # MODIFIED - Task 2
│   │       └── dsl.ts                   # MODIFIED - Task 2
│   │
│   ├── plan/
│   │   ├── types.ts                     # MODIFIED - Task 3
│   │   └── create.ts                    # MODIFIED - Task 3
│   │
│   └── objects/
│       ├── table/changes/
│       │   └── table.create.ts          # MODIFIED - Task 4
│       ├── type/
│       │   ├── enum/changes/
│       │   │   └── enum.create.ts       # MODIFIED - Task 5
│       │   └── composite-type/changes/
│       │       └── composite-type.create.ts  # MODIFIED - Task 6
│       ├── aggregate/changes/
│       │   └── aggregate.create.ts      # MODIFIED - Task 7
│       ├── rls-policy/changes/
│       │   └── rls-policy.create.ts     # MODIFIED - Task 8
│       ├── view/changes/
│       │   └── view.create.ts           # MODIFIED - Task 9
│       └── materialized-view/changes/
│           └── materialized-view.create.ts  # MODIFIED - Task 9
│
├── cli/
│   └── commands/
│       ├── plan.ts                      # MODIFIED - Task 10
│       └── sync.ts                      # MODIFIED - Task 10
│
tests/
└── integration/
    └── format.integration.test.ts       # NEW - Task 11
```

---

## Progress Tracker

| Task | Title                                     | Priority | Status  | Subtasks |
|------|-------------------------------------------|----------|---------|----------|
| 1    | Create Core Formatter Module              | HIGH     | Pending | 5        |
| 2    | Extend SerializeOptions with Format       | HIGH     | Pending | 5        |
| 3    | Add Format Options to Plan Schema         | HIGH     | Pending | 3        |
| 4    | Implement CREATE TABLE Formatting         | HIGH     | Pending | 5        |
| 5    | Implement CREATE TYPE ENUM Formatting     | MEDIUM   | Pending | 3        |
| 6    | Implement CREATE TYPE COMPOSITE Formatting| MEDIUM   | Pending | 3        |
| 7    | Implement CREATE AGGREGATE Formatting     | MEDIUM   | Pending | 4        |
| 8    | Implement CREATE POLICY Formatting        | MEDIUM   | Pending | 3        |
| 9    | Implement CREATE VIEW/MAT.VIEW Formatting | MEDIUM   | Pending | 4        |
| 10   | Add CLI Flags for SQL Formatting          | HIGH     | Pending | 4        |
| 11   | Integration Tests for Formatted Output    | MEDIUM   | Pending | 6        |

**Total Tasks**: 11
**Total Subtasks**: 45
**High Priority**: 4 tasks
**Medium Priority**: 7 tasks

---

## Data Flow Diagram

```
                                CLI Input
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Flag Parsing                                      │
│  --format-sql --keyword-case=upper --indent-width=4 --comma-style=trailing    │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                         SqlFormatOptions Construction                          │
│  { enabled: true, keywordCase: 'upper', indentWidth: 4, commaStyle: 'trailing' }
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              createPlan()                                      │
│  CreatePlanOptions.format = SqlFormatOptions                                  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           generateStatements()                                 │
│  SerializeOptions.format = SqlFormatOptions                                   │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                          change.serialize(options)                             │
│                                    │                                           │
│                    ┌───────────────┴───────────────┐                          │
│                    │                               │                           │
│                    ▼                               ▼                           │
│         format.enabled = false          format.enabled = true                  │
│                    │                               │                           │
│                    ▼                               ▼                           │
│         Compact Serialization           serializeFormatted()                   │
│         (existing behavior)                        │                           │
│                    │                               │                           │
│                    │                               ▼                           │
│                    │               ┌─────────────────────────────────┐         │
│                    │               │      SqlFormatter helpers       │         │
│                    │               │  keyword() indent() list()      │         │
│                    │               │         parens()                │         │
│                    │               └─────────────────────────────────┘         │
│                    │                               │                           │
│                    └───────────────┬───────────────┘                          │
│                                    │                                           │
│                                    ▼                                           │
│                              SQL String                                        │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Plan JSON                                         │
│  { statements: [...], format: SqlFormatOptions }                              │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

1. **Backward Compatibility**: Formatting is opt-in; existing behavior unchanged when disabled
2. **Valid SQL**: All formatted output is syntactically valid and executes successfully
3. **Reproducibility**: Format options stored in plan JSON for consistent regeneration
4. **Full CLI Support**: All formatting flags available on both `plan` and `sync` commands
5. **Comprehensive Testing**: Unit tests for formatter, integration tests with PostgreSQL
6. **Performance**: Minimal overhead when formatting disabled, no regex parsing

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Formatted SQL invalid | HIGH | Unit tests verify structure; integration tests execute against PostgreSQL |
| Performance regression | MEDIUM | Format at serialize time, not post-process; benchmark if needed |
| Breaking existing behavior | HIGH | Opt-in only; extensive tests for unformatted path |
| Missing edge cases | MEDIUM | Comprehensive test matrix covering all option combinations |
