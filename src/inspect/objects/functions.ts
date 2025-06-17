import type { Sql } from "postgres";

export interface InspectedFunction {
  schema: string;
  name: string;
  returntype: string;
  has_user_defined_returntype: boolean;
  parameter_name: string | null;
  data_type: string;
  parameter_mode: string | null;
  parameter_default: string | null;
  position_number: number;
  definition: string;
  full_definition: string;
  language: string;
  strictness: string;
  security_type: string;
  volatility: string;
  kind: string;
  oid: number;
  extension_oid: number | null;
  result_string: string;
  identity_arguments: string;
  comment: string | null;
  owner: string;
}

export async function inspectFunctions(sql: Sql): Promise<InspectedFunction[]> {
  const functions = await sql<InspectedFunction[]>`
    with extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_proc'::regclass
    ),
    pg_proc_pre as (
      select
        pp.*,
        pp.oid as p_oid
      from
        pg_proc pp
    ),
    routines as (
      select
        current_database()::information_schema.sql_identifier as specific_catalog,
        n.nspname::information_schema.sql_identifier as specific_schema,
        --nameconcatoid(p.proname, p.oid)::information_schema.sql_identifier as specific_name,
        current_database()::information_schema.sql_identifier as routine_catalog,
        n.nspname::information_schema.sql_identifier as schema,
        p.proname::information_schema.sql_identifier as name,
        case p.prokind
        when 'f'::"char" then
          'FUNCTION'::text
        when 'p'::"char" then
          'PROCEDURE'::text
        else
          null::text
        end::information_schema.character_data as routine_type,
        case when p.prokind = 'p'::"char" then
          null::text
        when t.typelem <> 0::oid
          and t.typlen = '-1'::integer then
          'ARRAY'::text
        when nt.nspname = 'pg_catalog'::name then
          format_type(t.oid, null::integer)
        else
          'USER-DEFINED'::text
        end::information_schema.character_data as data_type,
        case when nt.nspname is not null then
          current_database()
        else
          null::name
        end::information_schema.sql_identifier as type_udt_catalog,
        nt.nspname::information_schema.sql_identifier as type_udt_schema,
        t.typname::information_schema.sql_identifier as type_udt_name,
        case when p.prokind <> 'p'::"char" then
          0
        else
          null::integer
        end::information_schema.sql_identifier as dtd_identifier,
        case when l.lanname = 'sql'::name then
          'SQL'::text
        else
          'EXTERNAL'::text
        end::information_schema.character_data as routine_body,
        case when pg_has_role(p.proowner, 'USAGE'::text) then
          p.prosrc
        else
          null::text
        end::information_schema.character_data as definition,
        case when l.lanname = 'c'::name then
          p.prosrc
        else
          null::text
        end::information_schema.character_data as external_name,
        upper(l.lanname::text)::information_schema.character_data as external_language,
        'GENERAL'::character varying::information_schema.character_data as parameter_style,
        case when p.provolatile = 'i'::"char" then
          'YES'::text
        else
          'NO'::text
        end::information_schema.yes_or_no as is_deterministic,
        'MODIFIES'::character varying::information_schema.character_data as sql_data_access,
        case when p.prokind <> 'p'::"char" then
          case when p.proisstrict then
            'YES'::text
          else
            'NO'::text
          end
        else
          null::text
        end::information_schema.yes_or_no as is_null_call,
        'YES'::character varying::information_schema.yes_or_no as schema_level_routine,
        0::information_schema.cardinal_number as max_dynamic_result_sets,
        case when p.prosecdef then
          'DEFINER'::text
        else
          'INVOKER'::text
        end::information_schema.character_data as security_type,
        'NO'::character varying::information_schema.yes_or_no as as_locator,
        'NO'::character varying::information_schema.yes_or_no as is_udt_dependent,
        p.p_oid as oid,
        p.proisstrict,
        p.prosecdef,
        p.provolatile,
        p.proargtypes,
        p.proallargtypes,
        p.proargnames,
        p.proargdefaults,
        p.proargmodes,
        p.proowner,
        p.prokind as kind
      from
        pg_namespace n
        join pg_proc_pre p on n.oid = p.pronamespace
        join pg_language l on p.prolang = l.oid
        left join (pg_type t
          join pg_namespace nt on t.typnamespace = nt.oid) on p.prorettype = t.oid
          and p.prokind <> 'p'::"char"
      where
        pg_has_role(p.proowner, 'USAGE'::text)
        or has_function_privilege(p.p_oid, 'EXECUTE'::text)
    ),
    pgproc as (
      select
        schema,
        name,
        p.oid as oid,
        e.objid as extension_oid,
        case proisstrict
        when true then
          'RETURNS NULL ON NULL INPUT'
        else
          'CALLED ON NULL INPUT'
        end as strictness,
        case prosecdef
        when true then
          'SECURITY DEFINER'
        else
          'SECURITY INVOKER'
        end as security_type,
        case provolatile
        when 'i' then
          'IMMUTABLE'
        when 's' then
          'STABLE'
        when 'v' then
          'VOLATILE'
        else
          null
        end as volatility,
        p.proargtypes,
        p.proallargtypes,
        p.proargnames,
        p.proargdefaults,
        p.proargmodes,
        p.proowner,
        coalesce(p.proallargtypes, p.proargtypes::oid[]) as procombinedargtypes,
        p.kind,
        p.type_udt_schema,
        p.type_udt_name,
        p.definition,
        p.external_language
      from
        routines p
        left outer join extension_oids e on p.oid = e.objid
      where
        p.kind != 'a'
        -- <EXCLUDE_INTERNAL>
        and schema not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
        and schema not like 'pg_temp_%' and schema not like 'pg_toast_temp_%'
        and e.objid is null
        and p.external_language not in ('C', 'INTERNAL')
        -- </EXCLUDE_INTERNAL>
    ),
    unnested as (
      select
        p.*,
        pname as parameter_name,
        pnum as position_number,
        case when pargmode is null then
          null
        when pargmode = 'i'::"char" then
          'IN'::text
        when pargmode = 'o'::"char" then
          'OUT'::text
        when pargmode = 'b'::"char" then
          'INOUT'::text
        when pargmode = 'v'::"char" then
          'IN'::text
        when pargmode = 't'::"char" then
          'OUT'::text
        else
          null::text
        end::information_schema.character_data as parameter_mode,
        case when t.typelem <> 0::oid
          and t.typlen = '-1'::integer then
          'ARRAY'::text
        else
          format_type(t.oid, null::integer)
        end::information_schema.character_data as data_type,
        case when pg_has_role(p.proowner, 'USAGE'::text) then
          pg_get_function_arg_default (p.oid, pnum::int)
        else
          null::text
        end::varchar as parameter_default
      from
        pgproc p
        left join lateral unnest(p.proargnames, p.proallargtypes, p.procombinedargtypes, p.proargmodes)
        with ordinality as uu (pname, pdatatype, pargtype, pargmode, pnum) on true
        left join pg_type t on t.oid = uu.pargtype
    ),
    pre as (
      select
        p.schema as schema,
        p.name as name,
        case when p.data_type = 'USER-DEFINED' then
          '"' || p.type_udt_schema || '"."' || p.type_udt_name || '"'
        else
          p.data_type
        end as returntype,
        p.data_type = 'USER-DEFINED' as has_user_defined_returntype,
        p.parameter_name as parameter_name,
        p.data_type as data_type,
        p.parameter_mode as parameter_mode,
        p.parameter_default as parameter_default,
        p.position_number as position_number,
        p.definition as definition,
        pg_get_functiondef(p.oid) as full_definition,
      p.external_language as
      language,
      p.strictness as strictness,
      p.security_type as security_type,
      p.volatility as volatility,
      p.kind as kind,
      p.oid as oid,
      p.extension_oid as extension_oid,
      pg_get_function_result(p.oid) as result_string,
      pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.obj_description(p.oid) as comment,
    pg_get_userbyid(p.proowner) as owner
    from
      unnested p
    )
    select
      *
    from
      pre
    order by
      schema,
      name,
      parameter_mode,
      position_number,
      parameter_name;
  `;

  return functions;
}
