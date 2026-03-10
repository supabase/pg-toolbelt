import { sql } from "@ts-safeql/sql-tag";
import { Effect, Schema } from "effect";
import type { Pool } from "pg";
import { CatalogExtractionError } from "../../errors.ts";
import type { DatabaseApi } from "../../services/database.ts";
import { BasePgModel } from "../base.model.ts";
import { stableId } from "../utils.ts";

const RuleEventSchema = Schema.Literal("SELECT", "INSERT", "UPDATE", "DELETE");
const RuleEnabledStateSchema = Schema.Literal("O", "D", "R", "A");

const RuleRelationKindSchema = Schema.Literal(
  "r", // ordinary table
  "p", // partitioned table
  "f", // foreign table
  "v", // view
  "m", // materialized view
);

const rulePropsSchema = Schema.mutable(
  Schema.Struct({
    schema: Schema.String,
    name: Schema.String,
    table_name: Schema.String,
    relation_kind: RuleRelationKindSchema,
    event: RuleEventSchema,
    enabled: RuleEnabledStateSchema,
    is_instead: Schema.Boolean,
    owner: Schema.String,
    definition: Schema.String,
    comment: Schema.NullOr(Schema.String),
    columns: Schema.mutable(Schema.Array(Schema.String)),
  }),
);

export type RuleEnabledState = typeof RuleEnabledStateSchema.Type;
export type RuleProps = typeof rulePropsSchema.Type;

export class Rule extends BasePgModel {
  public readonly schema: RuleProps["schema"];
  public readonly name: RuleProps["name"];
  public readonly table_name: RuleProps["table_name"];
  public readonly relation_kind: RuleProps["relation_kind"];
  public readonly event: RuleProps["event"];
  public readonly enabled: RuleProps["enabled"];
  public readonly is_instead: RuleProps["is_instead"];
  public readonly owner: RuleProps["owner"];
  public readonly definition: RuleProps["definition"];
  public readonly comment: RuleProps["comment"];
  public readonly columns: RuleProps["columns"];

  constructor(props: RuleProps) {
    super();

    this.schema = props.schema;
    this.name = props.name;
    this.table_name = props.table_name;
    this.relation_kind = props.relation_kind;
    this.event = props.event;
    this.enabled = props.enabled;
    this.is_instead = props.is_instead;
    this.owner = props.owner;
    this.definition = props.definition;
    this.comment = props.comment;
    this.columns = props.columns;
  }

  get stableId(): `rule:${string}` {
    return `rule:${this.schema}.${this.table_name}.${this.name}`;
  }

  get identityFields() {
    return {
      schema: this.schema,
      name: this.name,
      table_name: this.table_name,
    };
  }

  get dataFields() {
    return {
      event: this.event,
      enabled: this.enabled,
      is_instead: this.is_instead,
      owner: this.owner,
      definition: this.definition,
      comment: this.comment,
      columns: this.columns,
    };
  }

  get relationStableId(): string {
    switch (this.relation_kind) {
      case "v":
        return stableId.view(this.schema, this.table_name);
      case "m":
        return stableId.materializedView(this.schema, this.table_name);
      default:
        return stableId.table(this.schema, this.table_name);
    }
  }
}

export async function extractRules(pool: Pool): Promise<Rule[]> {
  const { rows: ruleRows } = await pool.query<RuleProps>(sql`
      WITH extension_rule_oids AS (
        SELECT
          objid
        FROM
          pg_depend d
        WHERE
          d.refclassid = 'pg_extension'::regclass
          AND d.classid = 'pg_rewrite'::regclass
      ),
      extension_relation_oids AS (
        SELECT
          objid
        FROM
          pg_depend d
        WHERE
          d.refclassid = 'pg_extension'::regclass
          AND d.classid = 'pg_class'::regclass
          AND d.deptype = 'e'
      )
      SELECT
        c.relnamespace::regnamespace::text AS schema,
        quote_ident(r.rulename) AS name,
        quote_ident(c.relname) AS table_name,
        c.relkind AS relation_kind,
        CASE r.ev_type
          WHEN '1' THEN 'SELECT'
          WHEN '2' THEN 'UPDATE'
          WHEN '3' THEN 'INSERT'
          WHEN '4' THEN 'DELETE'
          ELSE NULL
        END AS event,
        r.ev_enabled AS enabled,
        r.is_instead,
        c.relowner::regrole::text AS owner,
        pg_get_ruledef(r.oid, true) AS definition,
        obj_description(r.oid, 'pg_rewrite') AS comment,
        COALESCE(
          (
            SELECT json_agg(quote_ident(att.attname) ORDER BY dep.refobjsubid)
            FROM pg_depend dep
            JOIN pg_attribute att
              ON att.attrelid = dep.refobjid
             AND att.attnum = dep.refobjsubid
             AND att.attnum > 0
             AND NOT att.attisdropped
            WHERE dep.classid = 'pg_rewrite'::regclass
              AND dep.objid = r.oid
              AND dep.refclassid = 'pg_class'::regclass
              AND dep.refobjid = c.oid
              AND dep.refobjsubid > 0
          ), '[]'
        ) AS columns
      FROM
        pg_catalog.pg_rewrite r
        JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
        LEFT JOIN extension_rule_oids e_rule ON r.oid = e_rule.objid
        LEFT JOIN extension_relation_oids e_rel ON c.oid = e_rel.objid
      WHERE
        NOT c.relnamespace::regnamespace::text LIKE ANY (ARRAY['pg\\_%', 'information\\_schema'])
        AND e_rule.objid IS NULL
        AND e_rel.objid IS NULL
        AND r.rulename <> '_RETURN'
      ORDER BY
        1, 3, 2
  `);

  const validatedRows = ruleRows.map((row: unknown) =>
    Schema.decodeUnknownSync(rulePropsSchema)(row),
  );

  return validatedRows.map((row) => new Rule(row));
}

// ============================================================================
// Effect-native version
// ============================================================================

export const extractRulesEffect = (
  db: DatabaseApi,
): Effect.Effect<Rule[], CatalogExtractionError> =>
  Effect.tryPromise({
    try: () => extractRules(db.getPool()),
    catch: (err) =>
      new CatalogExtractionError({
        message: `extractRules failed: ${err instanceof Error ? err.message : err}`,
        extractor: "extractRules",
        cause: err,
      }),
  });
