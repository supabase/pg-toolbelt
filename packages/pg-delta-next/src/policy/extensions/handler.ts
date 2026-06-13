/**
 * Extension handlers (docs/extension-intent.md §4.1).
 *
 * A handler is a data package that teaches the integration layer about ONE
 * stateful extension (pg_partman, pgmq, pg_cron, …). It reads the extension's
 * OWN catalogs — `part_config`, `cron.job`, pgmq's `meta`, none of which are
 * `pg_catalog`, so handlers live ABOVE core (P1: capture, never parse) — and
 * emits facts + edges into the shared fact base.
 *
 * The mechanism is GENERIC, not Supabase-specific: pgmq/cron/partman are
 * general extensions. The Supabase integration merely *composes* a chosen set
 * of handlers (src/policy/extensions/index.ts) with its managed-schema policy.
 *
 * Phase A (this slice): handlers emit only `managedBy` edges on the objects
 * the extension created operationally, so `excludeManaged` (src/policy/managed.ts)
 * keeps them out of the schema diff (no data loss). Phase B adds intent facts
 * + replay rules.
 */
import type { Pool } from "pg";
import type { DependencyEdge, Fact, FactBase } from "../../core/fact.ts";

export interface CaptureResult {
  /** Intent facts (Phase B). Empty for filter-only handlers. */
  facts: Fact[];
  /** Provenance edges (`managedBy`) marking operationally-created objects. */
  edges: DependencyEdge[];
}

export interface ExtensionHandler {
  /** The `pg_extension` name this handler manages. */
  readonly extension: string;
  /**
   * Read the extension's own catalogs and emit facts + edges. Returns empty
   * when the extension is not installed. Must NOT mutate `current`; it is
   * provided so the handler can target only objects that exist as facts (and
   * avoid dangling edges).
   */
  capture(pool: Pool, current: FactBase): Promise<CaptureResult>;
}
