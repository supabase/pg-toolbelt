/** Rule definitions for sequences. */
import type { StableId } from "../../core/stable-id.ts";
import type { Fact } from "../../core/fact.ts";
import { qid, rel } from "../render.ts";
import type { ActionSpec, FactView, KindRules } from "../rules.ts";
import { p, renameRule, rangesDisjoint, str } from "./helpers.ts";

export const sequenceRules: Record<string, KindRules> = {
  sequence: {
    weight: 3,
    cascadesToChildren: true,
    defaclObjtype: "S",
    dropRootRedirect: (fact, isRemoved) => {
      const ownedBy = fact.payload["ownedBy"] as {
        schema: string;
        table: string;
        column: string;
      } | null;
      if (ownedBy == null) return undefined;
      const columnId: StableId = {
        kind: "column",
        schema: ownedBy.schema,
        table: ownedBy.table,
        name: ownedBy.column,
      };
      if (isRemoved(columnId)) return columnId;
      const tableId: StableId = {
        kind: "table",
        schema: ownedBy.schema,
        name: ownedBy.table,
      };
      if (isRemoved(tableId)) return tableId;
      return undefined;
    },
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER SEQUENCE ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql:
            `CREATE SEQUENCE ${rel(id.schema, id.name)} AS ${str(p(fact, "dataType"))}` +
            ` INCREMENT BY ${str(p(fact, "increment"))} MINVALUE ${str(p(fact, "minValue"))}` +
            ` MAXVALUE ${str(p(fact, "maxValue"))} START WITH ${str(p(fact, "start"))}` +
            ` CACHE ${str(p(fact, "cache"))} ${p(fact, "cycle") ? "CYCLE" : "NO CYCLE"}`,
        },
        ...sequenceOwnedBySpecs(fact),
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP SEQUENCE ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER SEQUENCE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      // Every value option routes through the SAME combined-alter helper, which
      // emits ONE `ALTER SEQUENCE … <opt> <opt> …` statement from whichever
      // changed option sorts first (the emitter iterates changed attributes
      // independently). A single statement validates the FINAL state, so moving
      // both bounds at once no longer trips Postgres' transient `min > max`
      // rejection — see `sequenceOptionAlter`.
      dataType: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("dataType", fact, sourceView),
      },
      increment: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("increment", fact, sourceView),
      },
      minValue: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("minValue", fact, sourceView),
      },
      maxValue: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("maxValue", fact, sourceView),
      },
      start: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("start", fact, sourceView),
      },
      cache: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("cache", fact, sourceView),
      },
      cycle: {
        alter: (fact, _from, _to, _view, sourceView) =>
          sequenceOptionAlter("cycle", fact, sourceView),
      },
      ownedBy: {
        alter: (fact, from) =>
          sequenceOwnedBySpecs(fact, {
            allowNone: true,
            releaseOld: from as {
              schema: string;
              table: string;
              column: string;
            } | null,
          }),
      },
    },
  },
};

/** The CREATE-SEQUENCE-style value options a standalone sequence carries, in a
 *  fixed render order. `ownedBy` is deliberately excluded: it carries its own
 *  dependency metadata (consumes/releases) and is emitted as a separate
 *  `OWNED BY` statement. */
const SEQUENCE_VALUE_OPTIONS = [
  "dataType",
  "increment",
  "minValue",
  "maxValue",
  "start",
  "cache",
  "cycle",
] as const;

function sequenceOptionClause(fact: Fact, option: string): string {
  switch (option) {
    case "dataType":
      return `AS ${str(p(fact, "dataType"))}`;
    case "increment":
      return `INCREMENT BY ${str(p(fact, "increment"))}`;
    case "minValue":
      return `MINVALUE ${str(p(fact, "minValue"))}`;
    case "maxValue":
      return `MAXVALUE ${str(p(fact, "maxValue"))}`;
    case "start":
      return `START WITH ${str(p(fact, "start"))}`;
    case "cache":
      return `CACHE ${str(p(fact, "cache"))}`;
    case "cycle":
      return p(fact, "cycle") ? "CYCLE" : "NO CYCLE";
    default:
      throw new Error(`sequence rule: unknown value option '${option}'`);
  }
}

/** Combined `ALTER SEQUENCE … <opt> <opt> …` for a standalone sequence's
 *  value-option transition, emitted ONCE — from whichever changed option sorts
 *  first — because the emitter calls each changed attribute's `alter`
 *  independently and we want a SINGLE statement covering all of them.
 *
 *  One statement validates the FINAL state: per-field `ALTER SEQUENCE` statements
 *  in diff-field (lexicographic) order ran `MAXVALUE 50` while MIN was still 100
 *  when moving both bounds down, and Postgres rejects the transient `min > max`.
 *
 *  `RESTART` is appended only when the old and new ranges are provably DISJOINT —
 *  see {@link rangesDisjoint} and `identityOptionAlterSpecs` in tables.ts for the
 *  identity seam's identical reasoning: the sequence's live counter (unmanaged
 *  runtime state, not part of the diff) is left in place for an overlapping
 *  change, because it is probably still valid and resetting it risks duplicate
 *  keys; only a disjoint shift guarantees the counter is invalid. */
function sequenceOptionAlter(
  currentAttr: string,
  fact: Fact,
  sourceView: FactView,
): ActionSpec[] {
  const source = sourceView.get(fact.id);
  const changed = SEQUENCE_VALUE_OPTIONS.filter(
    (key) => source === undefined || source.payload[key] !== fact.payload[key],
  );
  if (changed.length === 0) return [];
  const [lead] = [...changed].sort();
  if (currentAttr !== lead) return [];
  const id = fact.id as { schema: string; name: string };
  const clauses = changed.map((option) => sequenceOptionClause(fact, option));
  if (
    source !== undefined &&
    rangesDisjoint(
      str(source.payload["minValue"]),
      str(source.payload["maxValue"]),
      str(p(fact, "minValue")),
      str(p(fact, "maxValue")),
    )
  )
    clauses.push("RESTART");
  return [
    { sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} ${clauses.join(" ")}` },
  ];
}

/**
 * OWNED BY is rendered as a follow-up statement (pg_dump's model): an auto
 * edge sequence→column would cycle with the column default that references
 * the sequence.
 */
function sequenceOwnedBySpecs(
  fact: Fact,
  opts: {
    allowNone?: boolean;
    /** the previous owner (an ownedBy payload value) when this is an in-place
     *  reassignment — released so the ALTER runs before a same-plan DROP of the
     *  old owning column/table, which would otherwise cascade the sequence away
     *  before it is re-owned. */
    releaseOld?: { schema: string; table: string; column: string } | null;
  } = {},
): ActionSpec[] {
  const id = fact.id as { schema: string; name: string };
  const old = opts.releaseOld;
  const releases: StableId[] =
    old != null
      ? [
          {
            kind: "column",
            schema: old.schema,
            table: old.table,
            name: old.column,
          },
        ]
      : [];
  const ownedBy = p(fact, "ownedBy") as {
    schema: string;
    table: string;
    column: string;
  } | null;
  if (ownedBy == null) {
    return opts.allowNone
      ? [
          {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY NONE`,
            ...(releases.length > 0 ? { releases } : {}),
          },
        ]
      : [];
  }
  return [
    {
      sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY ${rel(ownedBy.schema, ownedBy.table)}.${qid(ownedBy.column)}`,
      consumes: [
        {
          kind: "column",
          schema: ownedBy.schema,
          table: ownedBy.table,
          name: ownedBy.column,
        },
      ],
      ...(releases.length > 0 ? { releases } : {}),
    },
  ];
}
