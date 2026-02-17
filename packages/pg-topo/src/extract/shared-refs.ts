import { createObjectRefFromAst, DEFAULT_SCHEMA } from "../model/object-ref.ts";
import type { ObjectRef } from "../model/types.ts";
import { asRecord } from "../utils/ast.ts";

export const extractStringValue = (node: unknown): string | undefined => {
  const nodeRecord = asRecord(node);
  if (!nodeRecord) {
    return undefined;
  }

  const stringNode = asRecord(nodeRecord.String);
  const value = stringNode?.sval;
  return typeof value === "string" ? value : undefined;
};

export const extractNameParts = (parts: unknown): string[] => {
  if (!Array.isArray(parts)) {
    return [];
  }
  const result: string[] = [];
  for (const part of parts) {
    const stringValue = extractStringValue(part);
    if (stringValue) {
      result.push(stringValue);
    }
  }
  return result;
};

export const objectKindFromObjType = (
  objType: unknown,
): ObjectRef["kind"] | null => {
  switch (objType) {
    case "OBJECT_AGGREGATE":
      return "aggregate";
    case "OBJECT_COLLATION":
      return "collation";
    case "OBJECT_DOMAIN":
      return "domain";
    case "OBJECT_EXTENSION":
      return "extension";
    case "OBJECT_EVENT_TRIGGER":
      return "event_trigger";
    case "OBJECT_FDW":
      return "foreign_data_wrapper";
    case "OBJECT_FOREIGN_SERVER":
      return "foreign_server";
    case "OBJECT_FUNCTION":
      return "function";
    case "OBJECT_INDEX":
      return "index";
    case "OBJECT_LANGUAGE":
      return "language";
    case "OBJECT_MATVIEW":
      return "materialized_view";
    case "OBJECT_POLICY":
      return "policy";
    case "OBJECT_PROCEDURE":
      return "procedure";
    case "OBJECT_PUBLICATION":
      return "publication";
    case "OBJECT_ROLE":
      return "role";
    case "OBJECT_SCHEMA":
      return "schema";
    case "OBJECT_SEQUENCE":
      return "sequence";
    case "OBJECT_SUBSCRIPTION":
      return "subscription";
    case "OBJECT_TABLE":
      return "table";
    case "OBJECT_TRIGGER":
      return "trigger";
    case "OBJECT_TYPE":
      return "type";
    case "OBJECT_VIEW":
      return "view";
    default:
      return null;
  }
};

export const objectFromNameParts = (
  kind: ObjectRef["kind"],
  parts: string[],
  fallbackSchema: string = DEFAULT_SCHEMA,
): ObjectRef | null => {
  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    const first = parts[0];
    if (!first) {
      return null;
    }
    if (
      kind === "schema" ||
      kind === "language" ||
      kind === "extension" ||
      kind === "foreign_data_wrapper" ||
      kind === "foreign_server" ||
      kind === "publication" ||
      kind === "subscription" ||
      kind === "role"
    ) {
      return createObjectRefFromAst(kind, first);
    }
    return createObjectRefFromAst(kind, first, fallbackSchema);
  }

  return createObjectRefFromAst(
    kind,
    parts.at(-1) ?? "",
    parts.at(-2) ?? fallbackSchema,
  );
};

export const typeFromTypeNameNode = (
  typeNameNode: unknown,
): ObjectRef | null => {
  const typeNameRecord = asRecord(typeNameNode);
  if (!typeNameRecord) {
    return null;
  }
  const nameParts = extractNameParts(typeNameRecord.names);
  return objectFromNameParts("type", nameParts, undefined);
};

export const relationFromRangeVarNode = (
  rangeVarNode: unknown,
  kind: ObjectRef["kind"] = "table",
): ObjectRef | null => {
  const rangeVar = asRecord(rangeVarNode);
  if (!rangeVar) {
    return null;
  }

  const relname =
    typeof rangeVar.relname === "string" ? rangeVar.relname : undefined;
  if (!relname) {
    return null;
  }

  const schema =
    typeof rangeVar.schemaname === "string"
      ? rangeVar.schemaname
      : DEFAULT_SCHEMA;
  return createObjectRefFromAst(kind, relname, schema);
};

