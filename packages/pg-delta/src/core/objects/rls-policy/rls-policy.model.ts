import { sql } from "@ts-safeql/sql-tag";
import type { Pool } from "pg";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const RlsPolicyCommandSchema = z.enum([
  "r", // SELECT command
  "a", // INSERT command (add)
  "w", // UPDATE command (write)
  "d", // DELETE command
  "*", // ALL commands
]);

const RlsPolicyReferencedRelationKindSchema = z.enum([
  "table",
  "view",
  "materialized_view",
  "foreign_table",
]);

const rlsPolicyReferencedRelationSchema = z.object({
  kind: RlsPolicyReferencedRelationKindSchema,
  schema: z.string(),
  name: z.string(),
});

export type RlsPolicyReferencedRelation = z.infer<
  typeof rlsPolicyReferencedRelationSchema
>;

const rlsPolicyReferencedProcedureSchema = z.object({
  schema: z.string(),
  name: z.string(),
  argument_types: z.array(z.string()),
});

export type RlsPolicyReferencedProcedure = z.infer<
  typeof rlsPolicyReferencedProcedureSchema
>;

const rlsPolicyPropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  table_name: z.string(),
  command: RlsPolicyCommandSchema,
  permissive: z.boolean(),
  roles: z.array(z.string()),
  using_expression: z.string().nullable(),
  with_check_expression: z.string().nullable(),
  owner: z.string(),
  comment: z.string().nullable(),
  referenced_relations: z.array(rlsPolicyReferencedRelationSchema),
  referenced_procedures: z.array(rlsPolicyReferencedProcedureSchema),
});

export type RlsPolicyProps = z.infer<typeof rlsPolicyPropsSchema>;

export class RlsPolicy extends BasePgModel {
  public readonly schema: RlsPolicyProps["schema"];
  public readonly name: RlsPolicyProps["name"];
  public readonly table_name: RlsPolicyProps["table_name"];
  public readonly command: RlsPolicyProps["command"];
  public readonly permissive: RlsPolicyProps["permissive"];
  public readonly roles: RlsPolicyProps["roles"];
  public readonly using_expression: RlsPolicyProps["using_expression"];
  public readonly with_check_expression: RlsPolicyProps["with_check_expression"];
  public readonly owner: RlsPolicyProps["owner"];
  public readonly comment: RlsPolicyProps["comment"];
  /**
   * Tables / views / materialized views / foreign tables that
   * `using_expression` / `with_check_expression` reference, sourced from
   * `pg_depend` (`recordDependencyOnExpr` at policy creation). Drives
   * ordering dependencies in `CreateRlsPolicy.requires`. Intentionally
   * excluded from `dataFields` — it's derived from the expression text
   * and changes lockstep with it.
   */
  public readonly referenced_relations: RlsPolicyProps["referenced_relations"];
  /**
   * Functions / procedures that `using_expression` / `with_check_expression`
   * reference, sourced from `pg_depend` (refclassid = `pg_proc`). The
   * argument-type signature comes straight from `pg_proc.proargtypes` via
   * `format_type`, so it matches the signature the procedure extractor
   * embeds in `stableId.procedure(...)`. Not part of `dataFields`.
   */
  public readonly referenced_procedures: RlsPolicyProps["referenced_procedures"];

  constructor(props: RlsPolicyProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;
    this.table_name = props.table_name;

    // Data fields
    this.command = props.command;
    this.permissive = props.permissive;
    this.roles = props.roles;
    this.using_expression = props.using_expression;
    this.with_check_expression = props.with_check_expression;
    this.owner = props.owner;
    this.comment = props.comment;

    // Derived metadata (not part of equality)
    this.referenced_relations = props.referenced_relations;
    this.referenced_procedures = props.referenced_procedures;
  }

