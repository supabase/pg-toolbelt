/**
 * Shared helpers for the rule table (target-architecture §3.4). These are the
 * rendering / metadata utilities the per-kind rule families compose. Types are
 * imported type-only from `../rules.ts` so this module never forms a runtime
 * import cycle with the registry that re-exports it.
 */
import type { Fact } from "../../core/fact.ts";
import type { PayloadValue } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import { grantTarget, qid, rel, splitOption } from "../render.ts";
import type { ActionSpec, FactView } from "../rules.ts";

const TEXT_ENCODER = new TextEncoder();

/** UTF-8 byte length of a string. Runtime-agnostic (no `Buffer`), so it works
 *  identically in Bun / Node / Deno — used where PostgreSQL's byte-based
 *  identifier limit (NAMEDATALEN) matters, not the JS UTF-16 code-unit length. */
export function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).length;
}

/** Most renames are `<ALTER prefix> RENAME TO <new name>`. */
export function renameRule(
  alterPrefix: (fact: Fact) => string,
): (fact: Fact, to: StableId) => ActionSpec {
  return (fact, to) => ({
    sql: `${alterPrefix(fact)} RENAME TO ${qid((to as { name: string }).name)}`,
  });
}

export const str = (v: PayloadValue): string => {
  if (v === null || v === undefined || typeof v === "object") {
    throw new Error(
      `rule rendering: expected a scalar, got ${JSON.stringify(v)}`,
    );
  }
  return String(v);
};

export function p(fact: Fact, key: string): PayloadValue {
  return fact.payload[key];
}

/** The `depends` edge targets of `id` in `view` — the objects the fact's
 *  definition references. A routine's def-alter (CREATE OR REPLACE) consumes
 *  these so it is ordered AFTER their creates: a BEGIN ATOMIC body is parsed and
 *  dependency-checked at replace time. plpgsql / quoted-string bodies are not
 *  (check_function_bodies=off in the preamble) and record no such edges, so this
 *  is exactly the set that needs ordering. Consuming an id nothing in-plan
 *  produces is harmless — no ordering edge is added. */
export function dependencyConsumes(view: FactView, id: StableId): StableId[] {
  return view
    .outgoingEdges(id)
    .filter((e) => e.kind === "depends")
    .map((e) => e.to);
}

/** `<prefix> SET (…)` / `<prefix> RESET (…)` specs for a reloptions transition.
 *  Emits SET for keys whose value was added or changed and RESET for keys that
 *  disappeared — the in-place form for both views (security_invoker, …) and
 *  tables (fillfactor, autovacuum_*, …) so an options-only change is no longer
 *  invisible (it used to hash identically and plan nothing). */
export function reloptionsAlterSpecs(
  alterPrefix: string,
  from: PayloadValue,
  to: PayloadValue,
): ActionSpec[] {
  const fromMap = new Map((from as string[] | null)?.map(splitOption) ?? []);
  const toMap = new Map((to as string[] | null)?.map(splitOption) ?? []);
  const setParts: string[] = [];
  for (const [key, value] of toMap) {
    if (fromMap.get(key) !== value) setParts.push(`${key}=${value}`);
  }
  const resetKeys: string[] = [];
  for (const key of fromMap.keys()) {
    if (!toMap.has(key)) resetKeys.push(key);
  }
  const specs: ActionSpec[] = [];
  if (setParts.length > 0) {
    specs.push({ sql: `${alterPrefix} SET (${setParts.join(", ")})` });
  }
  if (resetKeys.length > 0) {
    specs.push({ sql: `${alterPrefix} RESET (${resetKeys.join(", ")})` });
  }
  return specs;
}

/** A backing identity sequence's parameters (mirrors the sequence payload,
 *  minus dataType — that is fixed by the column type). */
export interface IdentityOptions {
  increment: string;
  start: string;
  minValue: string;
  maxValue: string;
  cache: string;
  cycle: boolean;
}