const stringValuesFromNodeArray = (nodes: unknown): string[] => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  const values: string[] = [];
  for (const node of nodes) {
    const value = extractStringValue(node);
    if (value) {
      values.push(value);
    }
  }
  return values;
};

export const keyRefForTableColumns = (
  tableRef: ObjectRef | null,
  columnNames: string[],
): ObjectRef | null => {
  if (!tableRef || columnNames.length === 0) {
    return null;
  }

  return createObjectRefFromAst(
    "constraint",
    tableRef.name,
    tableRef.schema,
    `(${columnNames.join(",")})`,
  );
};

export const constraintKeyColumns = (
  constraint: Record<string, unknown>,
  fallbackColumnName?: string,
): string[] => {
  const keys = stringValuesFromNodeArray(constraint.keys);
  if (keys.length > 0) {
    return keys;
  }

  const pkAttrs = stringValuesFromNodeArray(constraint.pk_attrs);
  if (pkAttrs.length > 0) {
    return pkAttrs;
  }

  if (fallbackColumnName) {
    return [fallbackColumnName];
  }

  return [];
};

export const addForeignConstraintDependencies = (
  constraint: Record<string, unknown>,
  requires: ObjectRef[],
): void => {
  const foreignTable = relationFromRangeVarNode(constraint.pktable, "table");
  if (foreignTable) {
    requires.push(foreignTable);
    const referencedKey = keyRefForTableColumns(
      foreignTable,
      constraintKeyColumns(constraint),
    );
    if (referencedKey) {
      requires.push(referencedKey);
    }
  }
};

export const addSchemaDependencyIfNeeded = (
  schemaName: unknown,
  requires: ObjectRef[],
): void => {
  if (typeof schemaName !== "string") {
    return;
  }
  requires.push(createObjectRefFromAst("schema", schemaName));
};

export const roleNameFromRoleSpec = (roleSpecNode: unknown): string | null => {
  const roleSpec = asRecord(roleSpecNode);
  if (!roleSpec) {
    return null;
  }

  if (typeof roleSpec.rolename === "string") {
    return roleSpec.rolename;
  }

  if (roleSpec.roletype === "ROLESPEC_PUBLIC") {
    return "public";
  }

  return null;
};

export const parseNamedObjectRef = (
  objectNode: unknown,
  kind: ObjectRef["kind"],
): ObjectRef | null => {
  const nodeRecord = asRecord(objectNode);
  if (!nodeRecord) {
    return null;
  }

  const directStringValue = extractStringValue(nodeRecord);
  if (directStringValue) {
    if (
      kind === "schema" ||
      kind === "language" ||
      kind === "extension" ||
      kind === "foreign_data_wrapper" ||
      kind === "foreign_server" ||
      kind === "publication" ||
      kind === "subscription" ||
      kind === "role"
    ) {
      return createObjectRefFromAst(kind, directStringValue);
    }
    return createObjectRefFromAst(kind, directStringValue, DEFAULT_SCHEMA);
  }

  const listNode = asRecord(nodeRecord.List);
  if (listNode) {
    return objectFromNameParts(kind, extractNameParts(listNode.items));
  }

  const rangeVarRef = relationFromRangeVarNode(
    asRecord(nodeRecord.RangeVar),
    kind,
  );
  if (rangeVarRef) {
    return rangeVarRef;
  }

  const objectWithArgs = asRecord(nodeRecord.ObjectWithArgs);
  if (objectWithArgs) {
    const nameParts = extractNameParts(objectWithArgs.objname);
    const baseRef = objectFromNameParts(kind, nameParts);
    if (!baseRef) {
      return null;
    }

    const args = Array.isArray(objectWithArgs.objargs)
      ? objectWithArgs.objargs
      : [];
    if (args.length === 0) {
      return baseRef;
    }

    const signatureParts = args.map((argNode) => {
      const typeRef = typeFromTypeNameNode(argNode);
      if (!typeRef) {
        return "unknown";
      }
      return typeRef.schema
        ? `${typeRef.schema}.${typeRef.name}`
        : typeRef.name;
    });

    return createObjectRefFromAst(
      kind,
      baseRef.name,
      baseRef.schema,
      `(${signatureParts.join(",")})`,
    );
  }

  return null;
};
