/** Rule definitions for standalone indexes. */
import { rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import { p, renameRule, str } from "./helpers.ts";

export const indexRules: Record<string, KindRules> = {
  index: {
    weight: 14,
    cascadesToChildren: true,
    rebuildable: true,
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER INDEX ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view, params) => {
      const def = str(p(fact, "def"));
      const id = fact.id as { schema: string; name: string };
      // PostgreSQL REJECTS `CREATE INDEX CONCURRENTLY` on a partitioned table's
      // parent index (relkind='p') — the parent index is metadata-only and is
      // materialized by building each partition's own index, so there is
      // nothing to build concurrently at the parent. Detect it via the parent
      // TABLE fact's `partitionKey` (the `PARTITION BY` clause, null for
      // ordinary tables) and keep the create plain/transactional; each
      // partition's index attachment still builds normally. (Building each
      // partition's index concurrently then attaching is out of scope.)
      const parentTable =
        fact.parent?.kind === "table" ? view.get(fact.parent) : undefined;
      const parentIsPartitioned =
        parentTable != null && p(parentTable, "partitionKey") != null;
      const specs: ActionSpec[] =
        params?.["concurrentIndexes"] === true && !parentIsPartitioned
          ? [
              {
                // pg_get_indexdef never includes CONCURRENTLY (an execution choice,
                // not state); splice it into the canonical def
                sql: def.replace(
                  /^CREATE (UNIQUE )?INDEX /,
                  "CREATE $1INDEX CONCURRENTLY ",
                ),
                lockClass: "shareUpdateExclusive",
                transactionality: "nonTransactional",
              },
            ]
          : [{ sql: def }];
      const attachedTo = p(fact, "attachedTo") as {
        schema: string;
        name: string;
      } | null;
      if (attachedTo != null) {
        specs.push({
          sql: `ALTER INDEX ${rel(attachedTo.schema, attachedTo.name)} ATTACH PARTITION ${rel(id.schema, id.name)}`,
          consumes: [
            { kind: "index", schema: attachedTo.schema, name: attachedTo.name },
          ],
        });
      }
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP INDEX ${rel(id.schema, id.name)}` };
    },
    // Attached child indexes vanish with DROP INDEX on the parent; PostgreSQL
    // refuses DROP on the child while the parent still requires it.
    dropRootRedirect: (fact, isRemoved) => {
      const attachedTo = p(fact, "attachedTo") as {
        schema: string;
        name: string;
      } | null;
      if (attachedTo == null) return undefined;
      const parentIdx = {
        kind: "index" as const,
        schema: attachedTo.schema,
        name: attachedTo.name,
      };
      return isRemoved(parentIdx) ? parentIdx : undefined;
    },
    // `valid` (pg_index.indisvalid) participates in the diff: an invalid index
    // (failed CREATE INDEX CONCURRENTLY) differs from the desired valid one even
    // when their `def` is identical, and the only repair is drop + recreate —
    // hence "replace", same strategy as `def`. See extract/relations.ts.
    // `attachedTo` is the pg_inherits parent index; attaching is in-place,
    // detaching has no grammar so the fact is replaced.
    attributes: {
      def: "replace",
      valid: "replace",
      attachedTo: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          const parent = to as { schema: string; name: string };
          return {
            sql: `ALTER INDEX ${rel(parent.schema, parent.name)} ATTACH PARTITION ${rel(id.schema, id.name)}`,
            consumes: [
              { kind: "index", schema: parent.schema, name: parent.name },
            ],
          };
        },
        replaceWhen: (_from, to) => to == null,
      },
    },
  },
};
