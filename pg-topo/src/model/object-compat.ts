import type { ObjectRef } from "./types.ts";
import { splitTopLevel } from "../utils/split-top-level.ts";

export const isKindCompatible = (
  requiredKind: ObjectRef["kind"],
  providedKind: ObjectRef["kind"],
): boolean => {
  if (requiredKind === "table") {
    return (
      providedKind === "table" || providedKind === "view" || providedKind === "materialized_view"
    );
  }
  if (requiredKind === "function") {
    return providedKind === "function" || providedKind === "procedure";
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

const signatureArgBase = (value: string): string => {
  const parts = splitTopLevel(value, ".");
  const base = parts.at(-1) ?? value;
  return normalizeSignatureArg(base);
};

const signatureArgHasSchema = (value: string): boolean => splitTopLevel(value, ".").length > 1;

const signatureArgCompatible = (requiredArg: string, providedArg: string): boolean => {
  const normalizedRequired = normalizeSignatureArg(requiredArg);
  const normalizedProvided = normalizeSignatureArg(providedArg);

  if (normalizedRequired === "unknown" || normalizedRequired.length === 0) {
    return true;
  }
  if (normalizedProvided === "unknown" || normalizedProvided.length === 0) {
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

  return signatureArgBase(normalizedRequired) === signatureArgBase(normalizedProvided);
};

type SignatureCompatibilityOptions = {
  allowNamedArgumentsInRequirement?: boolean;
};

export const signaturesCompatible = (
  requiredSignature?: string,
  providedSignature?: string,
  options: SignatureCompatibilityOptions = {},
): boolean => {
  if (!requiredSignature) {
    return true;
  }

  if (options.allowNamedArgumentsInRequirement && requiredSignature.includes("=>")) {
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
  if (requiredArgs.length !== providedArgs.length) {
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
