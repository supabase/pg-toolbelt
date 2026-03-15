import { Effect } from "effect";
import { ValidationError } from "./errors.ts";
import { ParserService } from "./services/parser.ts";

const toValidationError = (
  sql: string,
  parsed: {
    statements: ReadonlyArray<unknown>;
    diagnostics: ReadonlyArray<{ code: string; message: string }>;
  },
): ValidationError | null => {
  const parseDiagnostic = parsed.diagnostics.find(
    (diagnostic) => diagnostic.code === "PARSE_ERROR",
  );
  if (parseDiagnostic) {
    return new ValidationError({ message: parseDiagnostic.message });
  }

  if (sql.trim().length > 0 && parsed.statements.length === 0) {
    return new ValidationError({
      message: "SQL did not produce any executable statements.",
    });
  }

  return null;
};

export const validateSqlSyntax = Effect.fnUntraced(function* (sql: string) {
  const parser = yield* ParserService;
  const parsed = yield* parser
    .parseSqlContent(sql, "<validation>")
    .pipe(
      Effect.mapError(
        (error) => new ValidationError({ message: error.message, cause: error }),
      ),
    );
  const validationError = toValidationError(sql, parsed);
  if (validationError) {
    return yield* Effect.fail(validationError);
  }
});
