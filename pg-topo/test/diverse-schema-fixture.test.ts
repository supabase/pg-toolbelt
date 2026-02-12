import { beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import type { StatementClass } from "../src/classify/classify-statement";
import { analyzeAndSort } from "../src/analyze-and-sort";
import type { AnalyzeResult } from "../src/model/types";
import { analyzeResultFingerprint } from "./support/fingerprint";
import { expectRandomizedRuntimeOutcomeEnvelope } from "./support/fixture-regression";
import { validateAnalyzeResultWithPostgres } from "./support/postgres-validation";
import { analyzeAndSortFromRandomizedStatements } from "./support/randomized-runtime-analysis";
import type { RuntimeDiagnostic } from "./support/postgres/postgres-types";

const fixtureRoot = path.resolve("test/fixtures/diverse-schema");
const baselineFingerprint = "d9ca4265e2717589b9e5664cf5f699ae957f49424153f674bcee1e5ef820fa80";

let baselineResult: AnalyzeResult;
let looseValidationDiagnosticsPromise: Promise<RuntimeDiagnostic[]> | null = null;

const getLooseValidationDiagnostics = async (): Promise<RuntimeDiagnostic[]> => {
  if (!looseValidationDiagnosticsPromise) {
    looseValidationDiagnosticsPromise = (async () => {
      const looseStatic = await analyzeAndSortFromRandomizedStatements({
        roots: [fixtureRoot],
        seed: 19,
      });
      const validation = await validateAnalyzeResultWithPostgres(looseStatic);
      return validation.diagnostics;
    })();
  }
  return looseValidationDiagnosticsPromise;
};

describe("diverse schema fixture", () => {
  beforeAll(async () => {
    baselineResult = await analyzeAndSort({ roots: [fixtureRoot] });
  });

  test("handles the diverse corpus without unknown statement classes", () => {
    const unknownCount = baselineResult.diagnostics.filter(
      (diagnostic) => diagnostic.code === "UNKNOWN_STATEMENT_CLASS",
    ).length;

    expect(baselineResult.ordered.length).toBeGreaterThan(20);
    expect(unknownCount).toBe(0);
  });

  test("covers the real-world statement-class baseline", () => {
    const classes = new Set(baselineResult.ordered.map((statement) => statement.statementClass));
    const requiredClasses: StatementClass[] = [
      "ALTER_DEFAULT_PRIVILEGES",
      "ALTER_OWNER",
      "ALTER_SEQUENCE",
      "ALTER_TABLE",
      "COMMENT",
      "CREATE_EXTENSION",
      "CREATE_FUNCTION",
      "CREATE_INDEX",
      "CREATE_POLICY",
      "CREATE_PUBLICATION",
      "CREATE_SCHEMA",
      "CREATE_SEQUENCE",
      "CREATE_TABLE",
      "CREATE_TRIGGER",
      "CREATE_TYPE",
      "CREATE_VIEW",
      "DO",
      "GRANT",
      "SELECT",
      "UPDATE",
      "VARIABLE_SET",
    ];

    for (const statementClass of requiredClasses) {
      expect(classes.has(statementClass)).toBe(true);
    }
  });

  test("output has deterministic fingerprint", () => {
    const first = analyzeResultFingerprint(baselineResult);
    const second = analyzeResultFingerprint(baselineResult);

    expect(first).toBe(second);
    expect(first).toBe(baselineFingerprint);
  });

  test("runtime validation completes without execution validation errors", async () => {
    const looseValidationDiagnostics = await getLooseValidationDiagnostics();
    const executionErrors = looseValidationDiagnostics.filter(
      (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
    );

    expect(executionErrors).toHaveLength(0);
  }, 120000);

  test("parsed-then-randomized statement input preserves runtime outcome envelope", async () => {
    await expectRandomizedRuntimeOutcomeEnvelope({
      fixtureRoot,
      seeds: [11, 29, 57],
      minStatementCount: 50,
    });
  }, 120000);
});
