/**
 * Integration profile API (the `@supabase/pg-delta/integrations` subpath).
 *
 * The safe, supported surface for managing a profile-scoped view: resolve a
 * profile against a source pool, then route extract / plan / prove / apply
 * through the resolved option bundles. Prefer this over composing the low-level
 * helpers by hand.
 */
export type {
  IntegrationProfile,
  ResolveProfileOptions,
  ResolvedProfile,
} from "./profile.ts";
export { rawProfile, resolveProfile } from "./profile.ts";
export { SUPABASE_EXTENSION_HANDLERS, supabaseProfile } from "./supabase.ts";

// Building blocks, re-exported for advanced composition (custom profiles).
export type {
  CaptureResult,
  ExtensionHandler,
  HandlerContext,
} from "../extract/handler.ts";
export {
  makePgCronHandler,
  type PgCronHandlerConfig,
  pgCronHandler,
  pgmqHandler,
  pgPartmanHandler,
  vaultHandler,
} from "../policy/extensions/index.ts";
export {
  type ApplierCapability,
  probeApplierCapability,
} from "../policy/capability.ts";

// Spark source: plan / export / prove from Spark's schema description.
export type * from "./spark/description.ts";
export { sparkFactBase } from "./spark/fact-base.ts";
export {
  exportSparkSchema,
  fetchSparkSchema,
  planSparkFactBases,
  planSparkSchema,
  type SparkConnection,
  type SparkPlanResult,
  type SparkScratchRequest,
  type SparkScratchResult,
  sparkScratch,
  sparkStatusDiagnostics,
} from "./spark/frontend.ts";
