/** Rule definitions for tables and their column / default sub-objects. */
import type { Fact } from "../../core/fact.ts";
import type { PayloadValue } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { qid, rel } from "../render.ts";
import type { ActionSpec, FactView, KindRules } from "../rules.ts";
import {
  dependencyConsumes,
  type IdentityOptions,
  type IdentityPayload,
  identityGeneration,
  identityOptions,
  identitySequenceId,
  p,
  rangesDisjoint,
  reloptionsAlterSpecs,
  renameRule,
  str,
} from "./helpers.ts";

export const tableRules: Record<string, KindRules> = {
  table: {
    weight: 4,
    cascadesToChildren: true,
    // Partitions / INHERITS children are parented at the schema, not the
    // parent table. Incoming inherit `depends` must force-rebuild them when
    // the parent is replaced (DROP TABLE cascades them away).
    rebuildable: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TABLE ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view) => {
      const id = fact.id as { schema: string; name: string };
      const relName = rel(id.schema, id.name);
      const persistence = str(p(fact, "persistence"));
      const unlogged = persistence === "u" ? "UNLOGGED " : "";
      const bound = p(fact, "partitionBound");
      const partKey = p(fact, "partitionKey");
      const parentT = p(fact, "parentTable") as {
        schema: string;
        name: string;
      } | null;

      let createSql: string;
      const consumes: StableId[] = [];
      const alsoProduces: StableId[] = [];
      const materializedIndexFixups: ActionSpec[] = [];
      if (bound != null && parentT != null) {
        // a partition: columns are inherited, the bound carries the shape
        createSql = `CREATE ${unlogged}TABLE ${relName} PARTITION OF ${rel(parentT.schema, parentT.name)} ${str(bound)}`;
        // a partition may itself be partitioned (multi-level partitioning): keep
        // its own PARTITION BY so sub-partitions can attach — otherwise the
        // middle layer is created as a plain table and its leaves fail to attach.
        if (partKey != null) createSql += ` PARTITION BY ${str(partKey)}`;
        const parentId: StableId = {
          kind: "table",
          schema: parentT.schema,
          name: parentT.name,
        };
        consumes.push(parentId);
        // `CREATE INDEX … ON ONLY` / `ADD PRIMARY KEY` do not recurse onto
        // partitions that already exist. PARTITION OF after those facts inherit
        // them (and attaches child indexes). Consume so attach cannot run first.
        // A sub-partitioned partition's PARTITION BY names inherited columns:
        // a key column an ancestor gains in this plan must be ADDed first
        // ("column ... named in partition key does not exist"). Only local
        // columns are facts, so the column sits on whichever ancestor declares
        // it; walk the parentTable chain up to the root.
        if (partKey != null) {
          const seen = new Set<string>();
          let ancestor: StableId | undefined = parentId;
          while (ancestor !== undefined && !seen.has(encodeId(ancestor))) {
            seen.add(encodeId(ancestor));
            for (const col of view.childrenOf(ancestor)) {
              if (
                col.id.kind === "column" &&
                p(col, "_partitionKey") === true
              ) {
                consumes.push(col.id);
              }
            }
            const up = view.get(ancestor)?.payload["parentTable"] as
              | { schema: string; name: string }
              | null
              | undefined;
            ancestor =
              up == null
                ? undefined
                : { kind: "table", schema: up.schema, name: up.name };
          }
        }
        for (const child of view.childrenOf(parentId)) {
          if (child.id.kind === "index") consumes.push(child.id);
          if (child.id.kind === "constraint") {
            const ctype = p(child, "type");
            if (ctype === "p" || ctype === "u") consumes.push(child.id);
          }
        }
        // PARTITION OF materializes attached child indexes. Local-only
        // indexes on the partition are still standalone CREATE INDEX.
        for (const child of view.childrenOf(fact.id)) {
          if (child.id.kind === "index" && p(child, "attachedTo") != null) {
            alsoProduces.push(child.id);
            // Postgres rejects SET/RESET on a partitioned index, so a
            // sub-partitioned partition keeps the materialized options.
            if (partKey != null) continue;
            const idx = child.id as { schema: string; name: string };
            materializedIndexFixups.push(
              ...reloptionsAlterSpecs(
                `ALTER INDEX ${rel(idx.schema, idx.name)}`,
                p(child, "_attachedReloptions") ?? null,
                p(child, "_reloptions") ?? null,
              ),
            );
          }
        }
      } else {
        // partitioned parents must inline their columns: the partition key
        // references them, so decomposed ADD COLUMN cannot work (§3.4
        // delta-set inlining). The statement produces the column facts too.
        let cols = "";
        if (partKey != null) {
          const colFacts = view
            .childrenOf(fact.id)
            .filter((c) => c.id.kind === "column");
          // Column ORDER is row-layout state: render in declared position
          // (`_position` = pg_attribute.attnum, captured at extract time), NOT
          // the encoded-id (name) order childrenOf() yields. Fall back to the
          // incoming order when `_position` is absent (legacy fact bases) so the
          // sort stays stable and total. Mirrors the composite CREATE TYPE path
          // (plan/rules/types.ts). The bare foldable path is handled separately:
          // its columns arrive as ADD COLUMN folds, ordered by the tie-break in
          // plan/phases/action-graph.ts.
          if (colFacts.every((c) => p(c, "_position") != null)) {
            colFacts.sort(
              (a, b) => Number(p(a, "_position")) - Number(p(b, "_position")),
            );
          }
          cols = colFacts.map(columnClause).join(", ");
          for (const c of colFacts) alsoProduces.push(c.id);
        }
        createSql = `CREATE ${unlogged}TABLE ${relName} (${cols})`;
        if (parentT != null) {
          const parents = [
            parentT,
            ...((p(fact, "inheritsAlso") as
              | { schema: string; name: string }[]
              | undefined) ?? []),
          ];
          createSql += ` INHERITS (${parents.map((t) => rel(t.schema, t.name)).join(", ")})`;
          for (const t of parents) {
            consumes.push({ kind: "table", schema: t.schema, name: t.name });
          }
        }
        if (partKey != null) createSql += ` PARTITION BY ${str(partKey)}`;
      }

      // only the bare shape (no partition machinery, no INHERITS suffix)
      // can absorb folded column clauses without SQL surgery ambiguity
      const foldable = bound == null && partKey == null && parentT == null;
      const specs: ActionSpec[] = [
        {
          sql: createSql,
          ...(consumes.length > 0 ? { consumes } : {}),
          alsoProduces,
          ...(foldable ? { acceptsColumnFolds: true } : {}),
        },
      ];
      if (p(fact, "rowSecurity")) {
        specs.push({ sql: `ALTER TABLE ${relName} ENABLE ROW LEVEL SECURITY` });
      }
      if (p(fact, "forceRowSecurity")) {
        specs.push({ sql: `ALTER TABLE ${relName} FORCE ROW LEVEL SECURITY` });
      }
      const replident = p(fact, "replicaIdentity");
      if (replident != null && replident !== "d") {
        specs.push(replicaIdentitySpec(fact, view));
      }
      // storage reloptions (fillfactor, autovacuum_*, …) as a SET follow-up,
      // keeping them out of the partition/INHERITS/PARTITION BY create grammar
      const reloptions = p(fact, "reloptions") as string[] | null;
      if (reloptions != null && reloptions.length > 0) {
        specs.push({
          sql: `ALTER TABLE ${relName} SET (${reloptions.join(", ")})`,
        });
      }
      specs.push(...materializedIndexFixups);
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return {
        sql: `DROP TABLE ${rel(id.schema, id.name)}`,
        dataLoss: "destructive",
      };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TABLE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      persistence: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} SET ${str(to) === "u" ? "UNLOGGED" : "LOGGED"}`,
            rewriteRisk: true,
          };
        },
      },
      rowSecurity: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} ${to ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY`,
          };
        },
      },
      forceRowSecurity: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.name)} ${to ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`,
          };
        },
      },
      replicaIdentity: {
        alter: (fact, _from, _to, view) => replicaIdentitySpec(fact, view),
      },
      replicaIdentityIndex: {
        alter: (fact, _from, _to, view) => replicaIdentitySpec(fact, view),
      },
      reloptions: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return reloptionsAlterSpecs(
            `ALTER TABLE ${rel(id.schema, id.name)}`,
            from,
            to,
          );
        },
      },
      partitionKey: "replace",
      partitionBound: "replace",
      parentTable: "replace",
      inheritsAlso: "replace",
    },
  },

  column: {
    weight: 5,
    cascadesToChildren: true,
    // Postgres rejects ALTER COLUMN ... TYPE (which also carries a collation
    // change) and DROP COLUMN on a partition key column ("... is part of the
    // partition key of relation ..."), including a sub-partition's key. Those
    // changes replace the partitioned table instead. Other changes, such as
    // SET NOT NULL, stay in place.
    replaceRoot: (fact, change) => {
      if (p(fact, "_partitionKey") !== true) return undefined;
      const blocked =
        change.verb === "remove" ||
        change.attrs.has("type") ||
        change.attrs.has("collation");
      return blocked ? fact.parent : undefined;
    },
    rename: (fact, to) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} RENAME COLUMN ${qid(column)} TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact, view) => {
      const { schema, table, column } = columnRef(fact);
      // delta-set inlining (§3.4): a column arriving WITH a default must
      // carry it inline — ADD COLUMN … NOT NULL fails on populated tables
      // otherwise. The statement then produces the default fact too.
      const defaultChild = view
        .childrenOf(fact.id)
        .find((c) => c.id.kind === "default" && c.id.name === column);
      let clause = columnClause(fact);
      const alsoProduces: StableId[] = [];
      if (defaultChild) {
        clause += ` DEFAULT ${str(defaultChild.payload["expr"])}`;
        alsoProduces.push(defaultChild.id);
      }
      // ADD COLUMN rewrites the table when it materializes a value for every
      // row: a STORED generated column always, an identity column (nextval per
      // row), or an inline DEFAULT whose expression may be volatile (nextval,
      // now, …). We cannot tell a constant default from a volatile one without
      // parsing (guardrail 2), so any inline default conservatively declares
      // rewriteRisk — over-declaring is safe (the proof only fails on
      // UNDER-declared rewrites).
      const rewrites =
        fact.payload["generatedExpr"] != null ||
        fact.payload["identity"] != null ||
        defaultChild !== undefined;
      const spec: ActionSpec = {
        sql: `ALTER TABLE ${rel(schema, table)} ADD COLUMN ${clause}`,
        alsoProduces,
        ...(rewrites ? { rewriteRisk: true } : {}),
      };
      if (fact.parent !== undefined && fact.parent.kind === "table") {
        // A generated column folds too (#518). Its expression's columns are
        // pg_depend edges, so compaction's crossing veto keeps it an ADD COLUMN
        // whenever a column it reads was not folded into the CREATE first.
        spec.compaction = { foldInto: fact.parent, clause };
      }
      return [spec];
    },
    drop: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} DROP COLUMN ${qid(column)}`,
        dataLoss: "destructive",
      };
    },
    attributes: {
      type: {
        // delta-set shape: defaults can't be cast through a type change, so
        // the change is sandwiched DROP DEFAULT → TYPE … USING → SET DEFAULT.
        // Identity and generated columns take neither bookend (they can't hold a
        // default and PostgreSQL rejects the statements outright) — see below.
        alter: (fact, from, to, view, sourceView) => {
          const { schema, table, column } = columnRef(fact);
          const target = `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)}`;
          // `fact` is the DESIRED-side column. Identity add/drop deltas land on
          // this same fact and the differ emits a fact's attributes
          // ALPHABETICALLY (`identity` < `type`), which the topo tie-break
          // preserves — so by the time these statements run the column's
          // identity state is already the DESIRED one. Gate identity-sensitive
          // statements on `desiredIdentity`, not the source.
          const sourceColumn = sourceView.get(fact.id) ?? fact;
          const sourceIdentity = sourceColumn.payload["identity"] ?? null;
          const desiredIdentity = fact.payload["identity"] ?? null;
          // `generated` stays SOURCE-side: a generatedExpr change routes through
          // a column replace, so whenever `type.alter` runs at all the source
          // and desired generated-ness are necessarily the same.
          const sourceGenerated = sourceColumn.payload["generatedExpr"] != null;
          // Foreign tables have no local storage, so PostgreSQL rejects the
          // USING cast clause ("<rel> is not a table", 42809) — it would force a
          // rewrite. The plain TYPE change is metadata-only and carries no
          // rewrite risk. (Regular tables keep the USING cast + rewriteRisk.)
          const isForeign = fact.parent?.kind === "foreignTable";
          // The retyped column depends on its NEW type via a column→type
          // pg_depend edge; consume it so this TYPE change is ordered AFTER a
          // same-plan CREATE of that type. Symmetrically, release the OLD type
          // (the source-side edge) so the change runs BEFORE a same-plan DROP of
          // it. Built-in types record no such edge (system-scoped endpoints are
          // dropped in extract), so a plain widening leaves both sets empty.
          const consumes = dependencyConsumes(view, fact.id);
          const releases = dependencyConsumes(sourceView, fact.id);
          // PostgreSQL has no enum-to-enum cast (42846), so an enum-to-enum
          // retype hops through text — element-wise `text[]` for an array
          // column (format_type renders arrays with a trailing `[]`). Only
          // enum-to-enum: any other target keeps the direct cast so a
          // user-defined cast (e.g. enum AS integer) still applies. The type
          // edges resolve an array column to its element enum.
          const isEnum = (v: FactView, ids: StableId[]) =>
            ids.some((id) => v.get(id)?.payload["variant"] === "enum");
          const hop =
            isEnum(sourceView, releases) && isEnum(view, consumes)
              ? str(from).endsWith("[]")
                ? "::text[]"
                : "::text"
              : "";
          // A generated column also rejects the USING clause ("cannot specify
          // USING when altering type of generated column") — PostgreSQL
          // recomputes the value from the generation expression. That still
          // rewrites the table, so rewriteRisk stays (unlike the foreign case).
          const usingCast =
            isForeign || sourceGenerated
              ? ""
              : ` USING ${qid(column)}${hop}::${str(to)}`;
          const typeSpec: ActionSpec = {
            sql: `${target} TYPE ${str(to)}${usingCast}`,
            ...(isForeign ? {} : { rewriteRisk: true }),
          };
          if (consumes.length > 0) typeSpec.consumes = consumes;
          if (releases.length > 0) typeSpec.releases = releases;
          const specs: ActionSpec[] = [];
          // DROP DEFAULT is a harmless no-op on a plain column that has none,
          // but PostgreSQL REJECTS it on an identity column ("… is an identity
          // column") or a generated column ("… is a generated column") whether
          // or not a default exists — and neither kind can carry one anyway.
          // The identity side reads DESIRED (see above): a plain column that
          // gains identity in this same plan is ALREADY an identity column here,
          // and an identity column that loses it is already plain (so the no-op
          // is emitted, harmlessly, after DROP IDENTITY).
          if (desiredIdentity == null && !sourceGenerated) {
            specs.push({ sql: `${target} DROP DEFAULT` });
          }
          // An identity column's implicit sequence is typed after the column, so
          // retyping moves the column type AND the identity bounds. Both deltas
          // land on the SAME fact with no edge between them, so `identity.alter`
          // skips the bounds when a `type` delta is present and `type.alter`
          // positions that ONE chained-SET statement (never split — see
          // identityOptionAlterSpecs) relative to the TYPE by direction:
          //   - WIDENING (or an unrecognised type pair): AFTER. The desired
          //     bounds may exceed the old type's range, so setting them first
          //     fails; PostgreSQL re-derives an at-type-max bound from the new
          //     type and the explicit SET then converges the exact values.
          //   - NARROWING: BEFORE. An explicit bound that overflows the new type
          //     makes the retype itself fail ("MAXVALUE (5000000000) is out of
          //     range for sequence data type integer"). Setting the bounds first
          //     is always valid here because the desired values fit the desired
          //     (narrower) type, which is a subset of the old type's range.
          // Any RESTART rides along with the statement wherever it lands — the
          // restart target is the desired START, inside the desired range.
          const boundSpecs =
            sourceIdentity != null && desiredIdentity != null
              ? identityOptionAlterSpecs(
                  target,
                  identityOptions(sourceIdentity),
                  identityOptions(desiredIdentity),
                )
              : [];
          const narrowing = isNarrowingIdentityTypeChange(str(from), str(to));
          if (narrowing) specs.push(...boundSpecs);
          specs.push(typeSpec);
          if (!narrowing) specs.push(...boundSpecs);
          const desiredDefault = view
            .childrenOf(fact.id)
            .find((c) => c.id.kind === "default");
          if (desiredDefault) {
            specs.push({
              sql: `${target} SET DEFAULT ${str(desiredDefault.payload["expr"])}`,
            });
          }
          return specs;
        },
        // PostgreSQL rejects ALTER COLUMN … TYPE while a view, rule, or
        // policy references the column (0A000). Those dependents must be
        // dropped before the alter and recreated after; indexes and
        // constraints are NOT force-rebuilt (PG rebuilds them itself, and
        // dropping a PK with dependent FKs would cascade harmfully).
        rebuildsDependents: () => [
          "view",
          "materializedView",
          "rule",
          "policy",
        ],
      },
      notNull: {
        alter: (fact, _from, to) => {
          const { schema, table, column } = columnRef(fact);
          return {
            sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} ${to ? "SET" : "DROP"} NOT NULL`,
          };
        },
      },
      identity: {
        alter: (fact, from, to, _view, sourceView) => {
          const { schema, table, column } = columnRef(fact);
          const target = `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)}`;
          const fromSeq = identitySequenceId(from);
          const toSeq = identitySequenceId(to);
          if (to == null) {
            // the backing sequence dies with the identity; declaring it lets
            // the graph order a CREATE SEQUENCE of the same name afterwards
            return {
              sql: `${target} DROP IDENTITY`,
              ...(fromSeq == null ? {} : { alsoDestroys: [fromSeq] }),
            };
          }
          const phrase =
            identityGeneration(to) === "a"
              ? "GENERATED ALWAYS"
              : "GENERATED BY DEFAULT";
          const columnType = str(p(fact, "type"));
          if (from == null) {
            // ADD IDENTITY materializes the backing sequence; declaring it
            // orders this after a DROP SEQUENCE freeing the name. Non-default
            // sequence parameters ride along inline.
            return {
              sql: `${target} ADD ${phrase} AS IDENTITY${identityOptionsClause(identityOptions(to), columnType, identitySequenceNameClause(to, { schema, table, column }))}`,
              ...(toSeq == null ? {} : { alsoProduces: [toSeq] }),
            };
          }
          const specs: ActionSpec[] = [];
          if (identityGeneration(from) !== identityGeneration(to)) {
            specs.push({ sql: `${target} SET ${phrase}` });
          }
          if (
            fromSeq != null &&
            toSeq != null &&
            encodeId(fromSeq) !== encodeId(toSeq)
          ) {
            const fromParts = fromSeq as { schema: string; name: string };
            const toParts = toSeq as { schema: string; name: string };
            specs.push({
              sql: `ALTER SEQUENCE ${rel(fromParts.schema, fromParts.name)} RENAME TO ${qid(toParts.name)}`,
              alsoDestroys: [fromSeq],
              alsoProduces: [toSeq],
            });
          }
          // a parameter-only change (START/INCREMENT/CACHE/MIN/MAX/CYCLE) is an
          // in-place ALTER COLUMN SET — no sequence rebuild.
          // A concurrent `type` delta on the same column owns these bounds: they
          // must run AFTER the type change (the backing sequence is retyped with
          // the column), and `type.alter` folds them in there. Emitting them here
          // too would run them first — while the sequence still has the old type.
          const sourceType = sourceView.get(fact.id)?.payload["type"];
          const retyped =
            sourceType !== undefined && sourceType !== p(fact, "type");
          if (!retyped) {
            specs.push(
              ...identityOptionAlterSpecs(
                target,
                identityOptions(from),
                identityOptions(to),
              ),
            );
          }
          return specs;
        },
      },
      collation: "replace",
      generatedExpr: "replace",
    },
  },

  default: {
    weight: 6,
    cascadesToChildren: true,
    rebuildable: true,
    create: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return [
        {
          sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} SET DEFAULT ${str(p(fact, "expr"))}`,
        },
      ];
    },
    drop: (fact) => {
      const { schema, table, column } = columnRef(fact);
      return {
        sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} DROP DEFAULT`,
      };
    },
    attributes: {
      expr: {
        alter: (fact, _from, to) => {
          const { schema, table, column } = columnRef(fact);
          return {
            sql: `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)} SET DEFAULT ${str(to)}`,
          };
        },
      },
    },
  },
};

/** Type-derived max for the implicit identity sequence; null for a type we
 *  don't recognise (then any captured options are treated as non-default and
 *  rendered explicitly, which is always safe). */
const IDENTITY_TYPE_MAX: Record<string, string> = {
  smallint: "32767",
  integer: "2147483647",
  bigint: "9223372036854775807",
};

/** true when an identity column's type change NARROWS its value range (the new
 *  type's max is strictly below the old one's). Used to position the identity
 *  bounds relative to the `ALTER COLUMN … TYPE`: narrowing must set the bounds
 *  FIRST (an explicit bound that overflows the new type makes the retype itself
 *  fail — "MAXVALUE … is out of range for sequence data type integer"), while
 *  widening must set them AFTER (the desired values need not fit the old type).
 *  Returns false when either type is unmapped, keeping the widening/after
 *  behavior as the conservative default. Maxima reach
 *  9223372036854775807, past Number's safe-integer range, so compare with
 *  BigInt. */
function isNarrowingIdentityTypeChange(
  fromType: string,
  toType: string,
): boolean {
  const fromMax = IDENTITY_TYPE_MAX[fromType];
  const toMax = IDENTITY_TYPE_MAX[toType];
  if (fromMax === undefined || toMax === undefined) return false;
  return BigInt(toMax) < BigInt(fromMax);
}

/** true when the identity sequence carries exactly the parameters PostgreSQL
 *  picks for a bare `GENERATED … AS IDENTITY` of the given column type, so the
 *  clause can stay bare (no churn for ordinary identity columns). */
function isDefaultIdentityOptions(
  options: IdentityOptions,
  columnType: string,
): boolean {
  return (
    options.increment === "1" &&
    options.start === "1" &&
    options.minValue === "1" &&
    options.cache === "1" &&
    options.cycle === false &&
    options.maxValue === IDENTITY_TYPE_MAX[columnType]
  );
}

/** The name PostgreSQL auto-derives for an identity column's implicit backing
 *  sequence: `<table>_<column>_seq` (in the table's own schema). */
function defaultIdentitySequenceName(table: string, column: string): string {
  return `${table}_${column}_seq`;
}

/** ` SEQUENCE NAME "<schema>"."<name>"` when the backing sequence's name (or
 *  schema) differs from PostgreSQL's `<table>_<column>_seq` default — the
 *  sequence was renamed or created via `SEQUENCE NAME`. Returns "" for the
 *  ordinary default-named case so exports stay minimal. Truncation/collision
 *  edge cases produce a name that never equals the naive default, so they
 *  always emit the clause — verbose but always valid, never a wrong-name
 *  round-trip. */
function identitySequenceNameClause(
  value: PayloadValue,
  ref: { schema: string; table: string; column: string },
): string {
  if (value == null) return "";
  const sequence = (value as unknown as IdentityPayload).sequence;
  if (sequence == null) return "";
  const isDefault =
    sequence.schema === ref.schema &&
    sequence.name === defaultIdentitySequenceName(ref.table, ref.column);
  return isDefault
    ? ""
    : `SEQUENCE NAME ${rel(sequence.schema, sequence.name)}`;
}

/** ` (SEQUENCE NAME … INCREMENT BY … MINVALUE … …)` for an identity sequence
 *  with a non-default name and/or parameters, or "" when the name is the
 *  `<table>_<column>_seq` default and the parameters are the type defaults.
 *  `SEQUENCE NAME` is a valid identity option and PostgreSQL accepts it first
 *  in the list (pg_dump renders it the same way). */
function identityOptionsClause(
  options: IdentityOptions | null,
  columnType: string,
  sequenceNameClause = "",
): string {
  const parts: string[] = [];
  if (sequenceNameClause) parts.push(sequenceNameClause);
  if (options != null && !isDefaultIdentityOptions(options, columnType)) {
    parts.push(
      `INCREMENT BY ${options.increment}`,
      `MINVALUE ${options.minValue}`,
      `MAXVALUE ${options.maxValue}`,
      `START WITH ${options.start}`,
      `CACHE ${options.cache}`,
      options.cycle ? "CYCLE" : "NO CYCLE",
    );
  }
  return parts.length === 0 ? "" : ` (${parts.join(" ")})`;
}

/** in-place identity-sequence parameter transition (no rebuild), emitted as ONE
 *  `ALTER COLUMN … SET <opt> SET <opt> …` statement.
 *
 *  A single ALTER COLUMN with CHAINED `SET` clauses validates the FINAL state:
 *  splitting the change into one statement per option (in diff-field order) ran
 *  `SET MAXVALUE 50` while MIN was still 100 when moving both bounds down —
 *  Postgres rejects the transient `min > max`. Chaining defers the range check to
 *  the end of the statement (verified on PG15/17).
 *
 *  `RESTART` is appended only when the old and new ranges are provably DISJOINT
 *  (see {@link rangesDisjoint}). An overlapping change — even one that moves a
 *  bound AND the START — leaves the live counter alone, because it is probably
 *  still valid and resetting it risks duplicate keys. */
function identityOptionAlterSpecs(
  target: string,
  from: IdentityOptions | null,
  to: IdentityOptions | null,
): ActionSpec[] {
  if (to == null) return [];
  const clauses: string[] = [];
  if (from == null || from.increment !== to.increment)
    clauses.push(`SET INCREMENT BY ${to.increment}`);
  if (from == null || from.minValue !== to.minValue)
    clauses.push(`SET MINVALUE ${to.minValue}`);
  if (from == null || from.maxValue !== to.maxValue)
    clauses.push(`SET MAXVALUE ${to.maxValue}`);
  if (from == null || from.start !== to.start)
    clauses.push(`SET START WITH ${to.start}`);
  if (from == null || from.cache !== to.cache)
    clauses.push(`SET CACHE ${to.cache}`);
  if (from == null || from.cycle !== to.cycle)
    clauses.push(`SET ${to.cycle ? "CYCLE" : "NO CYCLE"}`);
  if (clauses.length === 0) return [];
  if (
    from != null &&
    rangesDisjoint(from.minValue, from.maxValue, to.minValue, to.maxValue)
  )
    clauses.push("RESTART");
  return [{ sql: `${target} ${clauses.join(" ")}` }];
}

function columnRef(fact: Fact): {
  table: string;
  schema: string;
  column: string;
} {
  const id = fact.id as { schema: string; table: string; name: string };
  return { schema: id.schema, table: id.table, column: id.name };
}

function columnClause(fact: Fact): string {
  const { column } = columnRef(fact);
  const type = str(p(fact, "type"));
  let sql = `${qid(column)} ${type}`;
  const collation = p(fact, "collation");
  if (collation != null) sql += ` COLLATE ${str(collation)}`;
  const generated = p(fact, "generatedExpr");
  if (generated != null)
    sql += ` GENERATED ALWAYS AS (${str(generated)}) STORED`;
  const identity = p(fact, "identity");
  const generation = identityGeneration(identity);
  if (generation === "a" || generation === "d") {
    sql += ` GENERATED ${generation === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`;
    sql += identityOptionsClause(
      identityOptions(identity),
      type,
      identitySequenceNameClause(identity, columnRef(fact)),
    );
  }
  if (p(fact, "notNull")) sql += ` NOT NULL`;
  return sql;
}

/**
 * REPLICA IDENTITY rendered from the desired payload (both attributes render
 * the identical full clause, so order between them never matters). USING
 * INDEX consumes whichever fact owns that index name (a real index fact, or
 * the constraint backing it).
 */
function replicaIdentitySpec(fact: Fact, view: FactView): ActionSpec {
  const id = fact.id as { schema: string; name: string };
  const mode = str(p(fact, "replicaIdentity") ?? "d");
  const relName = rel(id.schema, id.name);
  if (mode === "n") {
    return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY NOTHING` };
  }
  if (mode === "f") {
    return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY FULL` };
  }
  if (mode === "i") {
    const indexName = str(p(fact, "replicaIdentityIndex"));
    const consumes: StableId[] = [];
    const ownedConstraint = view
      .childrenOf(fact.id)
      .find((c) => c.id.kind === "constraint" && c.id.name === indexName);
    if (ownedConstraint) consumes.push(ownedConstraint.id);
    else consumes.push({ kind: "index", schema: id.schema, name: indexName });
    return {
      sql: `ALTER TABLE ${relName} REPLICA IDENTITY USING INDEX ${qid(indexName)}`,
      consumes,
    };
  }
  return { sql: `ALTER TABLE ${relName} REPLICA IDENTITY DEFAULT` };
}
