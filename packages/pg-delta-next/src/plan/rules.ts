/**
 * The rule table (target-architecture §3.4): the ONLY per-kind logic in the
 * system. Structured data — functions confined to template slots
 * (guardrail 3). Each rule maps facts/attribute-changes to SQL plus the
 * dependency metadata the graph needs.
 */
import type { Fact } from "../core/fact.ts";
import type { PayloadValue } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import type { LockClass } from "./locks.ts";
import {
  alterOptionsClause,
  commentTarget,
  grantTarget,
  lit,
  optionsClause,
  qid,
  rel,
  routineSig,
  splitOption,
} from "./render.ts";

export interface ActionSpec {
  sql: string;
  /** extra consumed ids beyond the fact's parent (which is implicit) */
  consumes?: StableId[];
  /** additional fact ids this statement produces (delta-set inlining) */
  alsoProduces?: StableId[];
  /** ids this statement implicitly destroys even though no drop action
   *  exists for them (e.g. DROP IDENTITY removes the backing sequence) */
  alsoDestroys?: StableId[];
  /** ids this statement stops referencing (e.g. the OLD owner of an
   *  ALTER … OWNER TO) — the action must run before their destroyer */
  releases?: StableId[];
  dataLoss?: "none" | "destructive";
  rewriteRisk?: boolean;
  /** lock-class override for this specific DDL form (defaults come from
   *  the vetted (kind, verb) table in locks.ts) */
  lockClass?: LockClass;
  /** three-valued transactionality (§3.8). Default: "transactional".
   *  - nonTransactional: cannot run inside a transaction block at all
   *    (CREATE INDEX CONCURRENTLY, DROP SUBSCRIPTION with a slot)
   *  - commitBoundaryAfter: runs in a transaction but its effect is not
   *    usable before commit (ALTER TYPE … ADD VALUE) — the executor forces
   *    a segment boundary before any consumer of what it touched */
  transactionality?:
    | "transactional"
    | "nonTransactional"
    | "commitBoundaryAfter";
  /** compaction (§3.6): this statement is a clause that may fold into the
   *  CREATE of `foldInto` when no graph edge crosses the merge */
  compaction?: { foldInto: StableId; clause: string };
  /** this CREATE accepts column-clause folds (bare CREATE TABLE only) */
  acceptsColumnFolds?: boolean;
}

/** Named serialize parameters the rule table consumes. Policies (stage 8)
 *  set them; referencing an unknown name is a plan-time error, not a
 *  silent no-op. */
export const KNOWN_PARAMS: ReadonlySet<string> = new Set([
  "concurrentIndexes",
  // CREATE SCHEMA without AUTHORIZATION (platform roles a non-superuser
  // applier cannot impersonate)
  "skipAuthorization",
]);
export type PlanParams = Record<string, unknown>;

export type AttributeRule =
  | {
      alter: (
        fact: Fact,
        from: PayloadValue,
        to: PayloadValue,
        view: FactView,
        sourceView: FactView,
      ) => ActionSpec | ActionSpec[];
      /** When this transition force-rebuilds surviving dependents (drop +
       *  recreate around the alter):
       *   - `true`  → every rebuildable dependent (enum value-set migration:
       *     views/defaults/routines must be out of the way)
       *   - `string[]` → only dependents of these kinds (ALTER COLUMN TYPE is
       *     blocked by views/rules/policies but NOT indexes/constraints,
       *     which PostgreSQL rebuilds itself — force-dropping a PK with
       *     dependent FKs would cascade harmfully)
       *   - `false`/absent → none */
      rebuildsDependents?: (
        from: PayloadValue,
        to: PayloadValue,
      ) => boolean | readonly string[];
    }
  | "replace";

/** Read-only view over the desired state, for rules that inline children. */
export interface FactView {
  childrenOf(id: StableId): Fact[];
  facts(): Fact[];
  get(id: StableId): Fact | undefined;
  readonly edges: readonly { from: StableId; to: StableId }[];
}

export interface KindRules {
  create(fact: Fact, view: FactView, params?: PlanParams): ActionSpec[];
  drop(fact: Fact): ActionSpec;
  /** rename support (stage 9): render the in-place rename from the old
   *  fact to the new id. Kinds without this member never become rename
   *  candidates (their changes stay drop+create). */
  rename?: (fact: Fact, to: StableId) => ActionSpec;
  attributes: Record<string, AttributeRule>;
  /** kind weight for deterministic tie-breaking (pg_dump-inspired) */
  weight: number;

  // ── graph/suppression policy (guardrail 3: per-kind knowledge lives
  //    HERE, never in the planner body) ──────────────────────────────────
  /** this fact vanishes with its parent regardless of the parent's kind
   *  (comment, acl) — a metadata satellite */
  metadata?: boolean;
  /** a DROP of this kind cascades to its children in PostgreSQL, so child
   *  drops fold into it (table, view, type, …). schema/role do NOT cascade. */
  cascadesToChildren?: boolean;
  /** a surviving dependent of a destroyed fact of this kind is force-
   *  rebuilt (drop + recreate from the desired state) */
  rebuildable?: boolean;
  /** whether a fact of this kind MAY be folded into a parent's cascading
   *  drop. Default true. FK constraints return false: an explicit
   *  DROP CONSTRAINT first makes mutual-FK teardown cycles unconstructible. */
  suppressible?: (fact: Fact) => boolean;
  /** redirect this fact's drop to fold into a NON-parent ancestor's drop
   *  when that ancestor is being removed (an OWNED BY sequence folds into
   *  its owning column/table, which is not its catalog parent). */
  dropRootRedirect?: (
    fact: Fact,
    isRemoved: (id: StableId) => boolean,
  ) => StableId | undefined;
  /** pg_default_acl objtype char for the default-privilege hygiene pass
   *  (table/view/matview/foreignTable → 'r', sequence → 'S',
   *  procedure/aggregate → 'f'); absent for kinds with no default ACLs */
  defaclObjtype?: string;
}

/** Most renames are `<ALTER prefix> RENAME TO <new name>`. */
function renameRule(
  alterPrefix: (fact: Fact) => string,
): (fact: Fact, to: StableId) => ActionSpec {
  return (fact, to) => ({
    sql: `${alterPrefix(fact)} RENAME TO ${qid((to as { name: string }).name)}`,
  });
}

const str = (v: PayloadValue): string => {
  if (v === null || v === undefined || typeof v === "object") {
    throw new Error(
      `rule rendering: expected a scalar, got ${JSON.stringify(v)}`,
    );
  }
  return String(v);
};

function p(fact: Fact, key: string): PayloadValue {
  return fact.payload[key];
}

/** true when `partial` appears in `full` in order (possibly with gaps) */
function isSubsequence(partial: string[], full: string[]): boolean {
  let i = 0;
  for (const value of full) {
    if (i < partial.length && value === partial[i]) i++;
  }
  return i === partial.length;
}

/** Role attribute keyword map (CREATE ROLE / ALTER ROLE flags). */
const ROLE_FLAGS: Record<string, [on: string, off: string]> = {
  superuser: ["SUPERUSER", "NOSUPERUSER"],
  inherit: ["INHERIT", "NOINHERIT"],
  createRole: ["CREATEROLE", "NOCREATEROLE"],
  createDb: ["CREATEDB", "NOCREATEDB"],
  login: ["LOGIN", "NOLOGIN"],
  replication: ["REPLICATION", "NOREPLICATION"],
  bypassRls: ["BYPASSRLS", "NOBYPASSRLS"],
};

