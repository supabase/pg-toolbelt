/**
 * Spark source: build a FactBase from a Spark schema description instead of
 * extracting it from a Postgres catalog.
 *
 * This is the one scoped exception to "Postgres is the only elaborator": Spark
 * has no `pg_depend`, so dependency edges are derived here from the description's
 * structured fields (constraint columns, FK references, view `depends_on`) plus a
 * conservative identifier scan of expression text. The scan only DERIVES edges;
 * it never rewrites SQL, and it may over-approximate (an extra edge only adds an
 * ordering constraint). Fact ids and payloads mirror `src/extract/**` exactly so
 * the generic diff / plan / render work unchanged.
 */
import type { Diagnostic } from "../../core/diagnostic.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type {
  SparkConstraint,
  SparkSchemaDescription,
  SparkTable,
} from "./description.ts";

const IDENTITY_MAX: Record<string, string> = {
  smallint: "32767",
  integer: "2147483647",
  bigint: "9223372036854775807",
};

interface Token {
  /** identifier parts of a (possibly qualified) name, unquoted-folded */
  parts: string[];
}

/** Identifier tokens of an SQL expression, skipping string literals and
 *  numbers. Qualified names (`a.b.c`) come back as one token with parts. */
function scanIdentifiers(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let current: string[] | null = null;
  let expectPart = false;
  const flush = (): void => {
    if (current !== null) tokens.push({ parts: current });
    current = null;
    expectPart = false;
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "'") {
      flush();
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") i += 2;
        else if (text[i] === "'") break;
        else i++;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let name = "";
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') {
          name += '"';
          j += 2;
        } else if (text[j] === '"') break;
        else name += text[j++];
      }
      if (expectPart && current !== null) current.push(name);
      else {
        flush();
        current = [name];
      }
      expectPart = false;
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j] as string)) j++;
      const name = text.slice(i, j).toLowerCase();
      if (expectPart && current !== null) current.push(name);
      else {
        flush();
        current = [name];
      }
      expectPart = false;
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      flush();
      while (i < text.length && /[\w.]/.test(text[i] as string)) i++;
      continue;
    }
    if (ch === "." && current !== null && !expectPart) {
      expectPart = true;
      i++;
      continue;
    }
    if (!/\s/.test(ch)) flush();
    i++;
  }
  flush();
  return tokens;
}

/** Content of the balanced parenthesis group opening at `open`. */
function parenGroup(
  text: string,
  open: number,
): { inner: string; end: number } {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") inString = !inString;
    if (inString) continue;
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
    }
  }
  return { inner: text.slice(open + 1), end: text.length };
}

function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") inString = !inString;
    if (inString) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter((s) => s !== "");
}

const PLAIN_INDEX_ELEMENT =
  /^(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)(?:\s+[A-Za-z_][\w$.]*)*$/;

/** Whether an index keys anything beyond plain columns (expression elements or
 *  a WHERE predicate): Postgres then records a whole-table dependency too. */
