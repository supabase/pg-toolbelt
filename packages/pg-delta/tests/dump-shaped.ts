/**
 * Dump / sqlFiles extract omit `public → pg_database_owner`. Live extract
 * keeps that edge for DB→DB reown. `load(export(fb))` compares against this
 * dump-shaped hash, not the raw live digest.
 */
import {
  buildFactBase,
  edgesForExtract,
  retainBuiltinOwnerDangling,
  type FactBase,
} from "../src/core/fact.ts";

export function dumpShapedRootHash(fb: FactBase): string {
  return buildFactBase(
    [...fb.facts()],
    edgesForExtract(fb.edges, "sqlFiles"),
    fb.source,
    fb.referenceOnly,
    { allowDangling: retainBuiltinOwnerDangling },
  ).rootHash;
}
