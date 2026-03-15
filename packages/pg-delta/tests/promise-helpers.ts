/**
 * Promise convenience wrappers for integration tests.
 *
 * Integration tests intentionally exercise the published Node boundary so pool
 * inputs remain supported even though `/effect` no longer exposes `pg.Pool`
 * types.
 */

export {
  type ApplyPlanResult,
  applyDeclarativeSchema,
  applyPlan,
  createPlan,
} from "../src/node.ts";