/** Identity payload:
 *  { generation: 'a'|'d', sequence: {schema,name}, options: IdentityOptions } | null.
 *  The backing sequence rides along so identity transitions can declare the
 *  physical sequence they implicitly create/destroy; its options ride along so
 *  a non-default START/INCREMENT/MIN/MAX/CACHE/CYCLE is reproduced. */
export interface IdentityPayload {
  generation: string;
  sequence: { schema: string; name: string } | null;
  options?: IdentityOptions | null;
}

export function identityGeneration(value: PayloadValue): string | null {
  if (value == null) return null;
  return (value as unknown as IdentityPayload).generation;
}

export function identitySequenceId(value: PayloadValue): StableId | null {
  if (value == null) return null;
  const sequence = (value as unknown as IdentityPayload).sequence;
  if (sequence == null) return null;
  return { kind: "sequence", schema: sequence.schema, name: sequence.name };
}

export function identityOptions(value: PayloadValue): IdentityOptions | null {
  if (value == null) return null;
  return (value as unknown as IdentityPayload).options ?? null;
}

/** true when the OLD `[oldMin, oldMax]` value range and the NEW `[newMin, newMax]`
 *  range are provably DISJOINT (`oldMax < newMin || oldMin > newMax`).
 *
 *  A sequence's / identity's live counter (`last_value`) is UNMODELED runtime
 *  state — the diff never sees it. When the two ranges are disjoint the counter
 *  is GUARANTEED to fall outside the new range, so the only in-place path that
 *  converges is `RESTART` (realign to the new START, always inside the new range
 *  — matching what a fresh `… START WITH …` would produce). When the ranges
 *  OVERLAP we must NOT `RESTART`: the live counter is very likely still valid
 *  (e.g. counter at 500, MIN 1→0 + START 1→2 leaves 500 usable), and silently
 *  resetting it to START replays already-issued values → duplicate keys. If an
 *  overlapping change happens to leave the counter outside the new range,
 *  PostgreSQL rejects the ALTER loudly and the operator decides — we never
 *  silently reset. Bounds are bigint-valued, so compare with BigInt (they reach
 *  9223372036854775807, past Number's safe-integer range). */
export function rangesDisjoint(
  oldMin: string,
  oldMax: string,
  newMin: string,
  newMax: string,
): boolean {
  return BigInt(oldMax) < BigInt(newMin) || BigInt(oldMin) > BigInt(newMax);
}

/** Constraints attach to tables OR domains; the parent kind decides. */
export function constraintTarget(fact: Fact): string {
  const id = fact.id as { schema: string; table: string };
  const keyword =
    fact.parent?.kind === "domain"
      ? "DOMAIN"
      : fact.parent?.kind === "foreignTable"
        ? "FOREIGN TABLE"
        : "TABLE";
  return `ALTER ${keyword} ${rel(id.schema, id.table)}`;
}

