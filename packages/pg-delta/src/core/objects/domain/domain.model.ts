import { sql } from "@ts-safeql/sql-tag";
import { Effect, Schema } from "effect";
import type { Pool } from "pg";
import { CatalogExtractionError } from "../../errors.ts";
import type { DatabaseApi } from "../../services/database.ts";
import { BasePgModel } from "../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../base.privilege-diff.ts";

const domainConstraintPropsSchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String,
    validated: Schema.Boolean,
    is_local: Schema.Boolean,
    no_inherit: Schema.Boolean,
    check_expression: Schema.NullOr(Schema.String),
  }),
);

const domainPropsSchema = Schema.mutable(
  Schema.Struct({
    schema: Schema.String,
    name: Schema.String,
    base_type: Schema.String,
    base_type_schema: Schema.String,
    base_type_str: Schema.optional(Schema.String),
    not_null: Schema.Boolean,
    type_modifier: Schema.NullOr(Schema.Number),
    array_dimensions: Schema.NullOr(Schema.Number),
    collation: Schema.NullOr(Schema.String),
    default_bin: Schema.NullOr(Schema.String),
    default_value: Schema.NullOr(Schema.String),
    owner: Schema.String,
    comment: Schema.NullOr(Schema.String),
    constraints: Schema.mutable(Schema.Array(domainConstraintPropsSchema)),
    privileges: Schema.mutable(Schema.Array(privilegePropsSchema)),
  }),
);

export type DomainConstraintProps = typeof domainConstraintPropsSchema.Type;
type DomainPrivilegeProps = PrivilegeProps;
export type DomainProps = typeof domainPropsSchema.Type;

/**
 * A domain is a user-defined data type that is based on another underlying type.
 *
 * @see https://www.postgresql.org/docs/17/domains.html
 */
export class Domain extends BasePgModel {
  public readonly schema: DomainProps["schema"];
  public readonly name: DomainProps["name"];
  public readonly base_type: DomainProps["base_type"];
  public readonly base_type_schema: DomainProps["base_type_schema"];
  public readonly base_type_str?: DomainProps["base_type_str"];
  public readonly not_null: DomainProps["not_null"];
  public readonly type_modifier: DomainProps["type_modifier"];
  public readonly array_dimensions: DomainProps["array_dimensions"];
  public readonly collation: DomainProps["collation"];
  public readonly default_bin: DomainProps["default_bin"];
  public readonly default_value: DomainProps["default_value"];
  public readonly owner: DomainProps["owner"];
  public readonly comment: DomainProps["comment"];
  public readonly constraints: DomainConstraintProps[];
  public readonly privileges: DomainPrivilegeProps[];

  constructor(props: DomainProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.base_type = props.base_type;
    this.base_type_schema = props.base_type_schema;
    this.base_type_str = props.base_type_str;
    this.not_null = props.not_null;
    this.type_modifier = props.type_modifier;
    this.array_dimensions = props.array_dimensions;
    this.collation = props.collation;
    this.default_bin = props.default_bin;
    this.default_value = props.default_value;
    this.owner = props.owner;
    this.comment = props.comment;
    this.constraints = props.constraints;
    this.privileges = props.privileges;
  }

  get stableId(): `domain:${string}` {
    return `domain:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      base_type: this.base_type,
      base_type_schema: this.base_type_schema,
      not_null: this.not_null,
      type_modifier: this.type_modifier,
      array_dimensions: this.array_dimensions,
      collation: this.collation,
      default_bin: this.default_bin,
      default_value: this.default_value,
      owner: this.owner,
      comment: this.comment,
      constraints: this.constraints,
      privileges: this.privileges,
    };
  }
}

/**
 * Extract all domains from the database.
 *
 * @param sql - The SQL client.
 * @returns A list of domains.
 */
export async function extractDomains(pool: Pool): Promise<Domain[]> {
  const { rows: domainRows } = await pool.query<DomainProps>(sql`
      with extension_oids as (
        select
          objid
        from
          pg_depend d
        where
          d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_type'::regclass
      )
      select
        t.typnamespace::regnamespace::text as schema,
        quote_ident(t.typname) as name,
        bt.typname as base_type,
        bt.typnamespace::regnamespace::text as base_type_schema,
        format_type(t.typbasetype, t.typtypmod) as base_type_str,
        t.typnotnull as not_null,
        t.typtypmod as type_modifier,
        t.typndims as array_dimensions,
        case when t.typcollation <> bt.typcollation then quote_ident(c.collname) else null end as collation,
        pg_get_expr(t.typdefaultbin, 0) as default_bin,
        t.typdefault as default_value,
        t.typowner::regrole::text as owner,
        obj_description(t.oid, 'pg_type') as comment,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'name', quote_ident(con.conname),
                'validated', con.convalidated,
                'is_local', con.conislocal,
                'no_inherit', con.connoinherit,
                'check_expression', pg_get_expr(con.conbin, 0)
              )
              order by con.conname
            )
            from pg_catalog.pg_constraint con
            where con.contypid = t.oid
          ), '[]'
        ) as constraints,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                'privilege', x.privilege_type,
                'grantable', x.is_grantable
              )
              order by x.grantee, x.privilege_type
            )
            from lateral aclexplode(COALESCE(t.typacl, acldefault('T', t.typowner))) as x(grantor, grantee, privilege_type, is_grantable)
          ), '[]'
        ) as privileges
      from
        pg_catalog.pg_type t
        inner join pg_catalog.pg_type bt on bt.oid = t.typbasetype
        left join pg_catalog.pg_collation c on c.oid = t.typcollation
        left outer join extension_oids e on t.oid = e.objid
        where not t.typnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
        and e.objid is null
        and t.typtype = 'd'
      order by
        1, 2
  `);
  // Validate and parse each row using the schema
  const validatedRows = domainRows.map((row: unknown) =>
    Schema.decodeUnknownSync(domainPropsSchema)(row),
  );
  return validatedRows.map((row: DomainProps) => new Domain(row));
}

// ============================================================================
// Effect-native version
// ============================================================================

export const extractDomainsEffect = (
  db: DatabaseApi,
): Effect.Effect<Domain[], CatalogExtractionError> =>
  Effect.tryPromise({
    try: () => extractDomains(db.getPool()),
    catch: (err) =>
      new CatalogExtractionError({
        message: `extractDomains failed: ${err instanceof Error ? err.message : err}`,
        extractor: "extractDomains",
        cause: err,
      }),
  });
