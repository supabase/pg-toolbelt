import type { Sql } from "postgres";
import z from "zod";
import { BasePgModel } from "../base.model.ts";

const TypeKindSchema = z.enum([
  "b", // base type
  "c", // composite type
  "d", // domain
  "e", // enum type
  "p", // pseudo-type
  "r", // range type
]);

const TypeCategorySchema = z.enum([
  "A", // Array types
  "B", // Boolean types
  "C", // Composite types
  "D", // Date/time types
  "E", // Enum types
  "G", // Geometric types
  "I", // Network address types
  "N", // Numeric types
  "P", // Pseudo-types
  "R", // Range types
  "S", // String types
  "T", // Timespan types
  "U", // User-defined types
  "V", // Bit-string types
  "X", // unknown type
]);

const TypeAlignmentSchema = z.enum([
  "c", // char alignment (1 byte)
  "s", // short alignment (2 bytes)
  "i", // int alignment (4 bytes)
  "d", // double alignment (8 bytes)
]);

const TypeStorageSchema = z.enum([
  "p", // plain storage
  "e", // external storage
  "m", // main storage
  "x", // extended storage
]);

export type TypeKind = z.infer<typeof TypeKindSchema>;
export type TypeCategory = z.infer<typeof TypeCategorySchema>;
type TypeAlignment = z.infer<typeof TypeAlignmentSchema>;
type TypeStorage = z.infer<typeof TypeStorageSchema>;

const typePropsSchema = z.object({
  schema: z.string(),
  name: z.string(),
  type_type: TypeKindSchema,
  type_category: TypeCategorySchema,
  is_preferred: z.boolean(),
  is_defined: z.boolean(),
  delimiter: z.string(),
  storage_length: z.number(),
  passed_by_value: z.boolean(),
  alignment: TypeAlignmentSchema,
  storage: TypeStorageSchema,
  not_null: z.boolean(),
  type_modifier: z.number().nullable(),
  array_dimensions: z.number().nullable(),
  default_bin: z.string().nullable(),
  default_value: z.string().nullable(),
  owner: z.string(),
  range_subtype: z.string().nullable(),
});

export type TypeProps = z.infer<typeof typePropsSchema>;

export class Type extends BasePgModel {
  public readonly schema: TypeProps["schema"];
  public readonly name: TypeProps["name"];
  public readonly type_type: TypeProps["type_type"];
  public readonly type_category: TypeProps["type_category"];
  public readonly is_preferred: TypeProps["is_preferred"];
  public readonly is_defined: TypeProps["is_defined"];
  public readonly delimiter: TypeProps["delimiter"];
  public readonly storage_length: TypeProps["storage_length"];
  public readonly passed_by_value: TypeProps["passed_by_value"];
  public readonly alignment: TypeProps["alignment"];
  public readonly storage: TypeProps["storage"];
  public readonly not_null: TypeProps["not_null"];
  public readonly type_modifier: TypeProps["type_modifier"];
  public readonly array_dimensions: TypeProps["array_dimensions"];
  public readonly default_bin: TypeProps["default_bin"];
  public readonly default_value: TypeProps["default_value"];
  public readonly owner: TypeProps["owner"];
  public readonly range_subtype: TypeProps["range_subtype"];

  constructor(props: TypeProps) {
    super();

    // Identity fields
    this.schema = props.schema;
    this.name = props.name;

    // Data fields
    this.type_type = props.type_type;
    this.type_category = props.type_category;
    this.is_preferred = props.is_preferred;
    this.is_defined = props.is_defined;
    this.delimiter = props.delimiter;
    this.storage_length = props.storage_length;
    this.passed_by_value = props.passed_by_value;
    this.alignment = props.alignment;
    this.storage = props.storage;
    this.not_null = props.not_null;
    this.type_modifier = props.type_modifier;
    this.array_dimensions = props.array_dimensions;
    this.default_bin = props.default_bin;
    this.default_value = props.default_value;
    this.owner = props.owner;
    this.range_subtype = props.range_subtype;
  }

  get stableId(): `type:${string}` {
    return `type:${this.schema}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
    };
  }

  get dataFields() {
    return {
      type_type: this.type_type,
      type_category: this.type_category,
      is_preferred: this.is_preferred,
      is_defined: this.is_defined,
      delimiter: this.delimiter,
      storage_length: this.storage_length,
      passed_by_value: this.passed_by_value,
      alignment: this.alignment,
      storage: this.storage,
      not_null: this.not_null,
      type_modifier: this.type_modifier,
      array_dimensions: this.array_dimensions,
      default_bin: this.default_bin,
      default_value: this.default_value,
      owner: this.owner,
      range_subtype: this.range_subtype,
    };
  }
}

export async function extractTypes(sql: Sql): Promise<Type[]> {
  return sql.begin(async (sql) => {
    await sql`set search_path = ''`;
    const typeRows = await sql`
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
  n.nspname as schema,
  t.typname as name,
  t.typtype as type_type,
  t.typcategory as type_category,
  t.typispreferred as is_preferred,
  t.typisdefined as is_defined,
  t.typdelim as delimiter,
  t.typlen as storage_length,
  t.typbyval as passed_by_value,
  t.typalign as alignment,
  t.typstorage as storage,
  t.typnotnull as not_null,
  t.typtypmod as type_modifier,
  t.typndims as array_dimensions,
  pg_get_expr(t.typdefaultbin, 0) as default_bin,
  t.typdefault as default_value,
  pg_get_userbyid(t.typowner) as owner,
  format_type(r.rngsubtype, 0) as range_subtype
from
  pg_catalog.pg_type t
  inner join pg_catalog.pg_namespace n on n.oid = t.typnamespace
  left outer join extension_oids e on t.oid = e.objid
  left outer join pg_catalog.pg_type elem_type on t.typelem = elem_type.oid
  left outer join pg_catalog.pg_range r on t.oid = r.rngtypid
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
  and e.objid is null
  and t.typtype in ('b','c', 'd', 'e', 'p', 'r')
  -- Exclude internal auto-generated types (e.g custom type create an internal _customType type)
  and not exists (
    select 1 from pg_catalog.pg_depend d
    where d.classid = 1247  -- pg_type
    and d.objid = t.oid
    and d.deptype = 'i'  -- internal dependency (auto-generated)
  )
order by
  1, 2;
    `;
    // Validate and parse each row using the Zod schema
    const validatedRows = typeRows.map((row: unknown) =>
      typePropsSchema.parse(row),
    );
    return validatedRows.map((row: TypeProps) => new Type(row));
  });
}