/** O/D/R/A enabled-state chars → ALTER … ENABLE/DISABLE phrases. */
export function enabledPhrase(state: string): string {
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

/** Canonical `GRANT <privs> ON <target> TO <grantees>` statement. Shared by
 *  `grantActions` (single grantee) and compaction's multi-grantee merge pass
 *  (`mergeCoTargetGrants`, plan/internal.ts), so the two renders can never
 *  drift — the merge pass both recognizes mergeable GRANTs by comparing
 *  against this render and re-renders the merged statement with it. */
export function renderGrantSql(
  target: StableId,
  privileges: readonly string[],
  grantees: readonly string[],
  opts?: { column?: string; withGrantOption?: boolean },
): string {
  const col = opts?.column;
  const privs =
    col === undefined
      ? privileges.join(", ")
      : privileges.map((priv) => `${priv} (${qid(col)})`).join(", ");
  const to = grantees
    .map((g) => (g === "PUBLIC" ? "PUBLIC" : qid(g)))
    .join(", ");
  const option = opts?.withGrantOption ? " WITH GRANT OPTION" : "";
  return `GRANT ${privs} ON ${grantTarget(target)} TO ${to}${option}`;
}

/** Canonical `REVOKE ALL ON <target> FROM <grantees>` — shared by `grantActions`,
 *  create-time hygiene, and compaction's multi-grantee REVOKE merge. */
export function renderRevokeAllSql(
  target: StableId,
  grantees: readonly string[],
  opts?: { column?: string },
): string {
  const col = opts?.column;
  const revokeAll =
    col === undefined ? "REVOKE ALL" : `REVOKE ALL (${qid(col)})`;
  const from = grantees
    .map((g) => (g === "PUBLIC" ? "PUBLIC" : qid(g)))
    .join(", ");
  return `${revokeAll} ON ${grantTarget(target)} FROM ${from}`;
}

/** Column-level acl ids of the same (target, grantee) as an object-level acl,
 *  collected across the given views — what `REVOKE ALL ON <rel> FROM <role>`
 *  wipes along with the object-level grant
 *  (https://www.postgresql.org/docs/current/sql-revoke.html). Column acls
 *  hang off the column fact (tables) or off the relation itself (views /
 *  materialized views). */
export function columnAclIdsFor(
  id: { target: StableId; grantee: string },
  ...views: FactView[]
): StableId[] {
  const out: StableId[] = [];
  const seen = new Set<string>();
  const targetKey = encodeId(id.target);
  const take = (child: Fact): void => {
    const cid = child.id;
    if (cid.kind !== "acl" || cid.column === undefined) return;
    if (cid.grantee !== id.grantee || encodeId(cid.target) !== targetKey)
      return;
    const key = encodeId(cid);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cid);
  };
  for (const view of views) {
    for (const child of view.childrenOf(id.target)) {
      take(child);
      if (child.id.kind === "column") {
        for (const grandchild of view.childrenOf(child.id)) take(grandchild);
      }
    }
  }
  return out;
}

export function grantActions(fact: Fact, verb: "grant"): ActionSpec[] {
  const id = fact.id as {
    kind: "acl";
    target: StableId;
    grantee: string;
    column?: string;
  };
  const privileges = p(fact, "privileges") as string[];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const consumes: StableId[] =
    id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
  // Column-level grant: each privilege is qualified by the column
  // (`SELECT (col)`) and REVOKE ALL takes the column list too. Object-level
  // grants render the bare privilege list.
  const col = id.column;
  const specs: ActionSpec[] = [
    // pg_dump's model: reset to a clean slate first — implicit default-
    // privilege grants on freshly created objects would otherwise linger
    {
      sql: renderRevokeAllSql(
        id.target,
        [id.grantee],
        col !== undefined ? { column: col } : {},
      ),
      consumes,
    },
  ];
  if (plain.length > 0) {
    specs.push({
      sql: renderGrantSql(
        id.target,
        plain,
        [id.grantee],
        col !== undefined ? { column: col } : {},
      ),
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: renderGrantSql(id.target, withOption, [id.grantee], {
        ...(col !== undefined ? { column: col } : {}),
        withGrantOption: true,
      }),
      consumes,
    });
  }
  void verb;
  return specs;
}

/** Aggregate signature: direct args [ORDER BY ordered args]; '*' when none. */
export function aggSig(fact: Fact): string {
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
  L: "LARGE OBJECTS",
};

/** Render a `pg_default_acl.defaclobjtype` code, or throw loud — an unmapped
 *  code silently rendered as `TABLES` (the old `?? "TABLES"` fallback) would
 *  emit the WRONG DDL for a future/unhandled objtype instead of surfacing the
 *  gap. */
function defaclObjType(objtype: string): string {
  const rendered = DEFACL_OBJTYPE[objtype];
  if (rendered === undefined) {
    throw new Error(
      `defaultPrivilege: unmapped pg_default_acl.defaclobjtype "${objtype}" — add it to DEFACL_OBJTYPE (helpers.ts)`,
    );
  }
  return rendered;
}

export function defaultPrivPrefix(id: {
  role: string;
  schema: string | null;
}): string {
  let sql = `ALTER DEFAULT PRIVILEGES FOR ROLE ${qid(id.role)}`;
  if (id.schema != null) sql += ` IN SCHEMA ${qid(id.schema)}`;
  return sql;
}

