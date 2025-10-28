import type { Sql } from "postgres";

/**
 * Dependency type as defined in PostgreSQL's pg_depend.deptype.
 * n: normal
 * a: auto
 * i: internal
 */
type PgDependType = "n" | "a" | "i";

export interface PgDepend {
  dependent_stable_id: string;
  referenced_stable_id: string;
  /**
   * Dependency type as defined in PostgreSQL's pg_depend.deptype.
   *
   * - "n" (normal): Ordinary dependency — if the referenced object is dropped, the dependent object is also dropped automatically.
   *   Example: a table column depends on its table.
   * - "a" (auto): Automatically created dependency — the dependent object was created as a result of creating the referenced object,
   *   and should be dropped automatically when the referenced object is dropped, but not otherwise treated as a strong link.
   * - "i" (internal): Internal dependency — the dependent object is a low-level part of the referenced object and cannot be dropped
   *   without dropping the whole referenced object. Example: a table's toast table or an index that's part of a unique constraint.
   */
  deptype: PgDependType;
}

/**
 * Extract view dependencies from pg_rewrite via pg_depend.
 * Views depend on the objects they reference through their rewrite rules.
 * @param sql - The SQL client.
 * @returns Array of dependency objects for view dependencies.
 */
async function extractViewAndMaterializedViewDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const dependsRows = await sql<PgDepend[]>`
    select * from (
      -- Views/materialized views depending on tables/views/materialized views
      select distinct
        case
          when v.relkind = 'v' then 'view:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          when v.relkind = 'm' then 'materializedView:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          else 'unknown:' || quote_ident(v.relname) || ':' || v.relkind::text
        end as dependent_stable_id,
        case
          when ref_obj.relkind = 'r' then 'table:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          when ref_obj.relkind = 'v' then 'view:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          when ref_obj.relkind = 'm' then 'materializedview:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_obj.relname)
          else 'unknown:' || quote_ident(ref_obj.relname)
        end as referenced_stable_id,
        d.deptype
      from pg_catalog.pg_depend d
      join pg_catalog.pg_class c1 on d.classid = c1.oid
      join pg_catalog.pg_class c2 on d.refclassid = c2.oid
      join pg_catalog.pg_rewrite r on r.oid = d.objid
      join pg_catalog.pg_class v on r.ev_class = v.oid
      join pg_catalog.pg_namespace v_ns on v.relnamespace = v_ns.oid
      join pg_catalog.pg_class ref_obj on d.refobjid = ref_obj.oid
      join pg_catalog.pg_namespace ref_ns on ref_obj.relnamespace = ref_ns.oid
      where quote_ident(c1.relname) = 'pg_rewrite'
        and quote_ident(c2.relname) = 'pg_class'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
      union all
      -- Views/materialized views depending on functions
      select distinct
        case
          when v.relkind = 'v' then 'view:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          when v.relkind = 'm' then 'materializedView:' || quote_ident(v_ns.nspname) || '.' || quote_ident(v.relname)
          else 'unknown:' || quote_ident(v.relname) || ':' || v.relkind::text
        end as dependent_stable_id,
        'procedure:' || quote_ident(ref_proc_ns.nspname) || '.' || quote_ident(ref_proc.proname) || '('
          || coalesce(
            (
              select string_agg(format_type(oid, null), ',' order by ord)
              from unnest(ref_proc.proargtypes) with ordinality as t(oid, ord)
            ),
            ''
          ) || ')' as referenced_stable_id,
        d.deptype
      from pg_catalog.pg_depend d
      join pg_catalog.pg_class c1 on d.classid = c1.oid
      join pg_catalog.pg_class c2 on d.refclassid = c2.oid
      join pg_catalog.pg_rewrite r on r.oid = d.objid
      join pg_catalog.pg_class v on r.ev_class = v.oid
      join pg_catalog.pg_namespace v_ns on v.relnamespace = v_ns.oid
      join pg_catalog.pg_proc ref_proc on d.refobjid = ref_proc.oid
      join pg_catalog.pg_namespace ref_proc_ns on ref_proc.pronamespace = ref_proc_ns.oid
      where quote_ident(c1.relname) = 'pg_rewrite'
        and quote_ident(c2.relname) = 'pg_proc'
        and d.deptype = 'n'
        and c1.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
        and c2.relnamespace = (select oid from pg_namespace where quote_ident(nspname) = 'pg_catalog')
    ) as view_depends_rows
    where dependent_stable_id != referenced_stable_id
  `;

  return dependsRows;
}

/**
 * Extract ownership dependencies between all database objects and their owner roles.
 * These dependencies ensure that roles are created before objects that depend on them,
 * and objects are dropped before their owner roles.
 */