  get stableId(): `rlsPolicy:${string}` {
    return `rlsPolicy:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      table_name: this.table_name,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      command: this.command,
      permissive: this.permissive,
      roles: this.roles,
      using_expression: this.using_expression,
      with_check_expression: this.with_check_expression,
      owner: this.owner,
      comment: this.comment,
    };
  }
}

export async function extractRlsPolicies(pool: Pool): Promise<RlsPolicy[]> {
  const { rows: policyRows } = await pool.query<RlsPolicyProps>(sql`
with extension_policy_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_policy'::regclass
),
extension_table_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
    and d.deptype = 'e'
),
policy_relation_deps as (
  -- Relations referenced inside polqual / polwithcheck. PostgreSQL records
  -- these via recordDependencyOnExpr(..., DEPENDENCY_NORMAL = 'n') at
  -- CREATE POLICY time, so pg_depend is authoritative and we don't need to
  -- re-parse the expression text. Covers regular tables, partitioned
  -- tables, views, materialized views, and foreign tables — any relation
  -- kind the policy can reference in a subquery.
  select distinct
    d.objid                 as policy_oid,
    case ref_c.relkind
      when 'r' then 'table'
      when 'p' then 'table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      when 'f' then 'foreign_table'
    end                     as ref_kind,
    ref_ns.nspname          as ref_schema,
    ref_c.relname           as ref_name
  from
    pg_depend d
    join pg_policy p on p.oid = d.objid
    join pg_class ref_c on ref_c.oid = d.refobjid
    join pg_namespace ref_ns on ref_ns.oid = ref_c.relnamespace
  where
    d.classid = 'pg_policy'::regclass
    and d.refclassid = 'pg_class'::regclass
    and d.deptype = 'n'
    and ref_c.relkind in ('r', 'p', 'v', 'm', 'f')
    and d.refobjid <> p.polrelid
),
policy_procedure_deps as (
  -- Functions / procedures referenced inside polqual / polwithcheck. Same
  -- pg_depend mechanism as above, just refclassid = pg_proc. proargtypes
  -- formatted via format_type(oid, null) matches the signature produced by
  -- the procedure extractor (see procedure.model.ts), so stableId.procedure
  -- on both sides of the diff lines up exactly.
  select distinct
    d.objid            as policy_oid,
    ref_ns.nspname     as ref_schema,
    ref_p.proname      as ref_name,
    array(
      select format_type(oid, null)
      from unnest(ref_p.proargtypes) as oid
    )                  as ref_argument_types
  from
    pg_depend d
    join pg_proc ref_p on ref_p.oid = d.refobjid
    join pg_namespace ref_ns on ref_ns.oid = ref_p.pronamespace
  where
    d.classid = 'pg_policy'::regclass
    and d.refclassid = 'pg_proc'::regclass
    and d.deptype = 'n'
)
select
  tc.relnamespace::regnamespace::text as schema,
  quote_ident(p.polname) as name,
  quote_ident(tc.relname) as table_name,
  p.polcmd as command,
  p.polpermissive as permissive,
  case
    when p.polroles = '{0}' then array['public']::text[]
    else array(
      select quote_ident(rolname)
      from pg_catalog.pg_roles
      where oid = any(p.polroles)
      order by rolname
    )
  end as roles,
  pg_get_expr(p.polqual, p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression,
  tc.relowner::regrole::text as owner,
  obj_description(p.oid, 'pg_policy') as comment,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'kind', prd.ref_kind,
          'schema', prd.ref_schema,
          'name', prd.ref_name
        )
        order by prd.ref_schema, prd.ref_name
      )
      from policy_relation_deps prd
      where prd.policy_oid = p.oid
    ),
    '[]'
  ) as referenced_relations,
  coalesce(
    (
      select json_agg(
        json_build_object(
          'schema', ppd.ref_schema,
          'name', ppd.ref_name,
          'argument_types', ppd.ref_argument_types
        )
        order by ppd.ref_schema, ppd.ref_name, ppd.ref_argument_types
      )
      from policy_procedure_deps ppd
      where ppd.policy_oid = p.oid
    ),
    '[]'
  ) as referenced_procedures
from
  pg_catalog.pg_policy p
  inner join pg_catalog.pg_class tc on tc.oid = p.polrelid
  left outer join extension_policy_oids e_policy on p.oid = e_policy.objid
  left outer join extension_table_oids e_table on tc.oid = e_table.objid
  where not tc.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e_policy.objid is null
  and e_table.objid is null
order by
  1, 2
  `);
  // Validate and parse each row using the Zod schema
  const validatedRows = policyRows.map((row: unknown) =>
    rlsPolicyPropsSchema.parse(row),
  );
  return validatedRows.map((row: RlsPolicyProps) => new RlsPolicy(row));
}
