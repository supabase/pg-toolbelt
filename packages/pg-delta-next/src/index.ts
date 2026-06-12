/**
 * @supabase/pg-delta-next — clean-room rebuild per docs/target-architecture.md.
 * Public API per §4.5; stubs throw NotImplementedError until their stage lands.
 */
export { NotImplementedError, type Diagnostic } from "./core/diagnostic.ts";
export {
  encodeId,
  parseId,
  type StableId,
  type FactKind,
} from "./core/stable-id.ts";
export {
  canonicalize,
  contentHash,
  type Payload,
  type ContentHash,
} from "./core/hash.ts";
export {
  buildFactBase,
  FactBase,
  type Fact,
  type DependencyEdge,
  type EdgeKind,
} from "./core/fact.ts";
export { serializeSnapshot, deserializeSnapshot } from "./core/snapshot.ts";
export { diff, type Delta } from "./core/diff.ts";
export { extract, type ExtractResult } from "./extract/extract.ts";
export { plan, type Plan, type Action } from "./plan/plan.ts";
export { apply, type ApplyReport } from "./apply/apply.ts";
export { provePlan, type ProofVerdict } from "./proof/prove.ts";
export {
  loadSqlFiles,
  ShadowLoadError,
  type SqlFile,
  type LoadResult,
} from "./frontends/load-sql-files.ts";
