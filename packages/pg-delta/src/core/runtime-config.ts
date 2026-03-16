/**
 * Re-export from platform. The canonical implementation lives in
 * `platform/sql/runtime-config.ts` — this barrel preserves existing imports.
 */
export {
  loadPgRuntimeConfig,
  PgRuntimeConfigService,
} from "../platform/sql/runtime-config.ts";