export function defaultPrivConsumes(id: {
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

/**
 * Role names a fact REFERENCES without owning: an ACL grantee, a
 * default-privilege FOR-role/grantee, the membership endpoints, a
 * user-mapping role, an RLS policy's TO-roles — exactly the references the
 * rules in this directory turn into `consumes: [{ kind: "role", … }]`
 * (grantActions / defaultPrivConsumes / membership / userMapping / policy).
 * plan() reads these off the SOURCE view to WITNESS that a role exists on the
 * apply target even when the role OBJECT is projected or filtered out of the
 * view: PostgreSQL cannot record any of these for a nonexistent role.
 * `PUBLIC` is a pseudo-role, never an object — excluded, like the consumes
 * builders do.
 */
export function roleReferencesOf(fact: Fact): string[] {
  const id = fact.id;
  const names: string[] = [];
  switch (id.kind) {
    case "acl":
      names.push(id.grantee);
      break;
    case "defaultPrivilege":
      names.push(id.role, id.grantee);
      break;
    case "membership":
      names.push(id.role, id.member);
      break;
    case "userMapping":
      names.push(id.role);
      break;
    case "policy":
      names.push(...((fact.payload as { roles?: string[] }).roles ?? []));
      break;
    default:
      break;
  }
  return names.filter((name) => name !== "PUBLIC");
}

/**
 * A `defaultPrivilege` fact with EMPTY `privileges` is a synthesized marker for
 * a REVOKED built-in default (e.g. `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON
 * FUNCTIONS FROM PUBLIC`): the grantee's built-in default was taken away. Its
 * `_revokedDefault` carries the privileges that were removed so the DROP can
 * restore them. A non-empty fact is an ordinary positive grant.
 */
function isRevokedDefaultMarker(fact: Fact): boolean {
  return ((p(fact, "privileges") as string[]) ?? []).length === 0;
}

/** CREATE a default-privilege fact: GRANT the privileges, or — for a revoked
 *  default marker — REVOKE the built-in default the marker records is gone. */
export function defaultPrivilegeCreateActions(fact: Fact): ActionSpec[] {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = defaclObjType(id.objtype);
  const consumes = defaultPrivConsumes(id);
  if (isRevokedDefaultMarker(fact)) {
    return [
      {
        sql: `${defaultPrivPrefix(id)} REVOKE ALL ON ${objtype} FROM ${grantee}`,
        consumes,
      },
    ];
  }
  const privileges = (p(fact, "privileges") as string[]) ?? [];
  const grantable = new Set((p(fact, "grantable") as string[]) ?? []);
  const plain = privileges.filter((priv) => !grantable.has(priv));
  const withOption = privileges.filter((priv) => grantable.has(priv));
  const specs: ActionSpec[] = [];
  if (plain.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} GRANT ${plain.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    });
  }
  if (withOption.length > 0) {
    specs.push({
      sql: `${defaultPrivPrefix(id)} GRANT ${withOption.join(", ")} ON ${objtype} TO ${grantee} WITH GRANT OPTION`,
      consumes,
    });
  }
  return specs;
}

/** DROP a default-privilege fact: REVOKE the positive grant, or — for a revoked
 *  default marker — GRANT the built-in default back (restoring it). */
export function defaultPrivilegeDropActions(fact: Fact): ActionSpec {
  const id = fact.id as {
    role: string;
    schema: string | null;
    objtype: string;
    grantee: string;
  };
  const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
  const objtype = defaclObjType(id.objtype);
  const consumes = defaultPrivConsumes(id);
  if (isRevokedDefaultMarker(fact)) {
    const restored = (p(fact, "_revokedDefault") as string[]) ?? [];
    return {
      sql: `${defaultPrivPrefix(id)} GRANT ${restored.join(", ")} ON ${objtype} TO ${grantee}`,
      consumes,
    };
  }
  return {
    sql: `${defaultPrivPrefix(id)} REVOKE ALL ON ${objtype} FROM ${grantee}`,
    consumes,
  };
}
