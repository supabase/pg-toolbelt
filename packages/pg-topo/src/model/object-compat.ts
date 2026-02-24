import { splitTopLevel } from "../utils/split-top-level.ts";
import type { ObjectRef } from "./types.ts";

export const isKindCompatible = (
  requiredKind: ObjectRef["kind"],
  providedKind: ObjectRef["kind"],
): boolean => {
  if (requiredKind === "table") {
    return (
      providedKind === "table" ||
      providedKind === "view" ||
      providedKind === "materialized_view"
    );
  }
  if (requiredKind === "function") {
    return (
      providedKind === "function" ||
      providedKind === "procedure" ||
      providedKind === "aggregate"
    );
  }
  if (requiredKind === "procedure") {
    return providedKind === "procedure" || providedKind === "function";
  }
  if (requiredKind === "type") {
    return (
      providedKind === "type" ||
      providedKind === "domain" ||
      providedKind === "table" ||
      providedKind === "view" ||
      providedKind === "materialized_view"
    );
  }
  return requiredKind === providedKind;
};

const signatureArgs = (signature?: string): string[] | null => {
  if (typeof signature !== "string") {
    return null;
  }

  const trimmed = signature.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }

  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) {
    return [];
  }

  return splitTopLevel(body, ",").map((arg) => arg.trim());
};

const normalizeSignatureArg = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed.toLowerCase();
};

// PostgreSQL uses canonical names internally (e.g. pg_catalog.int8) but users
// write SQL-standard aliases (e.g. bigint). This map normalizes common aliases
// so that annotation signatures like (bigint,uuid) match AST-extracted
// signatures like (pg_catalog.int8,public.uuid).
const PG_TYPE_ALIASES: Record<string, string> = {
  bigint: "int8",
  int8: "int8",
  smallint: "int2",
  int2: "int2",
  integer: "int4",
  int: "int4",
  int4: "int4",
  real: "float4",
  float4: "float4",
  "double precision": "float8",
  float8: "float8",
  boolean: "bool",
  bool: "bool",
  character: "bpchar",
  bpchar: "bpchar",
  "character varying": "varchar",
  varchar: "varchar",
  timestamp: "timestamp",
  "timestamp without time zone": "timestamp",
  timestamptz: "timestamptz",
  "timestamp with time zone": "timestamptz",
  serial: "int4",
  bigserial: "int8",
  smallserial: "int2",
};

const signatureArgBase = (value: string): string => {
  const parts = splitTopLevel(value, ".");
  const base = parts.at(-1) ?? value;
  const normalized = normalizeSignatureArg(base);
  return PG_TYPE_ALIASES[normalized] ?? normalized;
};

const signatureArgHasSchema = (value: string): boolean =>
  splitTopLevel(value, ".").length > 1;

const POLYMORPHIC_PROVIDER_TYPES = new Set<string>([
  "any",
  "anyarray",
  "anycompatible",
  "anycompatiblearray",
  "anycompatiblenonarray",
  "anycompatiblemultirange",
  "anycompatiblerange",
  "anyelement",
  "anyenum",
  "anymultirange",
  "anynonarray",
  "anyrange",
]);

const isPolymorphicProviderArg = (value: string): boolean =>
  POLYMORPHIC_PROVIDER_TYPES.has(signatureArgBase(normalizeSignatureArg(value)));

const signatureArgCompatible = (
  requiredArg: string,
  providedArg: string,
): boolean => {
  const normalizedRequired = normalizeSignatureArg(requiredArg);
  const normalizedProvided = normalizeSignatureArg(providedArg);
  if (normalizedRequired === "unknown" || normalizedRequired.length === 0) {
    return true;
  }
  if (normalizedProvided === "unknown" || normalizedProvided.length === 0) {
    return true;
  }
  if (isPolymorphicProviderArg(normalizedProvided)) {
    return true;
  }

  if (normalizedRequired === normalizedProvided) {
    return true;
  }

  const requiredHasSchema = signatureArgHasSchema(normalizedRequired);
  const providedHasSchema = signatureArgHasSchema(normalizedProvided);
  if (requiredHasSchema && providedHasSchema) {
    return false;
  }

  return (
    signatureArgBase(normalizedRequired) ===
    signatureArgBase(normalizedProvided)
  );
};

type SignatureCompatibilityOptions = {
  allowNamedArgumentsInRequirement?: boolean;
  allowVariadicProviderTail?: boolean;
};

const isVariadicProviderArg = (value: string): boolean =>
  isPolymorphicProviderArg(value);

export const signaturesCompatible = (
  requiredSignature?: string,
  providedSignature?: string,
  options: SignatureCompatibilityOptions = {},
): boolean => {
  if (!requiredSignature) {
    return true;
  }

  if (
    options.allowNamedArgumentsInRequirement &&
    requiredSignature.includes("=>")
  ) {
    return true;
  }

  if (!providedSignature) {
    return false;
  }
  if (requiredSignature === providedSignature) {
    return true;
  }

  const requiredArgs = signatureArgs(requiredSignature);
  const providedArgs = signatureArgs(providedSignature);
  if (!requiredArgs || !providedArgs) {
    return false;
  }
  if (
    options.allowVariadicProviderTail &&
    providedArgs.length > 0 &&
    isVariadicProviderArg(providedArgs[providedArgs.length - 1] ?? "")
  ) {
    const fixedCount = providedArgs.length - 1;
    if (requiredArgs.length < fixedCount) {
      return false;
    }
    for (let index = 0; index < fixedCount; index += 1) {
      const requiredArg = requiredArgs[index];
      const providedArg = providedArgs[index];
      if (typeof requiredArg !== "string" || typeof providedArg !== "string") {
        return false;
      }
      if (!signatureArgCompatible(requiredArg, providedArg)) {
        return false;
      }
    }
    const variadicArg = providedArgs[providedArgs.length - 1];
    if (typeof variadicArg !== "string") {
      return false;
    }
    for (let index = fixedCount; index < requiredArgs.length; index += 1) {
      const requiredArg = requiredArgs[index];
      if (typeof requiredArg !== "string") {
        return false;
      }
      if (!signatureArgCompatible(requiredArg, variadicArg)) {
        return false;
      }
    }
    return true;
  }
  // Allow fewer required args than provided: PostgreSQL functions with default
  // parameters can be called with fewer arguments than declared. For example,
  // auth.can(bigint,text,auth.action,json DEFAULT null,uuid DEFAULT ...) can be
  // called with just 3 args. We compare only the overlapping prefix so that the
  // call-site signature (N args) can match any provider with M >= N params.
  if (requiredArgs.length > providedArgs.length) {
    return false;
  }

  for (let index = 0; index < requiredArgs.length; index += 1) {
    const requiredArg = requiredArgs[index];
    const providedArg = providedArgs[index];
    if (typeof requiredArg !== "string" || typeof providedArg !== "string") {
      return false;
    }
    if (!signatureArgCompatible(requiredArg, providedArg)) {
      return false;
    }
  }

  return true;
};