function roleFlagSql(payload: Fact["payload"]): string {
  return Object.entries(ROLE_FLAGS)
    .map(([key, [on, off]]) => (payload[key] ? on : off))
    .join(" ");
}

function ownerRule(alterPrefix: (fact: Fact) => string): AttributeRule {
  return {
    alter: (fact, from, to) => ({
      sql: `${alterPrefix(fact)} OWNER TO ${qid(str(to))}`,
      consumes: [{ kind: "role", name: str(to) }],
      ...(from == null
        ? {}
        : { releases: [{ kind: "role", name: str(from) } as StableId] }),
    }),
  };
}

/** Identity payload: { generation: 'a'|'d', sequence: {schema,name} } | null.
 *  The backing sequence rides along so identity transitions can declare the
 *  physical sequence they implicitly create/destroy. */
interface IdentityPayload {
  generation: string;
  sequence: { schema: string; name: string } | null;
}

function identityGeneration(value: PayloadValue): string | null {
  if (value == null) return null;
  return (value as unknown as IdentityPayload).generation;
}

function identitySequenceId(value: PayloadValue): StableId | null {
  if (value == null) return null;
  const sequence = (value as unknown as IdentityPayload).sequence;
  if (sequence == null) return null;
  return { kind: "sequence", schema: sequence.schema, name: sequence.name };
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
  if (generation === "a") sql += ` GENERATED ALWAYS AS IDENTITY`;
  if (generation === "d") sql += ` GENERATED BY DEFAULT AS IDENTITY`;
  if (p(fact, "notNull")) sql += ` NOT NULL`;
  return sql;
}

const POLICY_CMD: Record<string, string> = {
  r: "SELECT",
  a: "INSERT",
  w: "UPDATE",
  d: "DELETE",
  "*": "ALL",
};

function policySql(fact: Fact): string {
  const id = fact.id as { schema: string; table: string; name: string };
  const roles = (p(fact, "roles") as string[]).map((r) =>
    r === "PUBLIC" ? "PUBLIC" : qid(r),
  );
  let sql = `CREATE POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
  if (!p(fact, "permissive")) sql += ` AS RESTRICTIVE`;
  sql += ` FOR ${POLICY_CMD[str(p(fact, "cmd"))] ?? "ALL"}`;
  sql += ` TO ${roles.join(", ")}`;
  const using = p(fact, "usingExpr");
  if (using != null) sql += ` USING (${str(using)})`;
  const check = p(fact, "checkExpr");
  if (check != null) sql += ` WITH CHECK (${str(check)})`;
  return sql;
}

/**
 * OWNED BY is rendered as a follow-up statement (pg_dump's model): an auto
 * edge sequence→column would cycle with the column default that references
 * the sequence.
 */
function sequenceOwnedBySpecs(
  fact: Fact,
  opts: { allowNone?: boolean } = {},
): ActionSpec[] {
  const id = fact.id as { schema: string; name: string };
  const ownedBy = p(fact, "ownedBy") as {
    schema: string;
    table: string;
    column: string;
  } | null;
  if (ownedBy == null) {
    return opts.allowNone
      ? [{ sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} OWNED BY NONE` }]
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
    },
  ];
}

/** Constraints attach to tables OR domains; the parent kind decides. */
function constraintTarget(fact: Fact): string {
  const id = fact.id as { schema: string; table: string };
  const keyword = fact.parent?.kind === "domain" ? "DOMAIN" : "TABLE";
  return `ALTER ${keyword} ${rel(id.schema, id.table)}`;
}

/** A composite type attribute's `name type [COLLATE …]` clause. */
function typeAttributeClause(fact: Fact): string {
  const name = (fact.id as { name: string }).name;
  const collation = p(fact, "collation");
  return `${qid(name)} ${str(p(fact, "type"))}${collation != null ? ` COLLATE ${str(collation)}` : ""}`;
}

/** Table columns that USE a given composite type (via the column→type
 *  dependency edge). ALTER TYPE … ATTRIBUTE … CASCADE rewrites those
 *  tables; referencing the columns lets the proof's rewrite attribution
 *  map the type-scoped action to the tables it actually touches. */
function compositeUserColumns(view: FactView, typeId: StableId): StableId[] {
  const key = encodeId(typeId);
  return view.edges
    .filter((e) => e.from.kind === "column" && encodeId(e.to) === key)
    .map((e) => e.from)
    .filter((id) => view.get(id) !== undefined);
}