async function extractOwnershipDepends(sql: Sql): Promise<PgDepend[]> {
  const ownershipRows = await sql<PgDepend[]>`
-- OWNERSHIP DEPENDENCIES: All objects depend on their owner roles

-- Schema ownership dependencies
SELECT DISTINCT
  'schema:' || quote_ident(n.nspname) as dependent_stable_id,
  'role:' || n.nspowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_namespace n
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Table ownership dependencies  
SELECT DISTINCT
  'table:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind IN ('r', 'p')
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- View ownership dependencies
SELECT DISTINCT
  'view:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'v'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Materialized view ownership dependencies
SELECT DISTINCT
  'materializedView:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Sequence ownership dependencies
SELECT DISTINCT
  'sequence:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'S'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Composite type ownership dependencies
SELECT DISTINCT
  'compositeType:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) as dependent_stable_id,
  'role:' || c.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'c'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Function/procedure ownership dependencies
SELECT DISTINCT
  'procedure:' || quote_ident(n.nspname) || '.' || quote_ident(p.proname) || '('
    || COALESCE(
      (
        SELECT string_agg(format_type(oid, null), ',' ORDER BY ord)
        FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
      ),
      ''
    )
    || ')' as dependent_stable_id,
  'role:' || p.proowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Domain ownership dependencies
SELECT DISTINCT
  'domain:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'd'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Enum ownership dependencies
SELECT DISTINCT
  'enum:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'e'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Range type ownership dependencies
SELECT DISTINCT
  'range:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'r'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Multirange type ownership dependencies
SELECT DISTINCT
  'multirange:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Base type ownership dependencies
SELECT DISTINCT
  'type:' || quote_ident(n.nspname) || '.' || quote_ident(t.typname) as dependent_stable_id,
  'role:' || t.typowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_type t
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE t.typtype = 'b'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Trigger ownership dependencies (triggers inherit owner from their table)
SELECT DISTINCT
  'trigger:' || quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(tg.tgname) as dependent_stable_id,
  'role:' || tc.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_trigger tg
JOIN pg_class tc ON tg.tgrelid = tc.oid
JOIN pg_namespace tn ON tc.relnamespace = tn.oid
WHERE NOT tn.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  AND NOT tg.tgisinternal

UNION ALL

-- RLS Policy ownership dependencies (policies inherit owner from their table)
SELECT DISTINCT
  'rlsPolicy:' || quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(pol.polname) as dependent_stable_id,
  'role:' || tc.relowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_policy pol
JOIN pg_class tc ON pol.polrelid = tc.oid
JOIN pg_namespace tn ON tc.relnamespace = tn.oid
WHERE NOT tn.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Language ownership dependencies
SELECT DISTINCT
  'language:' || quote_ident(l.lanname) as dependent_stable_id,
  'role:' || l.lanowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_language l
WHERE l.lanname NOT IN ('internal', 'c', 'sql')

UNION ALL

-- Extension ownership dependencies
SELECT DISTINCT
  'extension:' || quote_ident(e.extname) as dependent_stable_id,
  'role:' || e.extowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_extension e
WHERE e.extname <> 'plpgsql'  -- Exclude default extensions

UNION ALL

-- Collation ownership dependencies
SELECT DISTINCT
  'collation:' || quote_ident(n.nspname) || '.' || quote_ident(c.collname) as dependent_stable_id,
  'role:' || c.collowner::regrole::text as referenced_stable_id,
  'n'::char as deptype
FROM pg_collation c
JOIN pg_namespace n ON c.collnamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  `;

  return ownershipRows;
}

/**
 * Extract dependencies between comments and the objects they describe.
 * Produces edges like:
 *  - comment:schema.table -> table:schema.table
 *  - comment:schema.table.column -> table:schema.table
 *  - comment:schema.table.constraint -> constraint:schema.table.constraint
 */
