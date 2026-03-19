/**
 * Integration DSL - A serializable domain-specific language for integrations.
 *
 * Combines filter and serialization DSLs into a single serializable structure.
 */

import type { CatalogSnapshot } from "../catalog.snapshot.ts";
import type { FilterDSL } from "./filter/dsl.ts";
import type { SerializeDSL } from "./serialize/dsl.ts";

/**
 * Integration DSL - serializable representation of an integration.
 */
export type IntegrationDSL = {
  /**
   * Base integration(s) to extend. Filters are AND-combined, serialize rules
   * are concatenated (extending rules first, higher priority), and the most
   * specific emptyCatalog wins.
   *
   * Only core integration names are accepted (e.g., "supabase").
   * Can be a single name or an array of names.
   * Circular extends are detected and rejected.
   */
  extends?: string | string[];
  /**
   * Filter DSL - determines which changes to include/exclude.
   * If not provided, all changes are included.
   */
  filter?: FilterDSL;
  /**
   * Serialization DSL - customizes how changes are serialized.
   * If not provided, changes are serialized with default options.
   */
  serialize?: SerializeDSL;
  /**
   * Baseline catalog snapshot for this integration.
   *
   * When `--source` is omitted, this snapshot is deserialized and used as the
   * source catalog instead of `createEmptyCatalog`. This lets integrations
   * define what "empty" means for their platform (e.g. Supabase ships with
   * pre-existing schemas, extensions, and roles).
   */
  emptyCatalog?: CatalogSnapshot;
};
