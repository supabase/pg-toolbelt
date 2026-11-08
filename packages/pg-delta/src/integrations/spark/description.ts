/**
 * The Spark schema description: the JSON a Spark project serves at
 * `GET /_spark/v1/schema` and returns from `POST /_spark/v1/scratch`. Spark has
 * no Postgres catalog to extract from, so this document is its whole schema
 * state. Text fields follow Postgres' own renderings (`format_type`,
 * `pg_get_expr`, `pg_get_constraintdef`, `pg_get_indexdef`).
 */

export interface SparkSchema {
  name: string;
  comment: string | null;
}

export interface SparkEnum {
  schema: string;
  name: string;
  labels: string[];
  comment: string | null;
}

export interface SparkColumn {
  name: string;
  position: number;
  /** `format_type` form, e.g. `bigint`, `text[]`, `public.status`. */
  type: string;
  not_null: boolean;
  /** `pg_get_expr` form of the default, e.g. `now()`. */
  default: string | null;
  /** `a` always | `d` by default | null. */
  identity: "a" | "d" | null;
  /** Stored generated expression. */
  generated: string | null;
  comment: string | null;
}

export interface SparkConstraint {
  name: string;
  type: "p" | "u" | "f" | "c";
  /** `pg_get_constraintdef` form. */
  def: string;
  columns: string[];
  references: { schema: string; table: string; columns: string[] } | null;
}

export interface SparkIndex {
  name: string;
  /** `pg_get_indexdef` form. */
  def: string;
  unique: boolean;
  /** Name of the p/u constraint this index backs, if any. */
  constraint: string | null;
}

export interface SparkPolicy {
  name: string;
  /** r select | a insert | w update | d delete | * all */
  cmd: "r" | "a" | "w" | "d" | "*";
  permissive: boolean;
  roles: string[];
  using: string | null;
  check: string | null;
}

export interface SparkTable {
  schema: string;
  name: string;
  /** Spark/Supabase-owned (e.g. `auth.users`): reference only. */
  managed: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  comment: string | null;
  columns: SparkColumn[];
  constraints: SparkConstraint[];
  indexes: SparkIndex[];
  policies: SparkPolicy[];
}

export interface SparkView {
  schema: string;
  name: string;
  def: string;
  depends_on: { schema: string; name: string }[];
  comment: string | null;
}

/** A Spark project's schema, as served by `GET /_spark/v1/schema`. */
export interface SparkSchemaDescription {
  schema_version?: string;
  managed_schemas: string[];
  schemas: SparkSchema[];
  enums: SparkEnum[];
  tables: SparkTable[];
  views: SparkView[];
}

/** Per-statement outcome Spark reports for scratch loads and dry runs. */
export interface SparkStatementStatus {
  file: string;
  index: number;
  line: number;
  kind: string;
  status: "ok" | "rewritten" | "ignored" | "unsupported" | "error";
  message?: string | null;
}
