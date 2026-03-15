/**
 * Plan application - execute migration plans against target databases.
 */

import { Effect } from "effect";
import type { Pool } from "pg";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { DiffContext } from "../context.ts";
import {
  AlreadyAppliedError,
  type CatalogExtractionError,
  type ConnectionError,
  type ConnectionTimeoutError,
  FingerprintMismatchError,
  InvalidPlanError,
  PlanApplyError,
  type SslConfigError,
} from "../errors.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { compileFilterDSL } from "../integrations/filter/dsl.ts";
import type { DatabaseApi } from "../services/database.ts";
import { makeScopedPool, wrapPool } from "../services/database-live.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { Plan } from "./types.ts";

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

type ConnectionInput = string | Pool | DatabaseApi;

/**
 * Check if a statement is a session configuration statement (standalone SET statements).
 * These statements should not be counted as changes.
 */
function isSessionStatement(statement: string): boolean {
  return statement.trim().startsWith("SET ");
}

type ApplyPlanSuccess = {
  statements: number;
  warnings?: string[];
};

export const applyPlan = (
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Effect.Effect<
  ApplyPlanSuccess,
  | InvalidPlanError
  | FingerprintMismatchError
  | AlreadyAppliedError
  | PlanApplyError
  | CatalogExtractionError
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
> =>
  withResolvedDatabase(source, "source", plan.role, (currentDb) =>
    withResolvedDatabase(target, "target", plan.role, (desiredDb) =>
      Effect.gen(function* () {
        if (!plan.statements || plan.statements.length === 0) {
          return yield* new InvalidPlanError({
            message: "Plan contains no SQL statements to execute.",
          });
        }

        const [currentCatalog, desiredCatalog] = yield* Effect.all([
          extractCatalog(currentDb),
          extractCatalog(desiredDb),
        ]);

        const changes = diffCatalogs(currentCatalog, desiredCatalog);
        const ctx: DiffContext = {
          mainCatalog: currentCatalog,
          branchCatalog: desiredCatalog,
        };

        let filteredChanges = changes;
        if (plan.filter) {
          const filterFn = compileFilterDSL(plan.filter);
          filteredChanges = filteredChanges.filter((change) => filterFn(change));
        }

        const sortedChanges = sortChanges(ctx, filteredChanges);
        if (sortedChanges.length === 0) {
          return yield* new AlreadyAppliedError();
        }

        const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
          ctx.mainCatalog,
          sortedChanges,
        );

        if (fingerprintFrom === plan.target.fingerprint) {
          return yield* new AlreadyAppliedError();
        }

        if (fingerprintFrom !== plan.source.fingerprint) {
          return yield* new FingerprintMismatchError({
            current: fingerprintFrom,
            expected: plan.source.fingerprint,
          });
        }

        const statements = plan.statements;
        const script = joinStatements(statements);

        yield* currentDb.query(script).pipe(
          Effect.mapError(
            (error) =>
              new PlanApplyError({
                cause: error,
                script,
              }),
          ),
        );

        const warnings: string[] = [];
        if (options.verifyPostApply !== false) {
          const verification = yield* extractCatalog(currentDb).pipe(
            Effect.result,
          );
          if (verification._tag === "Failure") {
            warnings.push(
              `Could not verify post-apply fingerprint: ${verification.failure.message}`,
            );
          } else {
            const updatedFingerprint = hashStableIds(
              verification.success,
              stableIds,
            );
            if (updatedFingerprint !== plan.target.fingerprint) {
              warnings.push(
                "Post-apply fingerprint does not match the plan target fingerprint.",
              );
            }
          }
        }

        return {
          statements: statements.filter(
            (statement) => !isSessionStatement(statement),
          ).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }),
    ),
  );

const withResolvedDatabase = <A, E>(
  input: ConnectionInput,
  label: "source" | "target",
  role: string | undefined,
  use: (database: DatabaseApi) => Effect.Effect<A, E>,
): Effect.Effect<
  A,
  E | CatalogExtractionError | ConnectionError | ConnectionTimeoutError | SslConfigError
> => {
  if (typeof input === "string") {
    return Effect.scoped(
      Effect.gen(function* () {
        const database = yield* makeScopedPool(input, {
          role,
          label,
        });
        return yield* use(database);
      }),
    );
  }

  if ("withConnection" in input) {
    return use(input);
  }

  return use(wrapPool(input));
};

const joinStatements = (statements: ReadonlyArray<string>): string => {
  const joined = statements.join(";\n");
  return joined.endsWith(";") ? joined : `${joined};`;
};
