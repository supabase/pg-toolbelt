import { beforeEach, describe, expect, mock, test } from "bun:test";

let applyOptions: Record<string, unknown> | undefined;

const applyDeclarativeSchema = mock(
  async (options: Record<string, unknown>) => {
    applyOptions = options;
    return {
      diagnostics: [],
      totalStatements: 1,
      apply: {
        status: "success",
        totalApplied: 1,
        totalSkipped: 0,
        totalRounds: 1,
      },
    };
  },
);

mock.module("../../core/declarative-apply/discover-sql.ts", () => ({
  loadDeclarativeSchema: async () => [
    { filePath: "schema.sql", sql: "CREATE FUNCTION test_fn() RETURNS int;" },
  ],
}));

mock.module("../../core/declarative-apply/index.ts", () => ({
  applyDeclarativeSchema,
}));

const { declarativeApplyCommand } = await import("./declarative-apply.ts");

describe("declarativeApplyCommand", () => {
  beforeEach(() => {
    applyOptions = undefined;
    applyDeclarativeSchema.mockClear();
    process.exitCode = undefined;
  });

  test("exposes --skip-function-validation instead of the old flag", () => {
    expect(
      declarativeApplyCommand.parameters.flags["skip-function-validation"],
    ).toEqual({
      kind: "boolean",
      brief: "Skip final function body validation pass",
      optional: true,
    });
    expect(
      declarativeApplyCommand.parameters.flags["no-validate-functions"],
    ).toBeUndefined();
  });

  test("maps --skip-function-validation to validateFunctionBodies: false", async () => {
    const func = await declarativeApplyCommand.loader();
    const writes = { stdout: [] as string[], stderr: [] as string[] };

    await func.call(
      {
        process: {
          stdout: { write: (text: string) => writes.stdout.push(text) },
          stderr: { write: (text: string) => writes.stderr.push(text) },
        },
      },
      {
        path: "./schema",
        target: "postgresql://user:pass@localhost:5432/db",
        "skip-function-validation": true,
      },
    );

    expect(applyDeclarativeSchema).toHaveBeenCalledTimes(1);
    expect(applyOptions).toMatchObject({
      targetUrl: "postgresql://user:pass@localhost:5432/db",
      validateFunctionBodies: false,
    });
    expect(writes.stderr).toEqual([]);
    expect(process.exitCode).toBe(0);
  });
});
