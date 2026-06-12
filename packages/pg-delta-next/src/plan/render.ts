/** SQL rendering primitives shared by the rule table. */
import type { StableId } from "../core/stable-id.ts";

export function qid(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function rel(schema: string, name: string): string {
  return `${qid(schema)}.${qid(name)}`;
}

export function routineSig(id: { schema: string; name: string; args: string[] }): string {
  return `${rel(id.schema, id.name)}(${id.args.join(", ")})`;
}

/** SQL identity phrase for COMMENT ON / GRANT targets, per target kind. */
export function commentTarget(id: StableId): string {
  switch (id.kind) {
    case "schema":
      return `SCHEMA ${qid(id.name)}`;
    case "table":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "view":
      return `VIEW ${rel(id.schema, id.name)}`;
    case "materializedView":
      return `MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
    case "sequence":
      return `SEQUENCE ${rel(id.schema, id.name)}`;
    case "index":
      return `INDEX ${rel(id.schema, id.name)}`;
    case "column":
      return `COLUMN ${rel(id.schema, id.table)}.${qid(id.name)}`;
    case "constraint":
      return `CONSTRAINT ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "trigger":
      return `TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "policy":
      return `POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "procedure":
      return `FUNCTION ${routineSig(id)}`;
    case "extension":
      return `EXTENSION ${qid(id.name)}`;
    case "role":
      return `ROLE ${qid(id.name)}`;
    default:
      throw new Error(`commentTarget: unsupported kind ${id.kind}`);
  }
}

/** GRANT/REVOKE object phrase per target kind. */
export function grantTarget(id: StableId): string {
  switch (id.kind) {
    case "table":
    case "view":
    case "materializedView":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "sequence":
      return `SEQUENCE ${rel(id.schema, id.name)}`;
    case "schema":
      return `SCHEMA ${qid(id.name)}`;
    case "procedure":
      return `FUNCTION ${routineSig(id)}`;
    default:
      throw new Error(`grantTarget: unsupported kind ${id.kind}`);
  }
}