async function extractCommentDepends(sql: Sql): Promise<PgDepend[]> {
  const rows = await sql<PgDepend[]>`
-- COMMENT DEPENDENCIES: Comments depend on their owning objects

-- Table comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname)           AS dependent_stable_id,
  'table:'   || quote_ident(n.nspname) || '.' || quote_ident(c.relname)           AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind IN ('r','p')
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Materialized view comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname)           AS dependent_stable_id,
  'materializedView:'   || quote_ident(n.nspname) || '.' || quote_ident(c.relname)           AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Composite type comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(t.relname)           AS dependent_stable_id,
  'compositeType:'   || quote_ident(n.nspname) || '.' || quote_ident(t.relname)   AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_type ty
  ON d.classoid = 'pg_type'::regclass
 AND d.objoid   = ty.oid
 AND d.objsubid = 0
JOIN pg_class t
  ON t.reltype = ty.oid       -- composite's underlying rowtype
JOIN pg_namespace n
  ON n.oid = t.relnamespace
WHERE t.relkind = 'c'
  AND NOT n.nspname LIKE ANY (ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Domain comments
SELECT DISTINCT
  'comment:' || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS dependent_stable_id,
  'domain:'   || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'd' AND d.objsubid = 0
WHERE NOT t.typnamespace::regnamespace::text LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Collation comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.collname) AS dependent_stable_id,
  'collation:'   || quote_ident(n.nspname) || '.' || quote_ident(c.collname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_collation c ON d.classoid = 'pg_collation'::regclass AND d.objoid = c.oid AND d.objsubid = 0
JOIN pg_namespace n ON c.collnamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Enum type comments
SELECT DISTINCT
  'comment:' || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS dependent_stable_id,
  'enum:'   || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'e' AND d.objsubid = 0
WHERE NOT t.typnamespace::regnamespace::text LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Range type comments
SELECT DISTINCT
  'comment:' || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS dependent_stable_id,
  'range:'   || t.typnamespace::regnamespace::text || '.' || quote_ident(t.typname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_type t ON d.classoid = 'pg_type'::regclass AND d.objoid = t.oid AND t.typtype = 'r' AND d.objsubid = 0
WHERE NOT t.typnamespace::regnamespace::text LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Column comments (reference table as the owning object)
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname) AS dependent_stable_id,
  'table:'   || quote_ident(n.nspname) || '.' || quote_ident(c.relname)                                   AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid > 0
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind IN ('r','p')
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Index comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS dependent_stable_id,
  'index:'   || quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid = 0
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'i'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Materialized view column comments (reference materialized view as the owning object)
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || '.' || quote_ident(a.attname) AS dependent_stable_id,
  'materializedView:' || quote_ident(n.nspname) || '.' || quote_ident(c.relname)                                   AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class c ON d.classoid = 'pg_class'::regclass AND d.objoid = c.oid AND d.objsubid > 0
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relkind = 'm'
  AND NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Composite type attribute comments
SELECT DISTINCT
  'comment:' || quote_ident(n.nspname) || '.' || quote_ident(t.relname) || '.' || quote_ident(a.attname) AS dependent_stable_id,
  'compositeType:' || quote_ident(n.nspname) || '.' || quote_ident(t.relname)                                   AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_class t ON d.classoid = 'pg_class'::regclass AND d.objoid = t.oid AND t.relkind = 'c'
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.objsubid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE NOT n.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Language comments
SELECT DISTINCT
  'comment:' || quote_ident(l.lanname) AS dependent_stable_id,
  'language:' || quote_ident(l.lanname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_language l ON d.classoid = 'pg_language'::regclass AND d.objoid = l.oid AND d.objsubid = 0
WHERE l.lanname NOT IN ('internal', 'c')

UNION ALL

-- Extension comments
SELECT DISTINCT
  'comment:' || quote_ident(e.extname) AS dependent_stable_id,
  'extension:' || quote_ident(e.extname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_extension e ON d.classoid = 'pg_extension'::regclass AND d.objoid = e.oid AND d.objsubid = 0

UNION ALL

-- Procedure/function comments
SELECT DISTINCT
  'comment:' || p.pronamespace::regnamespace::text || '.' || quote_ident(p.proname) || '('
    || coalesce((select string_agg(format_type(oid, null), ',' order by ord) from unnest(p.proargtypes) with ordinality as t(oid, ord)), '') || ')'
    AS dependent_stable_id,
  'procedure:' || p.pronamespace::regnamespace::text || '.' || quote_ident(p.proname) || '('
    || coalesce((select string_agg(format_type(oid, null), ',' order by ord) from unnest(p.proargtypes) with ordinality as t(oid, ord)), '') || ')'
    AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_proc p ON d.classoid = 'pg_proc'::regclass AND d.objoid = p.oid AND d.objsubid = 0
WHERE NOT p.pronamespace::regnamespace::text LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- RLS policy comments
SELECT DISTINCT
  'comment:' || quote_ident(ns.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(pol.polname) AS dependent_stable_id,
  'rlsPolicy:' || quote_ident(ns.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(pol.polname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_policy pol ON d.classoid = 'pg_policy'::regclass AND d.objoid = pol.oid AND d.objsubid = 0
JOIN pg_class tc ON pol.polrelid = tc.oid
JOIN pg_namespace ns ON tc.relnamespace = ns.oid
WHERE NOT ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])

UNION ALL

-- Role comments
SELECT DISTINCT
  'comment:' || quote_ident(r.rolname) AS dependent_stable_id,
  'role:' || quote_ident(r.rolname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_roles r ON d.classoid = 'pg_authid'::regclass AND d.objoid = r.oid AND d.objsubid = 0

UNION ALL

-- Constraint comments
SELECT DISTINCT
  'comment:'    || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) || '.' || quote_ident(con.conname) AS dependent_stable_id,
  'constraint:' || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) || '.' || quote_ident(con.conname) AS referenced_stable_id,
  'n'::char AS deptype
FROM pg_description d
JOIN pg_constraint con ON d.classoid = 'pg_constraint'::regclass AND d.objoid = con.oid
JOIN pg_class tbl ON con.conrelid = tbl.oid
JOIN pg_namespace ns ON tbl.relnamespace = ns.oid
WHERE NOT ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  AND con.conrelid <> 0  -- only table constraints
`;
  return rows;
}

/**
 * Extract dependencies for privileges and memberships so that GRANT/REVOKE
 * operations are properly ordered with respect to their target objects/roles.
 *
 * Encodes edges like:
 *  - acl:<target>::grantee:<role> -> <target>
 *  - acl:<target>::grantee:<role> -> role:<role>
 *  - aclcol:table:<schema>.<name>::grantee:<role> -> table:<schema>.<name>
 *  - aclcol:... -> role:<role>
 *  - defacl:<grantor>:<objtype>:<scope>:grantee:<grantee> -> role:<grantor>
 *  - defacl:... -> role:<grantee>
 *  - defacl:... -> schema:<schema> (when scoped to a schema)
 *  - membership:<role>-><member> -> role:<role>
 *  - membership:<role>-><member> -> role:<member>
 */
async function extractPrivilegeAndMembershipDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const rows = await sql<PgDepend[]>`
with
  -- OBJECT PRIVILEGES (relations)
  extension_rel_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_class'::regclass
  ),
  rel_acls as (
    select
      c.relkind,
      c.relnamespace::regnamespace::text as schema,
      quote_ident(c.relname) as name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_class c
    join lateral aclexplode(c.relacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_rel_oids e on e.objid = c.oid
    where c.relkind in ('r','p','v','m','S')
      and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
  ),
  rel_targets as (
    select
      (case
        when relkind in ('r','p') then 'table:' || schema || '.' || name
        when relkind = 'v' then 'view:' || schema || '.' || name
        when relkind = 'm' then 'materializedView:' || schema || '.' || name
        when relkind = 'S' then 'sequence:' || schema || '.' || name
      end) as target_stable_id,
      grantee
    from rel_acls
  ),

  -- OBJECT PRIVILEGES (schemas)
  extension_ns_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_namespace'::regclass
  ),
  ns_acls as (
    select
      quote_ident(n.nspname) as name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_namespace n
    join lateral aclexplode(n.nspacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_ns_oids e on e.objid = n.oid
    where not n.nspname like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
  ),

  -- OBJECT PRIVILEGES (languages)
  extension_lang_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_language'::regclass
  ),
  lang_acls as (
    select
      quote_ident(l.lanname) as name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_language l
    join lateral aclexplode(l.lanacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_lang_oids e on e.objid = l.oid
    where l.lanname not in ('internal','c')
  ),

  -- OBJECT PRIVILEGES (routines)
  extension_proc_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_proc'::regclass
  ),
  proc_acls as (
    select
      p.pronamespace::regnamespace::text as schema,
      quote_ident(p.proname) as name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee,
      (select coalesce(string_agg(format_type(oid, null), ',' order by ord), '') from unnest(p.proargtypes) with ordinality as t(oid, ord)) as arg_types
    from pg_catalog.pg_proc p
    join lateral aclexplode(p.proacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_proc_oids e on e.objid = p.oid
    join pg_language l on l.oid = p.prolang
    where not p.pronamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
      and l.lanname not in ('c','internal')
  ),
  proc_targets as (
    select
      ('procedure:' || schema || '.' || name || '(' || arg_types || ')') as target_stable_id,
      grantee
    from proc_acls
  ),

  -- OBJECT PRIVILEGES (types/domains)
  extension_type_oids as (
    select objid from pg_depend d
    where d.refclassid = 'pg_extension'::regclass and d.classid = 'pg_type'::regclass
  ),
  type_acls as (
    select
      t.typtype,
      t.typnamespace::regnamespace::text as schema,
      quote_ident(t.typname) as name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_catalog.pg_type t
    join lateral aclexplode(t.typacl) as x(grantor, grantee, privilege_type, is_grantable) on true
    left join extension_type_oids e on e.objid = t.oid
    where not t.typnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and e.objid is null
      and t.typtype in ('d','e','r','c')
  ),
  type_targets as (
    select
      (case
        when typtype = 'd' then 'domain:' || schema || '.' || name
        when typtype = 'e' then 'enum:' || schema || '.' || name
        when typtype = 'r' then 'range:' || schema || '.' || name
        when typtype = 'c' then 'compositeType:' || schema || '.' || name
      end) as target_stable_id,
      grantee
    from type_acls
  ),

  -- COLUMN PRIVILEGES
  rels as (
    select c.oid,
           c.relkind,
           c.relnamespace::regnamespace::text as schema,
           quote_ident(c.relname) as table_name
    from pg_catalog.pg_class c
    left join pg_depend de on de.classid='pg_class'::regclass and de.objid=c.oid and de.refclassid='pg_extension'::regclass
    where c.relkind in ('r','p','v','m')
      and not c.relnamespace::regnamespace::text like any(array['pg\\_%','information\\_schema'])
      and de.objid is null
  ),
  col_acls as (
    select
      r.schema,
      r.table_name,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from rels r
    join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    join lateral aclexplode(a.attacl) as x(grantor, grantee, privilege_type, is_grantable) on true
  ),

  -- DEFAULT PRIVILEGES
  defacls as (
    select
      d.defaclrole::regrole::text as grantor,
      case when d.defaclnamespace = 0 then null else d.defaclnamespace::regnamespace::text end as in_schema,
      d.defaclobjtype::text as objtype,
      case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end as grantee
    from pg_default_acl d
    cross join lateral aclexplode(coalesce(d.defaclacl, ARRAY[]::aclitem[])) as x(grantor, grantee, privilege_type, is_grantable)
  ),

  -- ROLE MEMBERSHIPS
  memberships as (
    select r.rolname as role_name, m.rolname as member_name
    from pg_auth_members am
    join pg_roles r on r.oid = am.roleid
    join pg_roles m on m.oid = am.member
  )

select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  target_stable_id as referenced_stable_id,
  'n'::char as deptype
from rel_targets
where target_stable_id is not null

union all
select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from rel_targets
where target_stable_id is not null

union all
select distinct
  'acl:' || 'schema:' || name || '::grantee:' || grantee as dependent_stable_id,
  'schema:' || name as referenced_stable_id,
  'n'::char as deptype
from ns_acls

union all
select distinct
  'acl:' || 'schema:' || name || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from ns_acls

union all
select distinct
  'acl:' || 'language:' || name || '::grantee:' || grantee as dependent_stable_id,
  'language:' || name as referenced_stable_id,
  'n'::char as deptype
from lang_acls

union all
select distinct
  'acl:' || 'language:' || name || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from lang_acls

union all
select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  target_stable_id as referenced_stable_id,
  'n'::char as deptype
from proc_targets

union all
select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from proc_targets

union all
select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  target_stable_id as referenced_stable_id,
  'n'::char as deptype
from type_targets
where target_stable_id is not null

union all
select distinct
  'acl:' || target_stable_id || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from type_targets
where target_stable_id is not null

union all
select distinct
  'aclcol:' || 'table:' || schema || '.' || table_name || '::grantee:' || grantee as dependent_stable_id,
  'table:' || schema || '.' || table_name as referenced_stable_id,
  'n'::char as deptype
from col_acls

union all
select distinct
  'aclcol:' || 'table:' || schema || '.' || table_name || '::grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from col_acls

union all
select distinct
  'defacl:' || grantor || ':' || objtype || ':' || coalesce('schema:' || in_schema, 'global') || ':grantee:' || grantee as dependent_stable_id,
  'role:' || grantor as referenced_stable_id,
  'n'::char as deptype
from defacls

union all
select distinct
  'defacl:' || grantor || ':' || objtype || ':' || coalesce('schema:' || in_schema, 'global') || ':grantee:' || grantee as dependent_stable_id,
  'role:' || grantee as referenced_stable_id,
  'n'::char as deptype
from defacls

union all
select distinct
  'defacl:' || grantor || ':' || objtype || ':' || coalesce('schema:' || in_schema, 'global') || ':grantee:' || grantee as dependent_stable_id,
  'schema:' || in_schema as referenced_stable_id,
  'n'::char as deptype
from defacls
where in_schema is not null

union all
select distinct
  'membership:' || role_name || '->' || member_name as dependent_stable_id,
  'role:' || quote_ident(role_name) as referenced_stable_id,
  'n'::char as deptype
from memberships

union all
select distinct
  'membership:' || role_name || '->' || member_name as dependent_stable_id,
  'role:' || quote_ident(member_name) as referenced_stable_id,
  'n'::char as deptype
from memberships
  `;

  return rows;
}

