import postgres from "postgres";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { postgresConfig } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { Plan } from "./types.ts";

type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; failedStatement?: string };

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

/**
 * Apply a plan's SQL to a target database with integrity checks.
 */
export async function applyPlan(
  plan: Plan,
  sourceUrl: string,
  targetUrl: string,
  options: ApplyPlanOptions = {},
): Promise<ApplyPlanResult> {
  if (!plan.statements || plan.statements.length === 0) {
    return {
      status: "invalid_plan",
      message: "Plan contains no SQL statements to execute.",
    };
  }

  const currentSql = postgres(sourceUrl, postgresConfig);
  const desiredSql = postgres(targetUrl, postgresConfig);

  try {
    // Recompute stableIds and fingerprints from current and desired catalogs
    const [currentCatalog, desiredCatalog] = await Promise.all([
      extractCatalog(currentSql),
      extractCatalog(desiredSql),
    ]);

    const changes = diffCatalogs(currentCatalog, desiredCatalog);
    const ctx: DiffContext = {
      mainCatalog: currentCatalog,
      branchCatalog: desiredCatalog,
    };
    const sortedChanges = sortChanges(ctx, changes);
    const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
      ctx.mainCatalog,
      sortedChanges,
    );
    // We intentionally recompute target fingerprint only after applying.

    // Pre-apply fingerprint validation
    if (fingerprintFrom === plan.target.fingerprint) {
      return { status: "already_applied" };
    }

    if (fingerprintFrom !== plan.source.fingerprint) {
      return {
        status: "fingerprint_mismatch",
        current: fingerprintFrom,
        expected: plan.source.fingerprint,
      };
    }

    // Execute the SQL script
    // TODO: mark statements that can't be run within a transaction
    const statements = plan.statements;

    let failedStatement: string | undefined;

    try {
      await currentSql.begin(async (tx) => {
        for (const statement of statements) {
          try {
            await tx.unsafe(statement);
          } catch (error) {
            failedStatement = statement;
            throw error;
          }
        }
      });
    } catch (error) {
      return { status: "failed", error, failedStatement };
    }

    const warnings: string[] = [];

    if (options.verifyPostApply !== false) {
      try {
        const updatedCatalog = await extractCatalog(currentSql);
        const updatedFingerprint = hashStableIds(updatedCatalog, stableIds);
        if (updatedFingerprint !== plan.target.fingerprint) {
          warnings.push(
            "Post-apply fingerprint does not match the plan target fingerprint.",
          );
        }
      } catch (error) {
        warnings.push(
          `Could not verify post-apply fingerprint: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      status: "applied",
      statements: statements.length,
      warnings: warnings.length ? warnings : undefined,
    };
  } finally {
    await Promise.all([currentSql.end(), desiredSql.end()]);
  }
}
