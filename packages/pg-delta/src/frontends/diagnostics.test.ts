import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../core/diagnostic.ts";
import { hasBlockingDiagnostics, isBlockingDiagnostic } from "./diagnostics.ts";

const unmodeled: Diagnostic = {
  code: "unmodeled_kind",
  severity: "warning",
  message: "1 unmodeled cast",
};
const orphan: Diagnostic = {
  code: "orphaned_satellite",
  severity: "info",
  message: "dropped",
};
const unresolvedLabel: Diagnostic = {
  code: "unresolved_security_label",
  severity: "warning",
  message: "1 security label on an unsupported object",
};
const drift: Diagnostic = {
  code: "unmodeled_drift",
  severity: "warning",
  message: "1 unmodeled cast in the shadow but not on the target",
};
const vaultPresence: Diagnostic = {
  code: "vault_presence",
  severity: "warning",
  message: "vault secrets are not migrated",
};
const err: Diagnostic = { code: "boom", severity: "error", message: "fatal" };

describe("hasBlockingDiagnostics", () => {
  test("an error-severity diagnostic always blocks", () => {
    expect(hasBlockingDiagnostics([err])).toBe(true);
    expect(hasBlockingDiagnostics([err], { strictCoverage: false })).toBe(true);
  });

  test("unmodeled_kind blocks ONLY in strict-coverage mode", () => {
    expect(hasBlockingDiagnostics([unmodeled])).toBe(false);
    expect(hasBlockingDiagnostics([unmodeled], { strictCoverage: true })).toBe(
      true,
    );
  });

  test("unresolved_security_label blocks ONLY in strict-coverage mode", () => {
    // a valid SECURITY LABEL on an unsupported object (language/database/large
    // object/tablespace) would otherwise be silently absent from the artifact
    expect(hasBlockingDiagnostics([unresolvedLabel])).toBe(false);
    expect(
      hasBlockingDiagnostics([unresolvedLabel], { strictCoverage: true }),
    ).toBe(true);
  });

  test("unmodeled_drift blocks ONLY in strict-coverage mode", () => {
    // the shadow has an unmodeled object the target lacks: no planned statement
    // can create it, so a plan depending on it fails on the target
    expect(hasBlockingDiagnostics([drift])).toBe(false);
    expect(hasBlockingDiagnostics([drift], { strictCoverage: true })).toBe(
      true,
    );
  });

  test("vault_presence blocks ONLY in strict-coverage mode", () => {
    expect(hasBlockingDiagnostics([vaultPresence])).toBe(false);
    expect(
      hasBlockingDiagnostics([vaultPresence], { strictCoverage: true }),
    ).toBe(true);
  });

  test("info/warning diagnostics do not block in the default mode", () => {
    expect(hasBlockingDiagnostics([orphan, unmodeled, drift])).toBe(false);
    expect(hasBlockingDiagnostics([])).toBe(false);
  });
});

describe("isBlockingDiagnostic", () => {
  test("an error-severity diagnostic always blocks", () => {
    expect(isBlockingDiagnostic(err)).toBe(true);
    expect(isBlockingDiagnostic(err, { strictCoverage: false })).toBe(true);
    expect(isBlockingDiagnostic(err, { strictCoverage: true })).toBe(true);
  });

  test("a STRICT_COVERAGE_CODES diagnostic blocks ONLY in strict-coverage mode", () => {
    for (const d of [unmodeled, unresolvedLabel, drift, vaultPresence]) {
      expect(isBlockingDiagnostic(d)).toBe(false);
      expect(isBlockingDiagnostic(d, { strictCoverage: false })).toBe(false);
      expect(isBlockingDiagnostic(d, { strictCoverage: true })).toBe(true);
    }
  });

  test("strict coverage blocks on the code regardless of severity", () => {
    const infoCoverage: Diagnostic = { ...unmodeled, severity: "info" };
    expect(isBlockingDiagnostic(infoCoverage)).toBe(false);
    expect(isBlockingDiagnostic(infoCoverage, { strictCoverage: true })).toBe(
      true,
    );
  });

  test("a non-coverage info/warning diagnostic never blocks", () => {
    expect(isBlockingDiagnostic(orphan)).toBe(false);
    expect(isBlockingDiagnostic(orphan, { strictCoverage: true })).toBe(false);
    const otherWarning: Diagnostic = { ...orphan, severity: "warning" };
    expect(isBlockingDiagnostic(otherWarning, { strictCoverage: true })).toBe(
      false,
    );
  });

  test("accepts any object carrying code and severity", () => {
    const foreign = {
      code: "unmodeled_kind",
      severity: "warning",
      subject: "public.t",
    } as const;
    expect(isBlockingDiagnostic(foreign)).toBe(false);
    expect(isBlockingDiagnostic(foreign, { strictCoverage: true })).toBe(true);
  });
});