/**
 * Extract constraint-to-constraint dependencies between foreign key constraints
 * and their referenced unique/primary key constraints.
 */
async function extractConstraintDepends(sql: Sql): Promise<PgDepend[]> {
  const constraintRows = await sql<PgDepend[]>`
-- CONSTRAINT-TO-CONSTRAINT DEPENDENCIES: Foreign key constraints depend on their referenced unique/primary key constraints

-- Foreign key constraint dependencies on referenced unique/primary key constraints
SELECT DISTINCT
  'constraint:' || quote_ident(fk_ns.nspname) || '.' || quote_ident(fk_table.relname) || '.' || quote_ident(fk_con.conname) as dependent_stable_id,
  'constraint:' || quote_ident(ref_ns.nspname) || '.' || quote_ident(ref_table.relname) || '.' || quote_ident(ref_con.conname) as referenced_stable_id,
  'n'::char as deptype
FROM pg_constraint fk_con
-- Foreign key constraint table and schema
JOIN pg_class fk_table ON fk_con.conrelid = fk_table.oid
JOIN pg_namespace fk_ns ON fk_table.relnamespace = fk_ns.oid
-- Referenced table and schema
JOIN pg_class ref_table ON fk_con.confrelid = ref_table.oid
JOIN pg_namespace ref_ns ON ref_table.relnamespace = ref_ns.oid
-- Find the referenced unique/primary key constraint
JOIN pg_constraint ref_con ON (
  ref_con.conrelid = fk_con.confrelid  -- Same referenced table
  AND ref_con.contype IN ('p', 'u')    -- Primary key or unique constraint
  AND ref_con.conkey = fk_con.confkey   -- Same columns
)
WHERE fk_con.contype = 'f'  -- Only foreign key constraints
  AND NOT fk_ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  AND NOT ref_ns.nspname LIKE ANY(ARRAY['pg\\_%', 'information\\_schema'])
  `;

  return constraintRows;
}

/**
 * Extract dependencies where tables depend on functions, either via
 * column defaults (pg_attrdef) or table constraints (pg_constraint).
 */
