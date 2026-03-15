import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import type { BasePgModel } from "./objects/base.model.ts";

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

/**
 * Build a deterministic fingerprint for the objects actually touched by a plan.
 * Uses the stableIds declared by the changes (creates/requires/drops) and snapshots
 * only the catalog entities that exist for those stableIds (parent objects, no virtuals).
 */
export function buildPlanScopeFingerprint(
  catalog: Catalog,
  changes: Change[],
): { hash: string; stableIds: string[] } {
  const stableIds = collectStableIds(changes);
  const hash = hashStableIds(catalog, stableIds);
  return { hash, stableIds };
}

/**
 * Compute a fingerprint from a catalog and a set of stableIds.
 */
export function hashStableIds(catalog: Catalog, stableIds: string[]): string {
  const catalogLookup = buildCatalogLookup(catalog);

  const projection: Array<{
    stableId: string;
    snapshot: { identity: unknown; data: unknown };
  }> = [];

  for (const stableId of stableIds) {
    const record = catalogLookup[stableId];
    if (!record) {
      continue;
    }
    projection.push({
      stableId,
      snapshot: record.stableSnapshot(),
    });
  }

  const canonical = stableStringify(projection);
  return sha256(canonical);
}

/**
 * Hash a string to hex SHA256.
 */
function sha256(input: string): string {
  const message = padSha256Message(new TextEncoder().encode(input));
  const state: number[] = [...SHA256_INITIAL_STATE];
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index++) {
      const base = offset + index * 4;
      schedule[index] =
        (message[base] << 24) |
        (message[base + 1] << 16) |
        (message[base + 2] << 8) |
        message[base + 3];
    }

    for (let index = 16; index < 64; index++) {
      const s0 = lowerSigma0(schedule[index - 15]);
      const s1 = lowerSigma1(schedule[index - 2]);
      schedule[index] =
        (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;

    for (let index = 0; index < 64; index++) {
      const temp1 =
        (h +
          upperSigma1(e) +
          choose(e, f, g) +
          SHA256_ROUND_CONSTANTS[index] +
          schedule[index]) >>>
        0;
      const temp2 = (upperSigma0(a) + majority(a, b, c)) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * Collect the union of stableIds referenced by all changes.
 */
function collectStableIds(changes: Change[]): string[] {
  const ids = new Set<string>();

  for (const change of changes) {
    for (const id of getChangeStableIds(change)) {
      ids.add(id);
    }
  }

  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

/**
 * Gather the stableIds a change touches (creates/requires/drops) and, when the
 * change has a primary entity with a stableId, include it as well.
 */
function getChangeStableIds(change: Change): string[] {
  const ids: string[] = [];

  // Dependencies declared on the change.
  ids.push(...change.creates, ...change.requires, ...change.drops);

  // Best-effort primary entity stableId, when available.
  const primary = getPrimaryStableId(change);
  if (primary) ids.push(primary);

  return ids;
}

/**
 * Extract the primary entity stableId for a change, when it exists.
 */
function getPrimaryStableId(change: Change): string | null {
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.stableId;
    case "collation":
      return change.collation.stableId;
    case "composite_type":
      return change.compositeType.stableId;
    case "domain":
      return change.domain.stableId;
    case "enum":
      return change.enum.stableId;
    case "event_trigger":
      return change.eventTrigger.stableId;
    case "extension":
      return change.extension.stableId;
    case "foreign_data_wrapper":
      return change.foreignDataWrapper.stableId;
    case "foreign_table":
      return change.foreignTable.stableId;
    case "index":
      return change.index.stableId;
    case "language":
      return change.language.stableId;
    case "materialized_view":
      return change.materializedView.stableId;
    case "procedure":
      return change.procedure.stableId;
    case "publication":
      return change.publication.stableId;
    case "range":
      return change.range.stableId;
    case "role":
      return change.role.stableId;
    case "schema":
      return change.schema.stableId;
    case "sequence":
      return change.sequence.stableId;
    case "server":
      return change.server.stableId;
    case "subscription":
      return change.subscription.stableId;
    case "table":
      return change.table.stableId;
    case "trigger":
      return change.trigger.stableId;
    case "rls_policy":
      return change.policy.stableId;
    case "rule":
      return change.rule.stableId;
    case "view":
      return change.view.stableId;
    case "user_mapping":
      return change.userMapping.stableId;
    default:
      return null;
  }
}

/**
 * Build a flat lookup of catalog objects keyed by stableId.
 */
function buildCatalogLookup(catalog: Catalog): Record<string, BasePgModel> {
  return {
    ...catalog.aggregates,
    ...catalog.collations,
    ...catalog.compositeTypes,
    ...catalog.domains,
    ...catalog.enums,
    ...catalog.extensions,
    ...catalog.procedures,
    ...catalog.indexes,
    ...catalog.materializedViews,
    ...catalog.subscriptions,
    ...catalog.publications,
    ...catalog.rlsPolicies,
    ...catalog.roles,
    ...catalog.schemas,
    ...catalog.sequences,
    ...catalog.tables,
    ...catalog.triggers,
    ...catalog.eventTriggers,
    ...catalog.rules,
    ...catalog.ranges,
    ...catalog.views,
    ...catalog.foreignDataWrappers,
    ...catalog.servers,
    ...catalog.userMappings,
    ...catalog.foreignTables,
  };
}

/**
 * Deterministic stringify with sorted object keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") {
      return JSON.stringify(value.toString());
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );

  const inner = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",");

  return `{${inner}}`;
}

function padSha256Message(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const totalLength = Math.ceil((input.length + 9) / 64) * 64;
  const output = new Uint8Array(totalLength);

  output.set(input);
  output[input.length] = 0x80;

  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  const tailOffset = totalLength - 8;

  output[tailOffset] = (highBits >>> 24) & 0xff;
  output[tailOffset + 1] = (highBits >>> 16) & 0xff;
  output[tailOffset + 2] = (highBits >>> 8) & 0xff;
  output[tailOffset + 3] = highBits & 0xff;
  output[tailOffset + 4] = (lowBits >>> 24) & 0xff;
  output[tailOffset + 5] = (lowBits >>> 16) & 0xff;
  output[tailOffset + 6] = (lowBits >>> 8) & 0xff;
  output[tailOffset + 7] = lowBits & 0xff;

  return output;
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function choose(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z);
}

function majority(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z);
}

function upperSigma0(value: number): number {
  return (
    rotateRight(value, 2) ^ rotateRight(value, 13) ^ rotateRight(value, 22)
  );
}

function upperSigma1(value: number): number {
  return (
    rotateRight(value, 6) ^ rotateRight(value, 11) ^ rotateRight(value, 25)
  );
}

function lowerSigma0(value: number): number {
  return rotateRight(value, 7) ^ rotateRight(value, 18) ^ (value >>> 3);
}

function lowerSigma1(value: number): number {
  return rotateRight(value, 17) ^ rotateRight(value, 19) ^ (value >>> 10);
}
