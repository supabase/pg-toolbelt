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

export function routineSig(id: {
  schema: string;
  name: string;
  args: string[];
}): string {
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
    case "aggregate":
      return `AGGREGATE ${routineSig(id)}`;
    case "extension":
      return `EXTENSION ${qid(id.name)}`;
    case "role":
      return `ROLE ${qid(id.name)}`;
    case "domain":
      return `DOMAIN ${rel(id.schema, id.name)}`;
    case "type":
      return `TYPE ${rel(id.schema, id.name)}`;
    case "collation":
      return `COLLATION ${rel(id.schema, id.name)}`;
    case "foreignTable":
      return `FOREIGN TABLE ${rel(id.schema, id.name)}`;
    case "rule":
      return `RULE ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "eventTrigger":
      return `EVENT TRIGGER ${qid(id.name)}`;
    case "publication":
      return `PUBLICATION ${qid(id.name)}`;
    case "subscription":
      return `SUBSCRIPTION ${qid(id.name)}`;
    case "fdw":
      return `FOREIGN DATA WRAPPER ${qid(id.name)}`;
    case "server":
      return `SERVER ${qid(id.name)}`;
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
    case "aggregate":
      return `FUNCTION ${routineSig(id)}`;
    case "domain":
    case "type":
      return `TYPE ${rel(id.schema, id.name)}`;
    case "foreignTable":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "fdw":
      return `FOREIGN DATA WRAPPER ${qid(id.name)}`;
    case "server":
      return `FOREIGN SERVER ${qid(id.name)}`;
    default:
      throw new Error(`grantTarget: unsupported kind ${id.kind}`);
  }
}

/** "k=v" option strings (as stored in pg_*options) → OPTIONS clause pieces. */
export function splitOption(opt: string): [key: string, value: string] {
  const i = opt.indexOf("=");
  return i === -1 ? [opt, ""] : [opt.slice(0, i), opt.slice(i + 1)];
}

export function optionsClause(options: string[]): string {
  if (options.length === 0) return "";
  const parts = options.map((opt) => {
    const [key, value] = splitOption(opt);
    return `${qid(key)} ${lit(value)}`;
  });
  return ` OPTIONS (${parts.join(", ")})`;
}

/** ALTER … OPTIONS (ADD/SET/DROP …) clause from old vs new option lists. */
export function alterOptionsClause(
  oldOptions: string[],
  newOptions: string[],
): string {
  const oldMap = new Map(oldOptions.map(splitOption));
  const newMap = new Map(newOptions.map(splitOption));
  const parts: string[] = [];
  for (const [key, value] of newMap) {
    if (!oldMap.has(key)) parts.push(`ADD ${qid(key)} ${lit(value)}`);
    else if (oldMap.get(key) !== value) parts.push(`SET ${qid(key)} ${lit(value)}`);
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) parts.push(`DROP ${qid(key)}`);
  }
  return `OPTIONS (${parts.join(", ")})`;
}
