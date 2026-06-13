/**
 * Typed wrapper for the old engine (packages/pg-delta).
 *
 * TypeScript cannot resolve the old engine via a relative path because
 * packages/pg-delta is outside the tsconfig `include` tree of
 * packages/pg-delta-next.  We use a string-only specifier in Function() to
 * load the module at runtime without TypeScript following the import graph into
 * the old package.
 *
 * Bun resolves the path at runtime — verified manually.  The explicit cast
 * below is the single point of trust and is documented.
 */
import type { Pool } from "pg";

export interface OldPlan {
  version: number;
  source: { fingerprint: string };
  target: { fingerprint: string };
  statements: string[];
  role?: string;
  filter?: unknown;
  serialize?: unknown;
  risk?: unknown;
}

export interface OldPlanResult {
  plan: OldPlan;
  sortedChanges: unknown[];
  ctx: unknown;
}

export interface OldApplyResult {
  status:
    | "applied"
    | "already_applied"
    | "invalid_plan"
    | "fingerprint_mismatch"
    | "failed";
  statements?: number;
  warnings?: string[];
  current?: string;
  expected?: string;
  error?: unknown;
  script?: string;
}

interface OldEngineModule {
  createPlan: (
    source: Pool | null,
    target: Pool,
    options?: Record<string, unknown>,
  ) => Promise<OldPlanResult | null>;
  applyPlan: (
    plan: OldPlan,
    source: Pool,
    target: Pool,
    options?: { verifyPostApply?: boolean },
  ) => Promise<OldApplyResult>;
}

// Bun resolves this path at runtime.  Using a concatenation so that TypeScript
// never treats it as a static import specifier and therefore never attempts to
// resolve or type-check the old package's source tree.
const OLD_ENGINE_PATH = new URL("../../pg-delta/src/index.ts", import.meta.url)
  .href;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const oldEngine = (await import(OLD_ENGINE_PATH)) as OldEngineModule;

export const createPlan = oldEngine.createPlan;
export const applyPlan = oldEngine.applyPlan;