async function extractTableAndConstraintFunctionDepends(
  sql: Sql,
): Promise<PgDepend[]> {
  const rows = await sql<PgDepend[]>`
    -- Table depends on function via column default expression
    select distinct
      'table:' || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) as dependent_stable_id,
      'procedure:' || quote_ident(proc_ns.nspname) || '.' || quote_ident(proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and quote_ident(c_dep.relname) = 'pg_attrdef'
    join pg_attrdef ad on d.objid = ad.oid
    join pg_class tbl on ad.adrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and quote_ident(c_ref.relname) = 'pg_proc'
    join pg_proc proc on d.refobjid = proc.oid
    join pg_namespace proc_ns on proc.pronamespace = proc_ns.oid
    where d.deptype = 'n'
    union all
    -- Table depends on function via CHECK constraint expression
    select distinct
      'table:' || quote_ident(ns.nspname) || '.' || quote_ident(tbl.relname) as dependent_stable_id,
      'procedure:' || quote_ident(proc_ns.nspname) || '.' || quote_ident(proc.proname) || '('
        || coalesce(
          (
            select string_agg(format_type(oid, null), ',' order by ord)
            from unnest(proc.proargtypes) with ordinality as t(oid, ord)
          ),
          ''
        ) || ')' as referenced_stable_id,
      d.deptype
    from pg_depend d
    join pg_class c_dep on d.classid = c_dep.oid and quote_ident(c_dep.relname) = 'pg_constraint'
    join pg_constraint con on d.objid = con.oid and con.conrelid <> 0
    join pg_class tbl on con.conrelid = tbl.oid
    join pg_namespace ns on tbl.relnamespace = ns.oid
    join pg_class c_ref on d.refclassid = c_ref.oid and quote_ident(c_ref.relname) = 'pg_proc'
    join pg_proc proc on d.refobjid = proc.oid
    join pg_namespace proc_ns on proc.pronamespace = proc_ns.oid
    where d.deptype = 'n'
  `;
  return rows;
}

/**
 * Extract all dependencies from pg_depend, joining with pg_class for class names and applying user object filters.
 * @param sql - The SQL client.
 * @param params - Object containing arrays of OIDs for filtering (user_oids, user_namespace_oids, etc.)
 * @returns Array of dependency objects with class names.
 */