function indexIsExpressionOrPartial(def: string): boolean {
  const using = /\bUSING\s+\w+\s*\(/i.exec(def);
  if (using === null) return true;
  const { inner, end } = parenGroup(def, using.index + using[0].length - 1);
  if (/\bWHERE\b/i.test(def.slice(end))) return true;
  return splitTopLevel(inner).some((el) => !PLAIN_INDEX_ELEMENT.test(el));
}

/** Build a FactBase from a Spark schema description. */
export function sparkFactBase(description: SparkSchemaDescription): FactBase {
  const facts: Fact[] = [];
  const edges: DependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const referenceOnly = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const seenSchemas = new Set<string>();

  const edge = (from: StableId, to: StableId): void => {
    const key = `${encodeId(from)}>${encodeId(to)}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind: "depends" });
  };
  const comment = (target: StableId, text: string | null): void => {
    if (text === null) return;
    facts.push({
      id: { kind: "comment", target },
      parent: target,
      payload: { text },
    });
  };
  const schemaFact = (name: string, ref: boolean, text: string | null) => {
    if (seenSchemas.has(name)) return;
    seenSchemas.add(name);
    const id: StableId = { kind: "schema", name };
    facts.push({ id, payload: {} });
    if (ref) referenceOnly.add(encodeId(id));
    else comment(id, text);
  };

  const managedSchemas = new Set(description.managed_schemas);
  for (const s of description.schemas) {
    schemaFact(s.name, managedSchemas.has(s.name), s.comment);
  }
  for (const name of description.managed_schemas) schemaFact(name, true, null);
  for (const t of description.tables) schemaFact(t.schema, t.managed, null);

  const enumByName = new Map<string, StableId>();
  for (const e of description.enums) {
    const id: StableId = { kind: "type", schema: e.schema, name: e.name };
    enumByName.set(`${e.schema}.${e.name}`, id);
    facts.push({
      id,
      parent: { kind: "schema", name: e.schema },
      payload: { variant: "enum", values: [...e.labels] },
    });
    edge(id, { kind: "schema", name: e.schema });
    comment(id, e.comment);
  }
  /** enum named by a `format_type` string (array suffix and quoting tolerated) */
  const enumOfType = (type: string, schema: string): StableId | undefined => {
    const token = scanIdentifiers(type.replace(/(\[\])+$/, ""))[0];
    if (token === undefined) return undefined;
    const name =
      token.parts.length === 2
        ? token.parts.join(".")
        : `${schema}.${token.parts[0]}`;
    return (
      enumByName.get(name) ??
      (token.parts.length === 1
        ? enumByName.get(`public.${token.parts[0]}`)
        : undefined)
    );
  };
  /** enums a free expression casts to / names (qualified references only) */
  const enumsIn = (expr: string): StableId[] =>
    scanIdentifiers(expr)
      .filter((t) => t.parts.length === 2)
      .map((t) => enumByName.get(t.parts.join(".")))
      .filter((id): id is StableId => id !== undefined);

  const tableKey = (schema: string, name: string): string =>
    `${schema}.${name}`;
  const tables = new Map<string, SparkTable>(
    description.tables.map((t) => [tableKey(t.schema, t.name), t]),
  );
  const columnsReferenced = (table: SparkTable, expr: string): string[] => {
    const names = new Set(
      scanIdentifiers(expr).map((t) => t.parts[t.parts.length - 1] as string),
    );
    return table.columns.map((c) => c.name).filter((c) => names.has(c));
  };
  const colId = (t: SparkTable, name: string): StableId => ({
    kind: "column",
    schema: t.schema,
    table: t.name,
    name,
  });
  const keyConstraintFor = (
    ref: NonNullable<SparkConstraint["references"]>,
  ): StableId | undefined => {
    const target = tables.get(tableKey(ref.schema, ref.table));
    const want = [...ref.columns].sort().join(",");
    const match = target?.constraints.find(
      (c) =>
        (c.type === "p" || c.type === "u") &&
        [...c.columns].sort().join(",") === want,
    );
    if (target !== undefined && match !== undefined) {
      return {
        kind: "constraint",
        schema: target.schema,
        table: target.name,
        name: match.name,
      };
    }
    const index = target?.indexes.find(
      (i) =>
        i.unique &&
        i.constraint === null &&
        columnsReferenced(target, i.def).sort().join(",") === want,
    );
    return target !== undefined && index !== undefined
      ? { kind: "index", schema: target.schema, name: index.name }
      : undefined;
  };

  for (const t of description.tables) {
    const tableId: StableId = { kind: "table", schema: t.schema, name: t.name };
    const own: string[] = [];
    const push = (fact: Fact): void => {
      facts.push(fact);
      own.push(encodeId(fact.id));
    };
    push({
      id: tableId,
      parent: { kind: "schema", name: t.schema },
      payload: {
        persistence: "p",
        rowSecurity: t.rls_enabled,
        forceRowSecurity: t.rls_forced,
        replicaIdentity: "d",
        replicaIdentityIndex: null,
        partitionKey: null,
        partitionBound: null,
        parentTable: null,
        reloptions: null,
      },
    });
    edge(tableId, { kind: "schema", name: t.schema });
    if (!t.managed) comment(tableId, t.comment);

    for (const c of t.columns) {
      const id = colId(t, c.name);
      const max = IDENTITY_MAX[c.type];
      push({
        id,
        parent: tableId,
        payload: {
          _position: c.position,
          _partitionKey: false,
          type: c.type,
          notNull: c.not_null,
          identity:
            c.identity === null
              ? null
              : {
                  generation: c.identity,
                  sequence: {
                    schema: t.schema,
                    name: `${t.name}_${c.name}_seq`,
                  },
                  options: {
                    increment: "1",
                    start: "1",
                    minValue: "1",
                    maxValue: max ?? IDENTITY_MAX["bigint"],
                    cache: "1",
                    cycle: false,
                  },
                },
          collation: null,
          generatedExpr: c.generated,
        },
      });
      const typeRef = enumOfType(c.type, t.schema);
      if (typeRef !== undefined) edge(id, typeRef);
      if (c.generated !== null) {
        for (const other of columnsReferenced(t, c.generated)) {
          if (other !== c.name) edge(id, colId(t, other));
        }
        for (const e of enumsIn(c.generated)) edge(id, e);
      }
      if (c.default !== null && c.generated === null && c.identity === null) {
        const defId: StableId = {
          kind: "default",
          schema: t.schema,
          table: t.name,
          name: c.name,
        };
        push({ id: defId, parent: id, payload: { expr: c.default } });
        edge(defId, id);
        for (const e of enumsIn(c.default)) edge(defId, e);
      }
      if (!t.managed) comment(id, c.comment);
    }

    for (const con of t.constraints) {
      const id: StableId = {
        kind: "constraint",
        schema: t.schema,
        table: t.name,
        name: con.name,
      };
      push({
        id,
        parent: tableId,
        payload: {
          def: con.def,
          type: con.type,
          validated: !/\bNOT VALID\s*$/i.test(con.def),
          ...(con.type === "p" || con.type === "u"
            ? { _keyColumns: [...con.columns] }
            : {}),
        },
      });
      const cols =
        con.type === "c" ? columnsReferenced(t, con.def) : con.columns;
      for (const col of cols) edge(id, colId(t, col));
      if (con.type === "f" && con.references !== null) {
        const ref = con.references;
        const target = tables.get(tableKey(ref.schema, ref.table));
        for (const col of ref.columns) {
          if (target !== undefined) edge(id, colId(target, col));
        }
        const key = keyConstraintFor(ref);
        if (key !== undefined) edge(id, key);
      }
    }

    for (const index of t.indexes) {
      // Constraint-backed indexes are part of their constraint fact.
      if (index.constraint !== null) continue;
      const id: StableId = {
        kind: "index",
        schema: t.schema,
        name: index.name,
      };
      push({
        id,
        parent: tableId,
        payload: { def: index.def, valid: true, attachedTo: null },
      });
      const using = /\bUSING\s+\w+\s*\(/i.exec(index.def);
      const keyText = using === null ? index.def : index.def.slice(using.index);
      for (const col of columnsReferenced(t, keyText)) edge(id, colId(t, col));
      if (indexIsExpressionOrPartial(index.def)) edge(id, tableId);
    }

    for (const p of t.policies) {
      const id: StableId = {
        kind: "policy",
        schema: t.schema,
        table: t.name,
        name: p.name,
      };
      push({
        id,
        parent: tableId,
        payload: {
          cmd: p.cmd,
          permissive: p.permissive,
          usingExpr: p.using,
          checkExpr: p.check,
          roles: [...p.roles].map((r) => (r === "public" ? "PUBLIC" : r)),
        },
      });
      edge(id, tableId);
      const exprs = [p.using, p.check].filter((e): e is string => e !== null);
      for (const expr of exprs) {
        for (const col of columnsReferenced(t, expr)) edge(id, colId(t, col));
      }
    }

    if (t.managed) for (const key of own) referenceOnly.add(key);
  }

  const viewNames = new Set(
    description.views.map((v) => tableKey(v.schema, v.name)),
  );
  for (const v of description.views) {
    const id: StableId = { kind: "view", schema: v.schema, name: v.name };
    facts.push({
      id,
      parent: { kind: "schema", name: v.schema },
      payload: { def: v.def, reloptions: null },
    });
    edge(id, { kind: "schema", name: v.schema });
    for (const dep of v.depends_on) {
      const key = tableKey(dep.schema, dep.name);
      if (viewNames.has(key)) {
        edge(id, { kind: "view", schema: dep.schema, name: dep.name });
        continue;
      }
      const table = tables.get(key);
      if (table === undefined) {
        diagnostics.push({
          code: "spark-unknown-dependency",
          severity: "warning",
          subject: id,
          message: `view ${v.schema}.${v.name} depends on ${key}, which the Spark description does not list`,
        });
        continue;
      }
      const cols = columnsReferenced(table, v.def);
      if (cols.length === 0) {
        edge(id, { kind: "table", schema: table.schema, name: table.name });
      }
      for (const col of cols) edge(id, colId(table, col));
    }
    for (const e of enumsIn(v.def)) edge(id, e);
    comment(id, v.comment);
  }

  const fb = buildFactBase(facts, edges, "spark", referenceOnly);
  fb.diagnostics.push(...diagnostics);
  return fb;
}
