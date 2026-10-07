/**
 * Re-read a few already-extracted facts on the caller's open transaction.
 *
 * A full `extract()` opens its own read-only snapshot, so it cannot see the
 * caller's uncommitted (savepoint) changes, and it spends ~20 round trips on the
 * whole catalog to look at one object. This runs the SAME family queries and
 * row handling, so the payloads are byte-identical to a full extract, but wraps
 * each query in an identity filter that Postgres pushes down: about one round
 * trip per family touched. The caller must have pinned `search_path` to
 * `pg_catalog`, as extraction does, because deparsed text depends on it.
 */
import type { PoolClient } from "pg";
import type { Fact } from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";
import { policiesFamily } from "./policies.ts";
import { publicationsFamily } from "./publications.ts";
import {
  columnsFamily,
  indexesFamily,
  rulesFamily,
  tableConstraintsFamily,
  triggersFamily,
  viewsFamily,
} from "./relations.ts";
import { routinesFamily } from "./routines.ts";
import {
  type CatalogFamily,
  createCollectorContext,
  createExtractContext,
  type ExtractContext,
  type Row,
} from "./scope.ts";
import { domainsFamily } from "./types.ts";

interface Source {
  family: CatalogFamily;
  /** which of the family's statements returns this kind's rows */
  statement: number;
  /** row column → value identifying the fact (a superset match is fine) */
  key: Record<string, string>;
}

function sourceOf(fact: Fact): Source | undefined {
  const id = fact.id as unknown as Record<string, string>;
  const onTable = {
    schema: id["schema"]!,
    table: id["table"]!,
    name: id["name"]!,
  };
  const named = { schema: id["schema"]!, name: id["name"]! };
  switch (fact.id.kind) {
    case "trigger":
      return { family: triggersFamily, statement: 0, key: onTable };
    case "rule":
      return { family: rulesFamily, statement: 0, key: onTable };
    case "policy":
      return { family: policiesFamily, statement: 0, key: onTable };
    case "column":
    case "default":
      return { family: columnsFamily, statement: 0, key: onTable };
    case "constraint":
      return fact.parent?.kind === "domain"
        ? {
            family: domainsFamily,
            statement: 1,
            key: {
              schema: id["schema"]!,
              domain: id["table"]!,
              name: id["name"]!,
            },
          }
        : { family: tableConstraintsFamily, statement: 0, key: onTable };
    case "view":
    case "materializedView":
      return { family: viewsFamily, statement: 0, key: named };
    case "index":
      return { family: indexesFamily, statement: 0, key: named };
    case "domain":
      return { family: domainsFamily, statement: 0, key: named };
    case "function":
    case "procedure":
      return { family: routinesFamily, statement: 0, key: named };
    case "publicationRel":
      return {
        family: publicationsFamily,
        statement: 0,
        key: { name: id["publication"]! },
      };
    default:
      return undefined;
  }
}

// one version probe per connection, not per read
const contexts = new WeakMap<PoolClient, ExtractContext>();

/**
 * The current facts for `facts`' ids, keyed by encoded id. An id whose kind has
 * no scoped reader, or whose object no longer exists, is absent from the result.
 */
export async function readFactsScoped(
  client: PoolClient,
  facts: readonly Fact[],
): Promise<Map<string, Fact>> {
  const groups = new Map<
    string,
    {
      family: CatalogFamily;
      statement: number;
      columns: string[];
      keys: string[][];
    }
  >();
  for (const fact of facts) {
    const source = sourceOf(fact);
    if (source === undefined) continue;
    const columns = Object.keys(source.key);
    const groupKey = `${source.family.name}|${source.statement}|${columns.join(",")}`;
    const group = groups.get(groupKey) ?? {
      family: source.family,
      statement: source.statement,
      columns,
      keys: columns.map(() => []),
    };
    columns.forEach((column, i) => group.keys[i]!.push(source.key[column]!));
    groups.set(groupKey, group);
  }

  const read = new Map<string, Fact>();
  if (groups.size === 0) return read;
  let base = contexts.get(client);
  if (base === undefined) {
    base = await createExtractContext(client);
    contexts.set(client, base);
  }
  const version = {
    serverVersion: base.serverVersion,
    serverVersionNum: base.serverVersionNum,
    pgMajor: base.pgMajor,
  };
  for (const { family, statement, columns, keys } of groups.values()) {
    const statements = family.statements(version);
    const tuple = columns.map((c) => `f."${c}"::text`).join(", ");
    const arrays = columns.map((_, i) => `$${i + 1}::text[]`).join(", ");
    const result = await client.query<Row>(
      `SELECT * FROM (${statements[statement]!}) f WHERE (${tuple}) IN (SELECT * FROM unnest(${arrays}))`,
      keys,
    );
    const rowSets: Row[][] = statements.map(() => []);
    rowSets[statement] = result.rows;
    const ctx = createCollectorContext(base.q, version, true);
    family.apply(ctx, rowSets);
    for (const fact of ctx.facts) read.set(encodeId(fact.id), fact);
  }
  return read;
}
