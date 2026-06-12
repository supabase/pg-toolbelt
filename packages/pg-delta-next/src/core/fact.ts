/**
 * The fact base: a normalized, content-addressed relation
 * (target-architecture §3.1).
 *
 * Every addressable thing is its own fact with a parent *relation*;
 * hierarchy is a view. Payloads are identity-free (enforced upstream at
 * payload construction): a fact's own name lives in its id, never in what
 * is hashed.
 */
import type { Diagnostic } from "./diagnostic.ts";
import { contentHash, hashString, type ContentHash, type Payload } from "./hash.ts";
import { encodeId, type StableId } from "./stable-id.ts";

export interface Fact {
  id: StableId;
  parent?: StableId;
  payload: Payload;
}

export type EdgeKind = "depends" | "owner" | "memberOfExtension";

export interface DependencyEdge {
  /** The dependent object (must be torn down before / built after `to`). */
  from: StableId;
  /** The referenced object. */
  to: StableId;
  kind: EdgeKind;
}

interface Entry {
  fact: Fact;
  encoded: string;
  hash: ContentHash;
}

export class FactBase {
  readonly diagnostics: Diagnostic[] = [];
  readonly #byId = new Map<string, Entry>();
  readonly #children = new Map<string, Entry[]>();
  readonly #outgoing = new Map<string, DependencyEdge[]>();
  #edges: DependencyEdge[] = [];
  readonly #rollups = new Map<string, ContentHash>();
  readonly #structural = new Map<string, ContentHash>();
  #rootHash: ContentHash | undefined;

  constructor(facts: Fact[], edges: DependencyEdge[]) {
    for (const fact of facts) {
      const encoded = encodeId(fact.id);
      if (this.#byId.has(encoded)) {
        throw new Error(`FactBase: duplicate fact id ${encoded}`);
      }
      this.#byId.set(encoded, { fact, encoded, hash: contentHash(fact.payload) });
    }
    for (const entry of this.#byId.values()) {
      const parent = entry.fact.parent;
      if (parent === undefined) continue;
      const parentKey = encodeId(parent);
      if (!this.#byId.has(parentKey)) {
        throw new Error(
          `FactBase: fact ${entry.encoded} references missing parent ${parentKey}`,
        );
      }
      const siblings = this.#children.get(parentKey) ?? [];
      siblings.push(entry);
      this.#children.set(parentKey, siblings);
    }
    for (const children of this.#children.values()) {
      children.sort((a, b) => (a.encoded < b.encoded ? -1 : 1));
    }
    for (const edge of edges) {
      const fromKey = encodeId(edge.from);
      const toKey = encodeId(edge.to);
      if (!this.#byId.has(fromKey) || !this.#byId.has(toKey)) {
        this.diagnostics.push({
          code: "dangling_edge",
          severity: "warning",
          subject: this.#byId.has(fromKey) ? edge.to : edge.from,
          message: `edge ${fromKey} -[${edge.kind}]-> ${toKey} references a fact not in the base`,
        });
        continue;
      }
      this.#edges.push(edge);
      const list = this.#outgoing.get(fromKey) ?? [];
      list.push(edge);
      this.#outgoing.set(fromKey, list);
    }
  }

  get edges(): readonly DependencyEdge[] {
    return this.#edges;
  }

  facts(): Fact[] {
    return [...this.#byId.values()].map((e) => e.fact);
  }

  get(id: StableId): Fact | undefined {
    return this.#byId.get(encodeId(id))?.fact;
  }

  has(id: StableId): boolean {
    return this.#byId.has(encodeId(id));
  }

  hashOf(id: StableId): ContentHash {
    const entry = this.#byId.get(encodeId(id));
    if (!entry) throw new Error(`FactBase: unknown fact ${encodeId(id)}`);
    return entry.hash;
  }

  childrenOf(id: StableId): Fact[] {
    return (this.#children.get(encodeId(id)) ?? []).map((e) => e.fact);
  }

  outgoingEdges(id: StableId): readonly DependencyEdge[] {
    return this.#outgoing.get(encodeId(id)) ?? [];
  }

  /** Roots: facts with no parent, sorted by encoded id. */
  roots(): Fact[] {
    return [...this.#byId.values()]
      .filter((e) => e.fact.parent === undefined)
      .sort((a, b) => (a.encoded < b.encoded ? -1 : 1))
      .map((e) => e.fact);
  }

  /**
   * Named Merkle rollup: payload hash + (childId=childRollup) pairs sorted
   * by child id + outgoing edge hashes sorted. Identity changes in the
   * subtree propagate (a renamed child changes the parent's rollup).
   */
  rollupOf(id: StableId): ContentHash {
    return this.#rollup(encodeId(id));
  }

  #rollup(key: string): ContentHash {
    const cached = this.#rollups.get(key);
    if (cached !== undefined) return cached;
    const entry = this.#byId.get(key);
    if (!entry) throw new Error(`FactBase: unknown fact ${key}`);
    const childParts = (this.#children.get(key) ?? []).map(
      (c) => `${c.encoded}=${this.#rollup(c.encoded)}`,
    );
    const edgeParts = (this.#outgoing.get(key) ?? [])
      .map((e) => `${encodeId(e.from)}-[${e.kind}]->${encodeId(e.to)}`)
      .sort();
    const rollup = hashString(
      `F|${entry.hash}|C|${childParts.join(",")}|E|${edgeParts.join(",")}`,
    );
    this.#rollups.set(key, rollup);
    return rollup;
  }

  /**
   * Structural rollup: identity-free fold (payload hashes + child structural
   * rollups sorted by value; edges excluded — they embed identities). Used
   * for container rename matching (§4.1).
   */
  structuralRollupOf(id: StableId): ContentHash {
    return this.#structuralRollup(encodeId(id));
  }

  #structuralRollup(key: string): ContentHash {
    const cached = this.#structural.get(key);
    if (cached !== undefined) return cached;
    const entry = this.#byId.get(key);
    if (!entry) throw new Error(`FactBase: unknown fact ${key}`);
    const childParts = (this.#children.get(key) ?? [])
      .map((c) => this.#structuralRollup(c.encoded))
      .sort();
    const rollup = hashString(`S|${entry.hash}|C|${childParts.join(",")}`);
    this.#structural.set(key, rollup);
    return rollup;
  }

  /** The fingerprint of the whole state: (rootId=rollup) pairs, sorted. */
  get rootHash(): ContentHash {
    if (this.#rootHash === undefined) {
      const parts = this.roots().map(
        (f) => `${encodeId(f.id)}=${this.rollupOf(f.id)}`,
      );
      this.#rootHash = hashString(`ROOT|${parts.join(",")}`);
    }
    return this.#rootHash;
  }
}

export function buildFactBase(facts: Fact[], edges: DependencyEdge[]): FactBase {
  return new FactBase(facts, edges);
}