/** O/D/R/A enabled-state chars → ALTER … ENABLE/DISABLE phrases. */
function enabledPhrase(state: string): string {
  switch (state) {
    case "D":
      return "DISABLE";
    case "R":
      return "ENABLE REPLICA";
    case "A":
      return "ENABLE ALWAYS";
    default:
      return "ENABLE";
  }
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

function grantActions(fact: Fact, verb: "grant"): ActionSpec[] {
  const id = fact.id as { kind: "acl"; target: StableId; grantee: string };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const privileges = p(fact, "privileges") as string[];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes: StableId[] =
    id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
  const specs: ActionSpec[] = [
    // pg_dump's model: reset to a clean slate first — implicit default-
    // privilege grants on freshly created objects would otherwise linger
    {
      sql: `REVOKE ALL ON ${grantTarget(id.target)} FROM ${grantee}`,
      consumes,
    },
  ];
  if (plain.length > 0) {
    specs.push({
      sql: `GRANT ${plain.join(", ")} ON ${grantTarget(id.target)} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `GRANT ${withOption.join(", ")} ON ${grantTarget(id.target)} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  void verb;
  return specs;
}

/** Aggregate signature: direct args [ORDER BY ordered args]; '*' when none. */
function aggSig(fact: Fact): string {
  const args = (fact.id as { args: string[] }).args;
  const aggKind = str(p(fact, "aggKind") ?? "n");
  if (aggKind === "o" || aggKind === "h") {
    const direct = Number(p(fact, "numDirectArgs") ?? 0);
    return `${args.slice(0, direct).join(", ")} ORDER BY ${args.slice(direct).join(", ")}`;
  }
  return args.length > 0 ? args.join(", ") : "*";
}

const DEFACL_OBJTYPE: Record<string, string> = {
  r: "TABLES",
  S: "SEQUENCES",
  f: "FUNCTIONS",
  T: "TYPES",
  n: "SCHEMAS",
};

function defaultPrivPrefix(id: {
  role: string;
  schema: string | null;
}): string {
  let sql = `ALTER DEFAULT PRIVILEGES FOR ROLE ${qid(id.role)}`;
  if (id.schema != null) sql += ` IN SCHEMA ${qid(id.schema)}`;
  return sql;
}

function defaultPrivConsumes(id: {
  role: string;
  schema: string | null;
  grantee: string;
}): StableId[] {
  const consumes: StableId[] = [{ kind: "role", name: id.role }];
  if (id.grantee !== "PUBLIC")
    consumes.push({ kind: "role", name: id.grantee });
  if (id.schema != null) consumes.push({ kind: "schema", name: id.schema });
  return consumes;
}

function defaultPrivilegeActions(fact: Fact, verb: "GRANT"): ActionSpec[] {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = DEFACL_OBJTYPE[id.objtype] ?? "TABLES";
  const privileges = (p(fact, "privileges") as string[]) ?? [];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes = defaultPrivConsumes(id);
  const specs: ActionSpec[] = [];
  if (plain.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} ${verb} ${plain.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} ${verb} ${withOption.join(", ")} ON ${objtype} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  return specs;
}

/** The `TABLE rel [(cols)] [WHERE (…)]` clause for a publicationRel fact. */
function publicationRelClause(fact: Fact): string {
  const id = fact.id as { schema: string; table: string };
  let clause = `TABLE ${rel(id.schema, id.table)}`;
  const cols = p(fact, "columns") as string[] | null;
  if (cols != null && cols.length > 0) {
    clause += ` (${cols.map((c) => qid(c)).join(", ")})`;
  }
  const where = p(fact, "where");
  if (where != null) clause += ` WHERE (${str(where)})`;
  return clause;
}

/** Inlined FOR-clause object list for a fresh publication, gathered from its
 *  publicationRel / publicationSchema children, with the ids consumed and
 *  the child facts produced (delta-set inlining). */
function publicationObjects(
  fact: Fact,
  view: FactView,
): { clauses: string[]; consumes: StableId[]; produced: StableId[] } {
  const clauses: string[] = [];
  const consumes: StableId[] = [];
  const produced: StableId[] = [];
  for (const child of view.childrenOf(fact.id)) {
    if (child.id.kind === "publicationRel") {
      const cid = child.id as { schema: string; table: string };
      clauses.push(publicationRelClause(child));
      consumes.push({ kind: "table", schema: cid.schema, name: cid.table });
      produced.push(child.id);
    } else if (child.id.kind === "publicationSchema") {
      const cid = child.id as { schema: string };
      clauses.push(`TABLES IN SCHEMA ${qid(cid.schema)}`);
      consumes.push({ kind: "schema", name: cid.schema });
      produced.push(child.id);
    }
  }
  return { clauses, consumes, produced };
}

export const RULES: Record<string, KindRules> = {
  role: {
    weight: 0,
    rename: renameRule(
      (fact) => `ALTER ROLE ${qid((fact.id as { name: string }).name)}`,
    ),
    create: (fact) => [
      {
        sql: `CREATE ROLE ${qid((fact.id as { name: string }).name)} WITH ${roleFlagSql(fact.payload)}`,
      },
    ],
    drop: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      // DROP OWNED clears residual default privileges / grants in this
      // database; every wanted reassignment has already run (releases edges)
      return { sql: `DROP OWNED BY ${name}; DROP ROLE ${name}` };
    },
    attributes: {
      ...Object.fromEntries(
        Object.entries(ROLE_FLAGS).map(([key, [on, off]]) => [
          key,
          {
            alter: (fact: Fact, _from: PayloadValue, to: PayloadValue) => ({
              sql: `ALTER ROLE ${qid((fact.id as { name: string }).name)} WITH ${to ? on : off}`,
            }),
          },
        ]),
      ),
      config: {
        alter: (fact, from, to) => {
          const role = qid((fact.id as { name: string }).name);
          const oldCfg = new Map(
            ((from as string[] | null) ?? []).map(splitOption),
          );
          const newCfg = new Map(
            ((to as string[] | null) ?? []).map(splitOption),
          );
          const specs: ActionSpec[] = [];
          for (const [key] of oldCfg) {
            if (!newCfg.has(key)) {
              specs.push({ sql: `ALTER ROLE ${role} RESET ${qid(key)}` });
            }
          }
          for (const [key, value] of newCfg) {
            if (oldCfg.get(key) !== value) {
              specs.push({
                sql: `ALTER ROLE ${role} SET ${qid(key)} TO ${lit(value)}`,
              });
            }
          }
          return specs;
        },
      },
    },
  },

  schema: {
    weight: 1,
    rename: renameRule(
      (fact) => `ALTER SCHEMA ${qid((fact.id as { name: string }).name)}`,
    ),
    create: (fact, _view, params) => [
      params?.["skipAuthorization"] === true
        ? { sql: `CREATE SCHEMA ${qid((fact.id as { name: string }).name)}` }
        : {
            sql: `CREATE SCHEMA ${qid((fact.id as { name: string }).name)} AUTHORIZATION ${qid(str(p(fact, "owner")))}`,
            consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
          },
    ],
    drop: (fact) => ({
      sql: `DROP SCHEMA ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      owner: ownerRule(
        (fact) => `ALTER SCHEMA ${qid((fact.id as { name: string }).name)}`,
      ),
    },
  },

  extension: {
    weight: 2,
    // The SCHEMA clause is derived from the extension's `relocatable` fact
    // (pg_extension.extrelocatable), not a serialize param: a relocatable
    // extension honours `SCHEMA <s>` and must be ordered after that schema; a
    // non-relocatable extension creates its own schema, so it emits a bare
    // CREATE EXTENSION and requires no schema. See docs/managed-view-architecture.md.
    create: (fact) => [
      p(fact, "relocatable") === true
        ? {
            sql: `CREATE EXTENSION ${qid((fact.id as { name: string }).name)} SCHEMA ${qid(str(p(fact, "schema")))}`,
            consumes: [{ kind: "schema", name: str(p(fact, "schema")) }],
          }
        : {
            sql: `CREATE EXTENSION ${qid((fact.id as { name: string }).name)}`,
          },
    ],
    drop: (fact) => ({
      sql: `DROP EXTENSION ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      schema: {
        alter: (fact, _from, to) => ({
          sql: `ALTER EXTENSION ${qid((fact.id as { name: string }).name)} SET SCHEMA ${qid(str(to))}`,
          consumes: [{ kind: "schema", name: str(to) }],
        }),
      },
    },
  },

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
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
        ...sequenceOwnedBySpecs(fact),
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP SEQUENCE ${rel(id.schema, id.name)}` };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER SEQUENCE ${rel(id.schema, id.name)}`;
      }),
      dataType: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} AS ${str(to)}`,
          };
        },
      },
      increment: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} INCREMENT BY ${str(to)}`,
          };
        },
      },
      minValue: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} MINVALUE ${str(to)}`,
          };
        },
      },
      maxValue: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} MAXVALUE ${str(to)}`,
          };
        },
      },
      start: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} START WITH ${str(to)}`,
          };
        },
      },
      cache: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} CACHE ${str(to)}`,
          };
        },
      },
      cycle: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} ${to ? "CYCLE" : "NO CYCLE"}`,
          };
        },
      },
      ownedBy: {
        alter: (fact) => sequenceOwnedBySpecs(fact, { allowNone: true }),
      },
    },
  },

  table: {
    weight: 4,
    cascadesToChildren: true,
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
      const consumes: StableId[] = [
        { kind: "role", name: str(p(fact, "owner")) },
      ];
      const alsoProduces: StableId[] = [];
      if (bound != null && parentT != null) {
        // a partition: columns are inherited, the bound carries the shape
        createSql = `CREATE ${unlogged}TABLE ${relName} PARTITION OF ${rel(parentT.schema, parentT.name)} ${str(bound)}`;
        consumes.push({
          kind: "table",
          schema: parentT.schema,
          name: parentT.name,
        });
      } else {
        // partitioned parents must inline their columns: the partition key
        // references them, so decomposed ADD COLUMN cannot work (§3.4
        // delta-set inlining). The statement produces the column facts too.
        let cols = "";
        if (partKey != null) {
          const colFacts = view
            .childrenOf(fact.id)
            .filter((c) => c.id.kind === "column");
          cols = colFacts.map(columnClause).join(", ");
          for (const c of colFacts) alsoProduces.push(c.id);
        }
        createSql = `CREATE ${unlogged}TABLE ${relName} (${cols})`;
        if (parentT != null) {
          createSql += ` INHERITS (${rel(parentT.schema, parentT.name)})`;
          consumes.push({
            kind: "table",
            schema: parentT.schema,
            name: parentT.name,
          });
        }
        if (partKey != null) createSql += ` PARTITION BY ${str(partKey)}`;
      }

      // only the bare shape (no partition machinery, no INHERITS suffix)
      // can absorb folded column clauses without SQL surgery ambiguity
      const foldable = bound == null && partKey == null && parentT == null;
      const specs: ActionSpec[] = [
        {
          sql: createSql,
          consumes,
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
      specs.push({
        sql: `ALTER TABLE ${relName} OWNER TO ${qid(str(p(fact, "owner")))}`,
        consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
      });
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return {
        sql: `DROP TABLE ${rel(id.schema, id.name)}`,
        dataLoss: "destructive",
      };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER TABLE ${rel(id.schema, id.name)}`;
      }),
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
      partitionKey: "replace",
      partitionBound: "replace",
      parentTable: "replace",
    },
  },

  column: {
    weight: 5,
    cascadesToChildren: true,
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
      // row: a STORED generated column always, or an inline DEFAULT whose
      // expression may be volatile (nextval, now, …). We cannot tell a
      // constant default from a volatile one without parsing (guardrail 2),
      // so any inline default conservatively declares rewriteRisk — over-
      // declaring is safe (the proof only fails on UNDER-declared rewrites).
      const rewrites =
        fact.payload["generatedExpr"] != null || defaultChild !== undefined;
      const spec: ActionSpec = {
        sql: `ALTER TABLE ${rel(schema, table)} ADD COLUMN ${clause}`,
        alsoProduces,
        ...(rewrites ? { rewriteRisk: true } : {}),
      };
      if (fact.parent !== undefined && fact.parent.kind === "table") {
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
        // the change is sandwiched DROP DEFAULT → TYPE … USING → SET DEFAULT
        alter: (fact, _from, to, view) => {
          const { schema, table, column } = columnRef(fact);
          const target = `ALTER TABLE ${rel(schema, table)} ALTER COLUMN ${qid(column)}`;
          const specs: ActionSpec[] = [
            { sql: `${target} DROP DEFAULT` },
            {
              sql: `${target} TYPE ${str(to)} USING ${qid(column)}::${str(to)}`,
              rewriteRisk: true,
            },
          ];
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
        alter: (fact, from, to) => {
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
          if (from == null) {
            // ADD IDENTITY materializes the backing sequence; declaring it
            // orders this after a DROP SEQUENCE freeing the name
            return {
              sql: `${target} ADD ${phrase} AS IDENTITY`,
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

  procedure: {
    weight: 8,
    cascadesToChildren: true,
    rebuildable: true,
    defaclObjtype: "f",
    rename: (fact, to) => ({
      sql: `ALTER ROUTINE ${routineSig(fact.id as { schema: string; name: string; args: string[] })} RENAME TO ${qid((to as { name: string }).name)}`,
    }),
    create: (fact) => [
      {
        sql: str(p(fact, "def")),
        consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
      },
    ],
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      const keyword =
        str(p(fact, "routineKind")) === "p" ? "PROCEDURE" : "FUNCTION";
      return { sql: `DROP ${keyword} ${routineSig(id)}` };
    },
    attributes: {
      // return-type/strictness changes refuse CREATE OR REPLACE; replace +
      // forced dependent rebuild is always safe
      def: "replace",
      owner: {
        alter: (fact, _from, to) => {
          const id = fact.id as {
            schema: string;
            name: string;
            args: string[];
          };
          const keyword =
            str(p(fact, "routineKind")) === "p" ? "PROCEDURE" : "FUNCTION";
          return {
            sql: `ALTER ${keyword} ${routineSig(id)} OWNER TO ${qid(str(to))}`,
            consumes: [{ kind: "role", name: str(to) }],
          };
        },
      },
      routineKind: "replace",
    },
  },

  constraint: {
    weight: 10,
    cascadesToChildren: true,
    rebuildable: true,
    suppressible: (fact) => fact.payload["type"] !== "f",
    rename: (fact, to) => {
      const id = fact.id as { name: string };
      return {
        sql: `${constraintTarget(fact)} RENAME CONSTRAINT ${qid(id.name)} TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      const target = constraintTarget(fact);
      let sql = `${target} ADD CONSTRAINT ${qid(id.name)} ${str(p(fact, "def"))}`;
      if (!p(fact, "validated") && !str(p(fact, "def")).includes("NOT VALID")) {
        sql += " NOT VALID";
      }
      // ADD FOREIGN KEY takes SHARE ROW EXCLUSIVE (both tables), weaker
      // than the ACCESS EXCLUSIVE default for other constraint forms
      return [
        {
          sql,
          ...(p(fact, "type") === "f"
            ? { lockClass: "shareRowExclusive" as const }
            : {}),
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `${constraintTarget(fact)} DROP CONSTRAINT ${qid(id.name)}`,
      };
    },
    attributes: {
      def: "replace",
      type: "replace",
      validated: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          if (!to)
            throw new Error("constraint cannot be de-validated in place");
          return {
            sql: `${constraintTarget(fact)} VALIDATE CONSTRAINT ${qid(id.name)}`,
            lockClass: "shareUpdateExclusive",
          };
        },
      },
    },
  },

  view: {
    weight: 12,
    cascadesToChildren: true,
    rebuildable: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER VIEW ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      const specs: ActionSpec[] = [
        {
          sql: `CREATE VIEW ${rel(id.schema, id.name)} AS ${str(p(fact, "def"))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
        {
          sql: `ALTER VIEW ${rel(id.schema, id.name)} OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP VIEW ${rel(id.schema, id.name)}` };
    },
    attributes: {
      def: "replace",
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER VIEW ${rel(id.schema, id.name)}`;
      }),
    },
  },

  materializedView: {
    weight: 13,
    cascadesToChildren: true,
    rebuildable: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql: `CREATE MATERIALIZED VIEW ${rel(id.schema, id.name)} AS ${str(p(fact, "def"))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
        {
          sql: `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)} OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return {
        sql: `DROP MATERIALIZED VIEW ${rel(id.schema, id.name)}`,
        dataLoss: "destructive",
      };
    },
    attributes: {
      def: "replace",
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
      }),
    },
  },

  index: {
    weight: 14,
    cascadesToChildren: true,
    rebuildable: true,
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER INDEX ${rel(id.schema, id.name)}`;
    }),
    create: (fact, _view, params) => {
      const def = str(p(fact, "def"));
      if (params?.["concurrentIndexes"] === true) {
        // pg_get_indexdef never includes CONCURRENTLY (an execution choice,
        // not state); splice it into the canonical def
        return [
          {
            sql: def.replace(
              /^CREATE (UNIQUE )?INDEX /,
              "CREATE $1INDEX CONCURRENTLY ",
            ),
            lockClass: "shareUpdateExclusive",
            transactionality: "nonTransactional",
          },
        ];
      }
      return [{ sql: def }];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP INDEX ${rel(id.schema, id.name)}` };
    },
    attributes: { def: "replace" },
  },

  trigger: {
    weight: 15,
    cascadesToChildren: true,
    rebuildable: true,
    rename: (fact, to) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `ALTER TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)} RENAME TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      const specs: ActionSpec[] = [{ sql: str(p(fact, "def")) }];
      const enabled = p(fact, "enabled");
      if (enabled != null && enabled !== "O") {
        specs.push({
          sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(enabled))} TRIGGER ${qid(id.name)}`,
        });
      }
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      def: "replace",
      enabled: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(to))} TRIGGER ${qid(id.name)}`,
          };
        },
      },
    },
  },

  policy: {
    weight: 16,
    cascadesToChildren: true,
    rebuildable: true,
    rename: (fact, to) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} RENAME TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const roles = (p(fact, "roles") as string[])
        .filter((r) => r !== "PUBLIC")
        .map((r): StableId => ({ kind: "role", name: r }));
      return [{ sql: policySql(fact), consumes: roles }];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      usingExpr: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} USING (${str(to)})`,
          };
        },
      },
      checkExpr: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} WITH CHECK (${str(to)})`,
          };
        },
      },
      roles: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          const roles = (to as string[]).map((r) =>
            r === "PUBLIC" ? "PUBLIC" : qid(r),
          );
          return {
            sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} TO ${roles.join(", ")}`,
          };
        },
      },
      cmd: "replace",
      permissive: "replace",
    },
  },

  comment: {
    weight: 20,
    metadata: true,
    create: (fact) => {
      const target = (fact.id as { target: StableId }).target;
      return [
        {
          sql: `COMMENT ON ${commentTarget(target)} IS ${lit(str(p(fact, "text")))}`,
        },
      ];
    },
    drop: (fact) => {
      const target = (fact.id as { target: StableId }).target;
      return { sql: `COMMENT ON ${commentTarget(target)} IS NULL` };
    },
    attributes: {
      text: {
        alter: (fact, _from, to) => {
          const target = (fact.id as { target: StableId }).target;
          return {
            sql: `COMMENT ON ${commentTarget(target)} IS ${lit(str(to))}`,
          };
        },
      },
    },
  },

  // a global satellite rule (like comment): SECURITY LABEL shares COMMENT's
  // ON-target grammar, so it reuses commentTarget. The provider lives in
  // the fact id; the label text is the payload.
  securityLabel: {
    weight: 20,
    metadata: true,
    create: (fact) => {
      const id = fact.id as { target: StableId; provider: string };
      return [
        {
          sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS ${lit(str(p(fact, "label")))}`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { target: StableId; provider: string };
      return {
        sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS NULL`,
      };
    },
    attributes: {
      label: {
        alter: (fact, _from, to) => {
          const id = fact.id as { target: StableId; provider: string };
          return {
            sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS ${lit(str(to))}`,
          };
        },
      },
    },
  },

  domain: {
    weight: 7,
    cascadesToChildren: true,
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER DOMAIN ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      let sql = `CREATE DOMAIN ${rel(id.schema, id.name)} AS ${str(p(fact, "baseType"))}`;
      const collation = p(fact, "collation");
      if (collation != null) sql += ` COLLATE ${str(collation)}`;
      const def = p(fact, "default");
      if (def != null) sql += ` DEFAULT ${str(def)}`;
      if (p(fact, "notNull")) sql += ` NOT NULL`;
      return [
        { sql, consumes: [{ kind: "role", name: str(p(fact, "owner")) }] },
        {
          sql: `ALTER DOMAIN ${rel(id.schema, id.name)} OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP DOMAIN ${rel(id.schema, id.name)}` };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER DOMAIN ${rel(id.schema, id.name)}`;
      }),
      default: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql:
              to == null
                ? `ALTER DOMAIN ${rel(id.schema, id.name)} DROP DEFAULT`
                : `ALTER DOMAIN ${rel(id.schema, id.name)} SET DEFAULT ${str(to)}`,
          };
        },
      },
      notNull: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER DOMAIN ${rel(id.schema, id.name)} ${to ? "SET" : "DROP"} NOT NULL`,
          };
        },
      },
      baseType: "replace",
      collation: "replace",
    },
  },

  type: {
    weight: 7,
    cascadesToChildren: true,
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER TYPE ${rel(id.schema, id.name)}`;
    }),
    create: (fact, view) => {
      const id = fact.id as { schema: string; name: string };
      const relName = rel(id.schema, id.name);
      const variant = str(p(fact, "variant"));
      let sql: string;
      const alsoProduces: StableId[] = [];
      if (variant === "enum") {
        const values = (p(fact, "values") as string[]).map((v) => lit(v));
        sql = `CREATE TYPE ${relName} AS ENUM (${values.join(", ")})`;
      } else if (variant === "composite") {
        // attributes are sub-facts (granularity is one): inline them on the
        // fresh CREATE (delta-set, like partitioned-table columns) and
        // register them as produced so their standalone creates are skipped
        const attrFacts = view
          .childrenOf(fact.id)
          .filter((c) => c.id.kind === "typeAttribute");
        const attrs = attrFacts.map((a) => typeAttributeClause(a));
        for (const a of attrFacts) alsoProduces.push(a.id);
        sql = `CREATE TYPE ${relName} AS (${attrs.join(", ")})`;
      } else {
        const parts = [`SUBTYPE = ${str(p(fact, "subtype"))}`];
        const collation = p(fact, "collation");
        if (collation != null) parts.push(`COLLATION = ${str(collation)}`);
        const diff = p(fact, "subtypeDiff");
        if (diff != null) parts.push(`SUBTYPE_DIFF = ${str(diff)}`);
        sql = `CREATE TYPE ${relName} AS RANGE (${parts.join(", ")})`;
      }
      return [
        {
          sql,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
          ...(alsoProduces.length > 0 ? { alsoProduces } : {}),
        },
        {
          sql: `ALTER TYPE ${relName} OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP TYPE ${rel(id.schema, id.name)}` };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER TYPE ${rel(id.schema, id.name)}`;
      }),
      values: {
        alter: (fact, from, to, view, sourceView) => {
          const id = fact.id as { schema: string; name: string };
          const relName = rel(id.schema, id.name);
          const oldValues = (from as string[] | null) ?? [];
          const newValues = (to as string[] | null) ?? [];
          if (isSubsequence(oldValues, newValues)) {
            // pure growth: each missing value becomes ADD VALUE BEFORE/AFTER
            const specs: ActionSpec[] = [];
            let oldIdx = 0;
            for (let j = 0; j < newValues.length; j++) {
              const value = newValues[j] as string;
              if (oldIdx < oldValues.length && value === oldValues[oldIdx]) {
                oldIdx++;
                continue;
              }
              const anchor =
                oldIdx < oldValues.length
                  ? `BEFORE ${lit(oldValues[oldIdx] as string)}`
                  : j > 0
                    ? `AFTER ${lit(newValues[j - 1] as string)}`
                    : oldValues.length > 0
                      ? `BEFORE ${lit(oldValues[0] as string)}`
                      : "";
              specs.push({
                sql: `ALTER TYPE ${relName} ADD VALUE ${lit(value)}${anchor ? ` ${anchor}` : ""}`,
                // the new value is unusable before COMMIT: the executor
                // must place a segment boundary before any consumer (§3.8)
                transactionality: "commitBoundaryAfter",
              });
            }
            return specs;
          }
          // removal/reorder: rename aside, create the desired value set, walk
          // every column of this type through a text cast, drop the old type.
          // rebuildsDependents has already forced views/defaults/routines
          // that reference the type out of the way.
          // a deterministic temp name that cannot collide with an existing
          // type in the schema (bump a counter past any occupant)
          const taken = (n: string): boolean =>
            view.get({
              kind: "type",
              schema: id.schema,
              name: n,
            } as StableId) !== undefined ||
            sourceView.get({
              kind: "type",
              schema: id.schema,
              name: n,
            } as StableId) !== undefined;
          let tmp = `${id.name}__pgdelta_replaced`;
          for (let n = 2; taken(tmp); n++)
            tmp = `${id.name}__pgdelta_replaced_${n}`;
          const enumKey = encodeId(fact.id);
          const specs: ActionSpec[] = [
            { sql: `ALTER TYPE ${relName} RENAME TO ${qid(tmp)}` },
            {
              sql: `CREATE TYPE ${relName} AS ENUM (${newValues.map((v) => lit(v)).join(", ")})`,
            },
          ];
          const dependentColumns = view.edges
            .filter(
              (e) =>
                e.from.kind === "column" &&
                encodeId(e.to) === enumKey &&
                view.get(e.from) !== undefined &&
                // a column that exists only in the DESIRED state is being
                // created by this same plan (already with the new type) —
                // there is nothing to migrate
                sourceView.get(e.from) !== undefined,
            )
            .map(
              (e) =>
                e.from as {
                  kind: "column";
                  schema: string;
                  table: string;
                  name: string;
                },
            )
            .sort((a, b) =>
              `${a.schema}.${a.table}.${a.name}` <
              `${b.schema}.${b.table}.${b.name}`
                ? -1
                : 1,
            );
          for (const col of dependentColumns) {
            specs.push({
              sql: `ALTER TABLE ${rel(col.schema, col.table)} ALTER COLUMN ${qid(col.name)} TYPE ${relName} USING ${qid(col.name)}::text::${relName}`,
              // reference the rewritten column so the proof's rewrite
              // attribution maps this action to its table (the action's
              // primary subject is the type, not the table it rewrites)
              consumes: [col],
              dataLoss: "destructive",
              rewriteRisk: true,
            });
          }
          specs.push({ sql: `DROP TYPE ${rel(id.schema, tmp)}` });
          return specs;
        },
        rebuildsDependents: (from, to) =>
          !isSubsequence(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          ),
      },
      subtype: "replace",
      subtypeDiff: "replace",
      collation: "replace",
      variant: "replace",
    },
  },

  // composite-type attributes as sub-entity facts (granularity is one).
  // On a fresh type they inline into CREATE TYPE (delta-set, see the type
  // rule). On an existing type: ADD / DROP / RENAME ATTRIBUTE … CASCADE all
  // work even while the type is used in table columns and preserve the
  // stored data (verified). ALTER ATTRIBUTE … TYPE is the lone exception —
  // PostgreSQL forbids it while a column uses the type (CASCADE only reaches
  // typed tables, not columns), so it is supported only for unused
  // composites and fails loudly otherwise.
  typeAttribute: {
    weight: 7,
    create: (fact) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return [
        {
          sql: `ALTER TYPE ${rel(id.schema, id.type)} ADD ATTRIBUTE ${typeAttributeClause(fact)} CASCADE`,
          consumes: [{ kind: "type", schema: id.schema, name: id.type }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return {
        sql: `ALTER TYPE ${rel(id.schema, id.type)} DROP ATTRIBUTE ${qid(id.name)} CASCADE`,
      };
    },
    rename: (fact, to) => {
      const id = fact.id as { schema: string; type: string; name: string };
      return {
        sql: `ALTER TYPE ${rel(id.schema, id.type)} RENAME ATTRIBUTE ${qid(id.name)} TO ${qid((to as { name: string }).name)} CASCADE`,
      };
    },
    attributes: {
      type: {
        alter: (fact, _from, to, view) => {
          const id = fact.id as { schema: string; type: string; name: string };
          const typeId: StableId = {
            kind: "type",
            schema: id.schema,
            name: id.type,
          };
          if (compositeUserColumns(view, typeId).length > 0) {
            throw new Error(
              `composite type ${rel(id.schema, id.type)}: cannot change attribute "${id.name}" type while the type is used by table columns — PostgreSQL forbids ALTER ATTRIBUTE … TYPE on an in-use composite. Drop the using columns, or recreate the type, first.`,
            );
          }
          return {
            sql: `ALTER TYPE ${rel(id.schema, id.type)} ALTER ATTRIBUTE ${qid(id.name)} TYPE ${str(to)} CASCADE`,
          };
        },
      },
      // a collation-only change has no in-place form; replace the attribute
      collation: "replace",
    },
  },

  collation: {
    weight: 7,
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      const provider = str(p(fact, "provider"));
      const parts: string[] = [];
      if (provider === "i") {
        parts.push(`PROVIDER = icu`, `LOCALE = ${lit(str(p(fact, "locale")))}`);
        if (!p(fact, "deterministic")) parts.push(`DETERMINISTIC = false`);
      } else if (provider === "b") {
        parts.push(
          `PROVIDER = builtin`,
          `LOCALE = ${lit(str(p(fact, "locale")))}`,
        );
      } else {
        parts.push(
          `LC_COLLATE = ${lit(str(p(fact, "lcCollate")))}`,
          `LC_CTYPE = ${lit(str(p(fact, "lcCtype")))}`,
        );
      }
      return [
        {
          sql: `CREATE COLLATION ${rel(id.schema, id.name)} (${parts.join(", ")})`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP COLLATION ${rel(id.schema, id.name)}` };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER COLLATION ${rel(id.schema, id.name)}`;
      }),
      provider: "replace",
      deterministic: "replace",
      locale: "replace",
      lcCollate: "replace",
      lcCtype: "replace",
    },
  },

  eventTrigger: {
    weight: 17,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      const fnId: StableId = {
        kind: "procedure",
        schema: str(p(fact, "functionSchema")),
        name: str(p(fact, "functionName")),
        args: [],
      };
      let sql = `CREATE EVENT TRIGGER ${name} ON ${str(p(fact, "event"))}`;
      const tags = (p(fact, "tags") as string[]) ?? [];
      if (tags.length > 0) {
        sql += ` WHEN TAG IN (${tags.map((t) => lit(t)).join(", ")})`;
      }
      sql += ` EXECUTE FUNCTION ${rel(str(p(fact, "functionSchema")), str(p(fact, "functionName")))}()`;
      const specs: ActionSpec[] = [
        {
          sql,
          consumes: [fnId, { kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
      const enabled = p(fact, "enabled");
      if (enabled != null && enabled !== "O") {
        specs.push({
          sql: `ALTER EVENT TRIGGER ${name} ${enabledPhrase(str(enabled))}`,
        });
      }
      return specs;
    },
    drop: (fact) => ({
      sql: `DROP EVENT TRIGGER ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      enabled: {
        alter: (fact, _from, to) => ({
          sql: `ALTER EVENT TRIGGER ${qid((fact.id as { name: string }).name)} ${enabledPhrase(str(to))}`,
        }),
      },
      owner: ownerRule(
        (fact) =>
          `ALTER EVENT TRIGGER ${qid((fact.id as { name: string }).name)}`,
      ),
      event: "replace",
      tags: "replace",
      functionSchema: "replace",
      functionName: "replace",
    },
  },

  rule: {
    weight: 15,
    cascadesToChildren: true,
    rebuildable: true,
    create: (fact) => [{ sql: str(p(fact, "def")) }],
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP RULE ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      def: "replace",
      enabled: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(to))} RULE ${qid(id.name)}`,
          };
        },
      },
    },
  },

  aggregate: {
    weight: 9,
    cascadesToChildren: true,
    defaclObjtype: "f",
    create: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      const parts = [
        `SFUNC = ${str(p(fact, "sfunc"))}`,
        `STYPE = ${str(p(fact, "stype"))}`,
      ];
      const finalfunc = p(fact, "finalfunc");
      if (finalfunc != null) parts.push(`FINALFUNC = ${str(finalfunc)}`);
      const initcond = p(fact, "initcond");
      if (initcond != null) parts.push(`INITCOND = ${lit(str(initcond))}`);
      if (str(p(fact, "aggKind")) === "h") parts.push("HYPOTHETICAL");
      return [
        {
          sql: `CREATE AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)}) (${parts.join(", ")})`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
        {
          sql: `ALTER AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)}) OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      return {
        sql: `DROP AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)})`,
      };
    },
    attributes: {
      owner: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)}) OWNER TO ${qid(str(to))}`,
            consumes: [{ kind: "role", name: str(to) }],
          };
        },
      },
      aggKind: "replace",
      numDirectArgs: "replace",
      sfunc: "replace",
      stype: "replace",
      finalfunc: "replace",
      initcond: "replace",
    },
  },

  membership: {
    weight: 1,
    create: (fact) => {
      const id = fact.id as { role: string; member: string };
      return [
        {
          sql: `GRANT ${qid(id.role)} TO ${qid(id.member)}${p(fact, "admin") ? " WITH ADMIN OPTION" : ""}`,
          consumes: [
            { kind: "role", name: id.role },
            { kind: "role", name: id.member },
          ],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { role: string; member: string };
      return {
        sql: `REVOKE ${qid(id.role)} FROM ${qid(id.member)} CASCADE`,
        consumes: [
          { kind: "role", name: id.role },
          { kind: "role", name: id.member },
        ],
      };
    },
    attributes: {
      admin: {
        alter: (fact, _from, to) => {
          const id = fact.id as { role: string; member: string };
          return {
            sql: to
              ? `GRANT ${qid(id.role)} TO ${qid(id.member)} WITH ADMIN OPTION`
              : `REVOKE ADMIN OPTION FOR ${qid(id.role)} FROM ${qid(id.member)}`,
          };
        },
      },
    },
  },

  defaultPrivilege: {
    weight: 22,
    create: (fact) => defaultPrivilegeActions(fact, "GRANT"),
    drop: (fact) => {
      const id = fact.id as {
        role: string;
        schema: string | null;
        objtype: string;
        grantee: string;
      };
      const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
      return {
        sql: `${defaultPrivPrefix(id)} REVOKE ALL ON ${DEFACL_OBJTYPE[id.objtype] ?? "TABLES"} FROM ${grantee}`,
        consumes: defaultPrivConsumes(id),
      };
    },
    attributes: { privileges: "replace", grantable: "replace" },
  },

  fdw: {
    weight: 2,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      let sql = `CREATE FOREIGN DATA WRAPPER ${name}`;
      const handler = p(fact, "handler");
      if (handler != null) sql += ` HANDLER ${str(handler)}`;
      const validator = p(fact, "validator");
      if (validator != null) sql += ` VALIDATOR ${str(validator)}`;
      sql += optionsClause((p(fact, "options") as string[]) ?? []);
      return [
        { sql, consumes: [{ kind: "role", name: str(p(fact, "owner")) }] },
      ];
    },
    drop: (fact) => ({
      sql: `DROP FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      owner: ownerRule(
        (fact) =>
          `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)}`,
      ),
      options: {
        alter: (fact, from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${alterOptionsClause(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          )}`,
        }),
      },
      handler: {
        alter: (fact, _from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${to == null ? "NO HANDLER" : `HANDLER ${str(to)}`}`,
        }),
      },
      validator: {
        alter: (fact, _from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${to == null ? "NO VALIDATOR" : `VALIDATOR ${str(to)}`}`,
        }),
      },
    },
  },

  server: {
    weight: 3,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      let sql = `CREATE SERVER ${name}`;
      const type = p(fact, "type");
      if (type != null) sql += ` TYPE ${lit(str(type))}`;
      const version = p(fact, "version");
      if (version != null) sql += ` VERSION ${lit(str(version))}`;
      sql += ` FOREIGN DATA WRAPPER ${qid(str(p(fact, "fdw")))}`;
      sql += optionsClause((p(fact, "options") as string[]) ?? []);
      return [
        { sql, consumes: [{ kind: "role", name: str(p(fact, "owner")) }] },
      ];
    },
    drop: (fact) => ({
      sql: `DROP SERVER ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      owner: ownerRule(
        (fact) => `ALTER SERVER ${qid((fact.id as { name: string }).name)}`,
      ),
      version: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SERVER ${qid((fact.id as { name: string }).name)} VERSION ${lit(str(to))}`,
        }),
      },
      options: {
        alter: (fact, from, to) => ({
          sql: `ALTER SERVER ${qid((fact.id as { name: string }).name)} ${alterOptionsClause(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          )}`,
        }),
      },
      type: "replace",
      fdw: "replace",
    },
  },

  userMapping: {
    weight: 4,
    create: (fact) => {
      const id = fact.id as { server: string; role: string };
      const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
      return [
        {
          sql: `CREATE USER MAPPING FOR ${roleName} SERVER ${qid(id.server)}${optionsClause((p(fact, "options") as string[]) ?? [])}`,
          ...(id.role === "PUBLIC"
            ? {}
            : { consumes: [{ kind: "role", name: id.role } as StableId] }),
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { server: string; role: string };
      const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
      return {
        sql: `DROP USER MAPPING FOR ${roleName} SERVER ${qid(id.server)}`,
      };
    },
    attributes: {
      options: {
        alter: (fact, from, to) => {
          const id = fact.id as { server: string; role: string };
          const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
          return {
            sql: `ALTER USER MAPPING FOR ${roleName} SERVER ${qid(id.server)} ${alterOptionsClause(
              (from as string[] | null) ?? [],
              (to as string[] | null) ?? [],
            )}`,
          };
        },
      },
    },
  },

  foreignTable: {
    weight: 5,
    cascadesToChildren: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER FOREIGN TABLE ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql: `CREATE FOREIGN TABLE ${rel(id.schema, id.name)} () SERVER ${qid(str(p(fact, "server")))}${optionsClause((p(fact, "options") as string[]) ?? [])}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
        {
          sql: `ALTER FOREIGN TABLE ${rel(id.schema, id.name)} OWNER TO ${qid(str(p(fact, "owner")))}`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP FOREIGN TABLE ${rel(id.schema, id.name)}` };
    },
    attributes: {
      owner: ownerRule((fact) => {
        const id = fact.id as { schema: string; name: string };
        return `ALTER FOREIGN TABLE ${rel(id.schema, id.name)}`;
      }),
      options: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER FOREIGN TABLE ${rel(id.schema, id.name)} ${alterOptionsClause(
              (from as string[] | null) ?? [],
              (to as string[] | null) ?? [],
            )}`,
          };
        },
      },
      server: "replace",
    },
  },

  publication: {
    weight: 18,
    cascadesToChildren: true,
    create: (fact, view) => {
      const name = qid((fact.id as { name: string }).name);
      const objects = publicationObjects(fact, view);
      let sql = `CREATE PUBLICATION ${name}`;
      // FOR ALL TABLES has no member facts; otherwise inline the member
      // facts (delta-set) so their standalone ADD actions are skipped
      if (p(fact, "allTables")) sql += ` FOR ALL TABLES`;
      else if (objects.clauses.length > 0)
        sql += ` FOR ${objects.clauses.join(", ")}`;
      const withParts = [
        `publish = ${lit(((p(fact, "publish") as string[]) ?? []).join(", "))}`,
      ];
      if (p(fact, "viaRoot"))
        withParts.push(`publish_via_partition_root = true`);
      sql += ` WITH (${withParts.join(", ")})`;
      return [
        {
          sql,
          consumes: [
            ...objects.consumes,
            { kind: "role", name: str(p(fact, "owner")) },
          ],
          ...(objects.produced.length > 0
            ? { alsoProduces: objects.produced }
            : {}),
        },
      ];
    },
    drop: (fact) => ({
      sql: `DROP PUBLICATION ${qid((fact.id as { name: string }).name)}`,
    }),
    attributes: {
      owner: ownerRule(
        (fact) =>
          `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)}`,
      ),
      publish: {
        alter: (fact, _from, to) => ({
          sql: `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)} SET (publish = ${lit(((to as string[] | null) ?? []).join(", "))})`,
        }),
      },
      viaRoot: {
        alter: (fact, _from, to) => ({
          sql: `ALTER PUBLICATION ${qid((fact.id as { name: string }).name)} SET (publish_via_partition_root = ${to ? "true" : "false"})`,
        }),
      },
      allTables: "replace",
    },
  },

  // a published table is its own fact: ADD/DROP TABLE incrementally. A
  // column-list or WHERE change has no in-place form, so those attributes
  // replace (DROP TABLE + re-ADD with the new shape). On a fresh
  // publication the member is inlined into CREATE PUBLICATION (see above).
  publicationRel: {
    weight: 18,
    create: (fact) => {
      const id = fact.id as {
        publication: string;
        schema: string;
        table: string;
      };
      return [
        {
          sql: `ALTER PUBLICATION ${qid(id.publication)} ADD ${publicationRelClause(fact)}`,
          consumes: [{ kind: "table", schema: id.schema, name: id.table }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as {
        publication: string;
        schema: string;
        table: string;
      };
      return {
        sql: `ALTER PUBLICATION ${qid(id.publication)} DROP TABLE ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      columns: "replace",
      where: "replace",
    },
  },

  // a published schema (FOR TABLES IN SCHEMA, PG15+) as its own fact
  publicationSchema: {
    weight: 18,
    create: (fact) => {
      const id = fact.id as { publication: string; schema: string };
      return [
        {
          sql: `ALTER PUBLICATION ${qid(id.publication)} ADD TABLES IN SCHEMA ${qid(id.schema)}`,
          consumes: [{ kind: "schema", name: id.schema }],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { publication: string; schema: string };
      return {
        sql: `ALTER PUBLICATION ${qid(id.publication)} DROP TABLES IN SCHEMA ${qid(id.schema)}`,
      };
    },
    attributes: {},
  },

  subscription: {
    weight: 23,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      const publications = ((p(fact, "publications") as string[]) ?? [])
        .map((pub) => qid(pub))
        .join(", ");
      const slot = p(fact, "slotName");
      const withParts = [
        "connect = false",
        "enabled = false",
        `slot_name = ${slot == null ? "NONE" : lit(str(slot))}`,
      ];
      const specs: ActionSpec[] = [
        {
          sql: `CREATE SUBSCRIPTION ${name} CONNECTION ${lit(str(p(fact, "conninfo")))} PUBLICATION ${publications} WITH (${withParts.join(", ")})`,
          consumes: [{ kind: "role", name: str(p(fact, "owner")) }],
        },
      ];
      if (p(fact, "enabled")) {
        specs.push({ sql: `ALTER SUBSCRIPTION ${name} ENABLE` });
      }
      return specs;
    },
    drop: (fact) => ({
      sql: `DROP SUBSCRIPTION ${qid((fact.id as { name: string }).name)}`,
      // with an associated replication slot the drop cannot run inside a
      // transaction block; slotless subscriptions drop transactionally
      ...(p(fact, "slotName") == null
        ? {}
        : { transactionality: "nonTransactional" as const }),
    }),
    attributes: {
      owner: ownerRule(
        (fact) =>
          `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)}`,
      ),
      enabled: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} ${to ? "ENABLE" : "DISABLE"}`,
        }),
      },
      publications: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} SET PUBLICATION ${((to as string[] | null) ?? []).map((pub) => qid(pub)).join(", ")} WITH (refresh = false)`,
        }),
      },
      conninfo: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} CONNECTION ${lit(str(to))}`,
        }),
      },
      slotName: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SUBSCRIPTION ${qid((fact.id as { name: string }).name)} SET (slot_name = ${to == null ? "NONE" : lit(str(to))})`,
        }),
      },
    },
  },

  acl: {
    weight: 21,
    metadata: true,
    create: (fact) => grantActions(fact, "grant"),
    drop: (fact) => {
      const id = fact.id as { kind: "acl"; target: StableId; grantee: string };
      const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
      return {
        sql: `REVOKE ALL ON ${grantTarget(id.target)} FROM ${grantee}`,
        ...(id.grantee === "PUBLIC"
          ? {}
          : { consumes: [{ kind: "role", name: id.grantee } as StableId] }),
      };
    },
    attributes: {
      privileges: "replace",
      grantable: "replace",
    },
  },
};

export function rulesFor(kind: string): KindRules {
  const rules = RULES[kind];
  if (!rules) {
    throw new Error(
      `rule table: no rules for kind '${kind}' — extend the rule vocabulary (guardrail 3)`,
    );
  }
  return rules;
}