export async function extractDepends(sql: Sql): Promise<PgDepend[]> {
  const dependsRows = await sql<PgDepend[]>`
  WITH ids AS (
    -- only the objects that actually show up in dependencies (both sides)
    SELECT DISTINCT classid, objid, objsubid FROM pg_depend WHERE deptype IN ('n','a')
    UNION
    SELECT DISTINCT refclassid, refobjid, refobjsubid FROM pg_depend WHERE deptype IN ('n','a')
  ),
  objects AS (
    /* Schemas */
    SELECT 'pg_namespace'::regclass AS classid, n.oid AS objid, 0::int2 AS objsubid,
          n.nspname AS schema_name,
          format('schema:%I', n.nspname) AS stable_id
    FROM pg_namespace n
    JOIN ids i ON i.classid = 'pg_namespace'::regclass AND i.objid = n.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Tables / Views / MViews / Sequences / Indexes / Composite types (pg_class) */
    SELECT 'pg_class'::regclass, c.oid, 0::int2,
          ns.nspname,
          CASE
            WHEN ns.nspname IN ('information_schema','pg_catalog','pg_toast') THEN
              CASE c.relkind
                WHEN 'r' THEN format('systemTable:%I.%I', ns.nspname, c.relname)
                WHEN 'v' THEN format('systemView:%I.%I', ns.nspname, c.relname)
                WHEN 'S' THEN format('systemSequence:%I.%I', ns.nspname, c.relname)
                WHEN 'i' THEN format('systemIndex:%I.%I', ns.nspname, c.relname)
                ELSE format('systemObject:%I.%I:%s', ns.nspname, c.relname, c.relkind::text)
              END
            ELSE
              CASE c.relkind
                WHEN 'r' THEN format('table:%I.%I', ns.nspname, c.relname)
                WHEN 'p' THEN format('table:%I.%I', ns.nspname, c.relname)
                WHEN 'v' THEN format('view:%I.%I', ns.nspname, c.relname)
                WHEN 'm' THEN format('materializedView:%I.%I', ns.nspname, c.relname)
                WHEN 'S' THEN format('sequence:%I.%I', ns.nspname, c.relname)
                WHEN 'i' THEN format('index:%I.%I', ns.nspname, c.relname)
                WHEN 'c' THEN format('compositeType:%I.%I', ns.nspname, c.relname)
                ELSE format('unknown:%s.%s', 'pg_class', c.oid::text)
              END
          END AS stable_id
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN ids i ON i.classid = 'pg_class'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Columns (so refobjsubid > 0 resolves to a column stable id) */
    SELECT 'pg_class'::regclass, a.attrelid, a.attnum,
          ns.nspname,
          format('column:%I.%I.%I', ns.nspname, c.relname, a.attname)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    JOIN ids i ON i.classid = 'pg_class'::regclass AND i.objid = a.attrelid AND i.objsubid = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped

    UNION ALL
    /* Types (map row types back to their owning relation when applicable) */
    SELECT 'pg_type'::regclass, t.oid, 0::int2,
          COALESCE(rns.nspname, ns.nspname) AS schema_name,  -- prefer owning rel's schema if present
          CASE t.typtype
            WHEN 'd' THEN format('domain:%I.%I', ns.nspname, t.typname)
            WHEN 'e' THEN format('enum:%I.%I', ns.nspname, t.typname)
            WHEN 'r' THEN format('range:%I.%I', ns.nspname, t.typname)
            WHEN 'm' THEN format('multirange:%I.%I', ns.nspname, t.typname)

            WHEN 'c' THEN
              CASE
                /* Row type owned by a table / partitioned table / foreign table */
                WHEN r.oid IS NOT NULL AND r.relkind IN ('r','p','f') THEN
                  CASE
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemTable:%I.%I', rns.nspname, r.relname)
                    ELSE    format('table:%I.%I',       rns.nspname, r.relname)
                  END

                /* Row type owned by a view */
                WHEN r.oid IS NOT NULL AND r.relkind = 'v' THEN
                  CASE
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemView:%I.%I', rns.nspname, r.relname)
                    ELSE    format('view:%I.%I',       rns.nspname, r.relname)
                  END

                /* Row type owned by a materialized view */
                WHEN r.oid IS NOT NULL AND r.relkind = 'm' THEN
                  CASE
                    /* your pg_class system-branch uses systemObject for relkind m */
                    WHEN rns.nspname IN ('information_schema','pg_catalog','pg_toast')
                      THEN format('systemObject:%I.%I:%s', rns.nspname, r.relname, 'm')
                    ELSE    format('materializedView:%I.%I', rns.nspname, r.relname)
                  END

                /* Standalone composite type */
                ELSE format('compositeType:%I.%I', ns.nspname, t.typname)
              END

            WHEN 'p' THEN format('pseudoType:%I.%I', ns.nspname, t.typname)
            ELSE         format('type:%I.%I',       ns.nspname, t.typname)
          END AS stable_id
    FROM pg_type t
    JOIN pg_namespace ns ON ns.oid = t.typnamespace
    LEFT JOIN pg_class     r   ON r.oid  = t.typrelid
    LEFT JOIN pg_namespace rns ON rns.oid = r.relnamespace
    JOIN ids i ON i.classid = 'pg_type'::regclass AND i.objid = t.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Constraints on domain */
    SELECT 'pg_constraint'::regclass, c.oid, 0::int2,
          ns.nspname,
          format('constraint:%I.%I.%I', ns.nspname, ty.typname, c.conname)
    FROM pg_constraint c
    JOIN pg_type ty ON ty.oid = c.contypid
    JOIN pg_namespace ns ON ns.oid = ty.typnamespace
    JOIN ids i ON i.classid = 'pg_constraint'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0
    WHERE c.contypid <> 0

    UNION ALL
    /* Constraints on table */
    SELECT 'pg_constraint'::regclass, c.oid, 0::int2,
          ns.nspname,
          format('constraint:%I.%I.%I', ns.nspname, tbl.relname, c.conname)
    FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_constraint'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0
    WHERE c.conrelid <> 0

    UNION ALL
    /* RLS policies */
    SELECT 'pg_policy'::regclass, p.oid, 0::int2,
          ns.nspname,
          format('rlsPolicy:%I.%I.%I', ns.nspname, tbl.relname, p.polname)
    FROM pg_policy p
    JOIN pg_class tbl ON tbl.oid = p.polrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_policy'::regclass AND i.objid = p.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Functions/Procedures: types-only signature */
    SELECT 'pg_proc'::regclass, p.oid, 0::int2,
          ns.nspname,
          format(
            'procedure:%I.%I(%s)',
            ns.nspname, p.proname,
            COALESCE((
              SELECT string_agg(format_type(t.oid, NULL), ',' ORDER BY ord)
              FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
            ), '')
          )
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN ids i ON i.classid = 'pg_proc'::regclass AND i.objid = p.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Triggers */
    SELECT 'pg_trigger'::regclass, tg.oid, 0::int2,
          ns.nspname,
          format('trigger:%I.%I.%I', ns.nspname, tbl.relname, tg.tgname)
    FROM pg_trigger tg
    JOIN pg_class tbl ON tbl.oid = tg.tgrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_trigger'::regclass AND i.objid = tg.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Rewrite rules */
    SELECT 'pg_rewrite'::regclass, r.oid, 0::int2,
          ns.nspname,
          format('rewriteRule:%I.%I.%I', ns.nspname, tbl.relname, r.rulename)
    FROM pg_rewrite r
    JOIN pg_class tbl ON tbl.oid = r.ev_class
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN ids i ON i.classid = 'pg_rewrite'::regclass AND i.objid = r.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Full-text search objects */
    SELECT 'pg_ts_config'::regclass, c.oid, 0::int2, ns.nspname, format('tsConfig:%I.%I', ns.nspname, c.cfgname)
    FROM pg_ts_config c
    JOIN pg_namespace ns ON ns.oid = c.cfgnamespace
    JOIN ids i ON i.classid = 'pg_ts_config'::regclass AND i.objid = c.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_ts_dict'::regclass, d.oid, 0::int2, ns.nspname, format('tsDict:%I.%I', ns.nspname, d.dictname)
    FROM pg_ts_dict d
    JOIN pg_namespace ns ON ns.oid = d.dictnamespace
    JOIN ids i ON i.classid = 'pg_ts_dict'::regclass AND i.objid = d.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_ts_template'::regclass, t.oid, 0::int2, ns.nspname, format('tsTemplate:%I.%I', ns.nspname, t.tmplname)
    FROM pg_ts_template t
    JOIN pg_namespace ns ON ns.oid = t.tmplnamespace
    JOIN ids i ON i.classid = 'pg_ts_template'::regclass AND i.objid = t.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Column defaults (attrdef) → column stable id */
    SELECT 'pg_attrdef'::regclass, ad.oid, 0::int2,
          ns.nspname,
          format('column:%I.%I.%I', ns.nspname, tbl.relname, col.attname)
    FROM pg_attrdef ad
    JOIN pg_class tbl ON tbl.oid = ad.adrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_attribute col
      ON col.attrelid = ad.adrelid AND col.attnum = ad.adnum AND col.attnum > 0 AND NOT col.attisdropped
    JOIN ids i ON i.classid = 'pg_attrdef'::regclass AND i.objid = ad.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Default ACLs */
    SELECT 'pg_default_acl'::regclass, da.oid, 0::int2,
          ns.nspname,
          format('defaultAcl:%I.%s', ns.nspname, da.defaclobjtype::text)
    FROM pg_default_acl da
    JOIN pg_namespace ns ON ns.oid = da.defaclnamespace
    JOIN ids i ON i.classid = 'pg_default_acl'::regclass AND i.objid = da.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    /* Language (no schema), Event trigger, Extension */
    SELECT 'pg_language'::regclass, l.oid, 0::int2, NULL::text, format('language:%I', l.lanname)
    FROM pg_language l
    JOIN ids i ON i.classid = 'pg_language'::regclass AND i.objid = l.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_event_trigger'::regclass, et.oid, 0::int2, NULL::text, format('eventTrigger:%I', et.evtname)
    FROM pg_event_trigger et
    JOIN ids i ON i.classid = 'pg_event_trigger'::regclass AND i.objid = et.oid AND COALESCE(i.objsubid,0) = 0

    UNION ALL
    SELECT 'pg_extension'::regclass, e.oid, 0::int2, NULL::text, format('extension:%I', e.extname)
    FROM pg_extension e
    JOIN ids i ON i.classid = 'pg_extension'::regclass AND i.objid = e.oid AND COALESCE(i.objsubid,0) = 0
  ),
  base AS (
    SELECT DISTINCT
      COALESCE(dep.stable_id, format('unknown:%s.%s', (d.classid::regclass)::text, d.objid::text)) AS dependent_stable_id,
      COALESCE(ref.stable_id, format('unknown:%s.%s', (d.refclassid::regclass)::text, d.refobjid::text)) AS referenced_stable_id,
      d.deptype,
      dep.schema_name AS dep_schema,
      ref.schema_name AS ref_schema
    FROM pg_depend d
    LEFT JOIN objects dep
      ON dep.classid = d.classid AND dep.objid = d.objid AND dep.objsubid = COALESCE(NULLIF(d.objsubid,0),0)
    LEFT JOIN objects ref
      ON ref.classid = d.refclassid AND ref.objid = d.refobjid AND ref.objsubid = COALESCE(NULLIF(d.refobjsubid,0),0)
    WHERE d.deptype IN ('n','a')
  )
  SELECT DISTINCT
    dependent_stable_id,
    referenced_stable_id,
    deptype
  FROM base
  -- In some corner case (composite type) we can have the same stable ids in the case where an internal object depends on it's parent type
  -- eg: compositeType contains internal columns but we don't distinct them from the parent type itself in our stable ids
  WHERE dependent_stable_id <> referenced_stable_id
    -- Drop rows where BOTH sides are system schemas (keep user↔user + cross)
    AND NOT (
      dep_schema LIKE ANY (ARRAY['pg\\_%','information\\_schema'])
      AND ref_schema LIKE ANY (ARRAY['pg\\_%','information\\_schema'])
    )
  ORDER BY dependent_stable_id, referenced_stable_id;
  `;

  // Also extract view dependencies from pg_rewrite
  const viewDepends = await extractViewAndMaterializedViewDepends(sql);
  // Also extract table -> function dependencies (defaults/constraints)
  const tableFuncDepends = await extractTableAndConstraintFunctionDepends(sql);
  // Extract ownership dependencies (all objects depend on their owner roles)
  const ownershipDepends = await extractOwnershipDepends(sql);
  // Extract constraint-to-constraint dependencies (foreign key -> unique/primary key)
  const constraintDepends = await extractConstraintDepends(sql);
  // Extract comment dependencies (comments -> owning objects)
  const commentDepends = await extractCommentDepends(sql);
  // Extract privilege and membership dependencies
  const privilegeDepends = await extractPrivilegeAndMembershipDepends(sql);

  // Combine all dependency sources and remove duplicates
  const allDepends = new Set([
    ...dependsRows,
    ...viewDepends,
    ...tableFuncDepends,
    ...ownershipDepends,
    ...constraintDepends,
    ...commentDepends,
    ...privilegeDepends,
  ]);

  return Array.from(allDepends).sort(
    (a, b) =>
      a.dependent_stable_id.localeCompare(b.dependent_stable_id) ||
      a.referenced_stable_id.localeCompare(b.referenced_stable_id),
  );
}
