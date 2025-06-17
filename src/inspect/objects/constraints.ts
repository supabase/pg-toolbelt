import type { Sql } from "postgres";

export type InspectedConstraint = {
  constraint_schema: string; // nc.nspname cast to sql_identifier
  constraint_name: string; // c.conname cast to sql_identifier
  table_schema: string; // nr.nspname cast to sql_identifier
  table_name: string; // r.relname cast to sql_identifier
  constraint_type: string | null; // case statement on c.contype, cast to character_data
  is_deferrable: string; // 'YES' or 'NO' cast to yes_or_no
  initially_deferred: string; // 'YES' or 'NO' cast to yes_or_no
  enforced: string; // Always 'YES' cast to yes_or_no
  owner: string;
};

export async function inspectConstraints(sql: Sql) {
  const constraints = await sql<InspectedConstraint[]>`
    with information_schema_table_constraints as (
      select
        nc.nspname::information_schema.sql_identifier as constraint_schema,
        c.conname::information_schema.sql_identifier as constraint_name,
        nr.nspname::information_schema.sql_identifier as table_schema,
        r.relname::information_schema.sql_identifier as table_name,
        case c.contype
        when 'c'::"char" then
          'CHECK'::text
        when 'f'::"char" then
          'FOREIGN KEY'::text
        when 'p'::"char" then
          'PRIMARY KEY'::text
        when 'u'::"char" then
          'UNIQUE'::text
        else
          null::text
        end::information_schema.character_data as constraint_type,
        case when c.condeferrable then
          'YES'::text
        else
          'NO'::text
        end::information_schema.yes_or_no as is_deferrable,
        case when c.condeferred then
          'YES'::text
        else
          'NO'::text
        end::information_schema.yes_or_no as initially_deferred,
        'YES'::character varying::information_schema.yes_or_no as enforced
      from
        pg_namespace nc,
        pg_namespace nr,
        pg_constraint c,
        pg_class r
      where
        nc.oid = c.connamespace
        and nr.oid = r.relnamespace
        and c.conrelid = r.oid
        and (c.contype <> all (array['t'::"char",
            'x'::"char"]))
        and (r.relkind = any (array['r'::"char",
            'p'::"char"]))
        and not pg_is_other_temp_schema(nr.oid)
        and (pg_has_role(r.relowner, 'USAGE'::text)
          or has_table_privilege(r.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'::text)
          or has_any_column_privilege(r.oid, 'SELECT, INSERT, UPDATE, REFERENCES'::text))
      union all
      select
        nr.nspname::information_schema.sql_identifier as constraint_schema,
        (((((nr.oid::text || '_'::text) || r.oid::text) || '_'::text) || a.attnum::text) || '_not_null'::text)::information_schema.sql_identifier as constraint_name,
        nr.nspname::information_schema.sql_identifier as table_schema,
        r.relname::information_schema.sql_identifier as table_name,
        'CHECK'::character varying::information_schema.character_data as constraint_type,
        'NO'::character varying::information_schema.yes_or_no as is_deferrable,
        'NO'::character varying::information_schema.yes_or_no as initially_deferred,
        'YES'::character varying::information_schema.yes_or_no as enforced
      from
        pg_namespace nr,
        pg_class r,
        pg_attribute a
      where
        nr.oid = r.relnamespace
        and r.oid = a.attrelid
        and a.attnotnull
        and a.attnum > 0
        and not a.attisdropped
        and (r.relkind = any (array['r'::"char",
            'p'::"char"]))
        and not pg_is_other_temp_schema(nr.oid)
        and (pg_has_role(r.relowner, 'USAGE'::text)
          or has_table_privilege(r.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'::text)
          or has_any_column_privilege(r.oid, 'SELECT, INSERT, UPDATE, REFERENCES'::text))
    ),
    extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_constraint'::regclass
    ),
    extension_rels as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_class'::regclass
    ),
    indexes as (
      select
        schemaname as schema,
        tablename as table_name,
        indexname as name,
        indexdef as definition,
        indexdef as create_statement
      from
        pg_indexes
        -- <EXCLUDE_INTERNAL>
        where schemaname not in ('pg_catalog', 'information_schema', 'pg_toast')
        and schemaname not like 'pg_temp_%' and schemaname not like 'pg_toast_temp_%'
        -- </EXCLUDE_INTERNAL>
      order by
        schemaname,
        tablename,
        indexname
    )
    select
      nspname as schema,
      conname as name,
      relname as table_name,
      pg_get_constraintdef(pg_constraint.oid) as definition,
      case contype
      when 'c' then
        'CHECK'
      when 'f' then
        'FOREIGN KEY'
      when 'p' then
        'PRIMARY KEY'
      when 'u' then
        'UNIQUE'
      when 'x' then
        'EXCLUDE'
      end as constraint_type,
      i.name as index,
      e.objid as extension_oid,
      case when contype = 'f' then
      (
        select
          nspname
        from
          pg_catalog.pg_class as c
          join pg_catalog.pg_namespace as ns on c.relnamespace = ns.oid
        where
          c.oid = confrelid::regclass)
      end as foreign_table_schema,
      case when contype = 'f' then
      (
        select
          relname
        from
          pg_catalog.pg_class c
        where
          c.oid = confrelid::regclass)
      end as foreign_table_name,
      case when contype = 'f' then
      (
        select
          array_agg(ta.attname order by c.rn)
        from
          pg_attribute ta
          join unnest(conkey)
          with ordinality c (cn, rn) on ta.attrelid = conrelid
            and ta.attnum = c.cn)
      else
        null
      end as fk_columns_local,
      case when contype = 'f' then
      (
        select
          array_agg(ta.attname order by c.rn)
        from
          pg_attribute ta
        join unnest(confkey)
        with ordinality c (cn, rn) on ta.attrelid = confrelid
          and ta.attnum = c.cn)
      else
        null
      end as fk_columns_foreign,
      contype = 'f' as is_fk,
      condeferrable as is_deferrable,
      condeferred as initially_deferred,
      pg_get_userbyid(pg_class.relowner) as owner
    from
      pg_constraint
      inner join pg_class on conrelid = pg_class.oid
      inner join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      left outer join indexes i on nspname = i.schema
        and conname = i.name
        and relname = i.table_name
      left outer join extension_oids e on pg_class.oid = e.objid
      left outer join extension_rels er on er.objid = conrelid
      left outer join extension_rels cr on cr.objid = confrelid
    where
      contype in ('c', 'f', 'p', 'u', 'x')
      -- <EXCLUDE_INTERNAL>
      and nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
      and e.objid is null and er.objid is null and cr.objid is null
      -- </EXCLUDE_INTERNAL>
    order by
      1,
      3,
      2;
`;

  return constraints;
}
