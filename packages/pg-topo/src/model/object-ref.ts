import { splitTopLevel } from "../utils/split-top-level.ts";
import type { ObjectKind, ObjectRef } from "./types.ts";

const BUILTIN_TYPES = new Set([
  "bool",
  "bytea",
  "date",
  "float4",
  "float8",
  "int2",
  "int4",
  "int8",
  "json",
  "jsonb",
  "numeric",
  "record",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "trigger",
  "uuid",
  "varchar",
  "void",
]);

export const DEFAULT_SCHEMA = "public";

type IdentifierSource = "raw" | "ast";

const normalizeIdentifierInternal = (
  value: string,
  source: IdentifierSource,
): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }

  if (source === "raw") {
    return trimmed.toLowerCase();
  }

  return trimmed;
};

export const normalizeIdentifier = (value: string): string =>
  normalizeIdentifierInternal(value, "raw");

const normalizeTypeExpression = (value: string): string => {
  let out = "";
  let inQuotes = false;
  let pendingSpace = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const nextChar = value[index + 1];
    if (!char) {
      continue;
    }

    if (char === '"') {
      if (pendingSpace && out.length > 0) {
        out += " ";
      }
      pendingSpace = false;
      out += char;
      if (inQuotes && nextChar === '"') {
        out += nextChar;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (inQuotes) {
      out += char;
      continue;
    }

    if (/\s/u.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (pendingSpace && out.length > 0 && !",()[]".includes(char)) {
      out += " ";
    }
    pendingSpace = false;
    out += char.toLowerCase();
  }

  return out
    .trim()
    .replace(/\s*,\s*/gu, ",")
    .replace(/\(\s*/gu, "(")
    .replace(/\s*\)/gu, ")");
};

export const normalizeSignature = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  let body = trimmed;
  if (body.startsWith("(") && body.endsWith(")")) {
    body = body.slice(1, -1);
  }

  if (body.trim().length === 0) {
    return "()";
  }

  const args = splitTopLevel(body, ",").map((arg) =>
    normalizeTypeExpression(arg),
  );
  return `(${args.join(",")})`;
};

export const createObjectRef = (
  kind: ObjectKind,
  name: string,
  schema?: string,
  signature?: string,
  source: IdentifierSource = "raw",
): ObjectRef => ({
  kind,
  name: normalizeIdentifierInternal(name, source),
  schema: schema ? normalizeIdentifierInternal(schema, source) : undefined,
  signature: signature ? normalizeSignature(signature) : undefined,
});

export const createObjectRefFromAst = (
  kind: ObjectKind,
  name: string,
  schema?: string,
  signature?: string,
): ObjectRef => createObjectRef(kind, name, schema, signature, "ast");

export const objectRefKey = (ref: ObjectRef): string => {
  const schema = ref.schema ?? "";
  const signature = ref.signature ?? "";
  return `${ref.kind}:${schema}:${ref.name}:${signature}`;
};

export const dedupeObjectRefs = (refs: ObjectRef[]): ObjectRef[] => {
  const map = new Map<string, ObjectRef>();
  for (const ref of refs) {
    map.set(objectRefKey(ref), ref);
  }
  return [...map.values()];
};

export const isBuiltInObjectRef = (ref: ObjectRef): boolean => {
  const schemaLower = ref.schema?.toLowerCase();
  const nameLower = ref.name.toLowerCase();

  if (schemaLower === "pg_catalog" || schemaLower === "information_schema") {
    return true;
  }

  if (ref.kind === "schema" && nameLower === DEFAULT_SCHEMA) {
    return true;
  }

  if (ref.kind === "role") {
    return true;
  }

  if (ref.kind === "type" && BUILTIN_TYPES.has(nameLower)) {
    return true;
  }

  return false;
};

export const splitQualifiedName = (
  value: string,
  source: IdentifierSource = "raw",
): { schema?: string; name: string } => {
  const parts = splitTopLevel(value, ".");
  if (parts.length <= 1) {
    return { name: normalizeIdentifierInternal(value, source) };
  }

  return {
    schema: normalizeIdentifierInternal(parts.slice(0, -1).join("."), source),
    name: normalizeIdentifierInternal(parts.at(-1) ?? "", source),
  };
};
