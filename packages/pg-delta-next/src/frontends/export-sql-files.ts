/**
 * Declarative export (stage 9 deliverable 6): render a fact base to SQL
 * files via the planner (plan(∅ → fb) — the same renderer as everything
 * else) and split the statements across files by a mapping policy.
 *
 * Two layouts:
 * - "by-object" (default): the human layout users know from the old
 *   engine's exporter — cluster/roles.sql, schemas/<s>/tables/<t>.sql, …
 *   Files within a path are emitted in plan (dependency) order, but the
 *   loader's lexicographic discovery may need its bounded retry rounds for
 *   cross-file references. Fidelity is the gate: load(export(fb)) ≡ fb.
 * - "ordered": file names carry a zero-padded sequence prefix in plan
 *   order, so lexicographic discovery IS dependency order and the loader
 *   converges with zero deferred rounds (the stage-9 zero-round gate).
 */
import { buildFactBase, type FactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan, type Action } from "../plan/plan.ts";
import type { SqlFile } from "./load-sql-files.ts";

export interface ExportOptions {
  layout?: "by-object" | "ordered";
}

/** The subject deciding an action's file: produced fact, else consumed. */
function subjectOf(action: Action): StableId | undefined {
  return action.produces[0] ?? action.consumes[0];
}

/** Satellite facts (comment/acl) file with their target. */
function fileTarget(id: StableId): StableId {
  if (id.kind === "comment" || id.kind === "acl") {
    return fileTarget((id as { target: StableId }).target);
  }
  return id;
}

const CLUSTER_FILES: Record<string, string> = {
  role: "cluster/roles.sql",
  membership: "cluster/roles.sql",
  defaultPrivilege: "cluster/roles.sql",
  fdw: "cluster/foreign_data_wrappers.sql",
  server: "cluster/foreign_data_wrappers.sql",
  userMapping: "cluster/foreign_data_wrappers.sql",
  publication: "cluster/publications.sql",
  subscription: "cluster/subscriptions.sql",
  eventTrigger: "cluster/event_triggers.sql",
};

const SCHEMA_DIRS: Record<string, string> = {
  type: "types",
  domain: "domains",
  collation: "collations",
  sequence: "sequences",
  table: "tables",
  view: "views",
  materializedView: "materialized_views",
  foreignTable: "foreign_tables",
  procedure: "functions",
  aggregate: "functions",
};

/** Table-scoped satellites write into their table's file. */
const TABLE_SCOPED = new Set([
  "column",
  "default",
  "constraint",
  "trigger",
  "policy",
  "rule",
]);

function pathFor(id: StableId): string {
  const target = fileTarget(id);
  const kind = target.kind;
  const clusterFile = CLUSTER_FILES[kind];
  if (clusterFile !== undefined) return clusterFile;
  if (kind === "extension") {
    return `cluster/extensions/${(target as { name: string }).name}.sql`;
  }
  if (kind === "schema") {
    return `schemas/${(target as { name: string }).name}/schema.sql`;
  }
  if (TABLE_SCOPED.has(kind)) {
    const t = target as { schema: string; table: string };
    return `schemas/${t.schema}/tables/${t.table}.sql`;
  }
  if (kind === "index") {
    // indexes name only (schema, name) — file them with the schema; their
    // CREATE INDEX statement names the table itself
    const t = target as { schema: string; name: string };
    return `schemas/${t.schema}/indexes/${t.name}.sql`;
  }
  const dir = SCHEMA_DIRS[kind];
  if (dir !== undefined) {
    const t = target as { schema: string; name: string };
    return `schemas/${t.schema}/${dir}/${t.name}.sql`;
  }
  return "cluster/misc.sql";
}

export function exportSqlFiles(
  fb: FactBase,
  options: ExportOptions = {},
): SqlFile[] {
  const layout = options.layout ?? "by-object";
  // render against the PRISTINE baseline, not absolute emptiness: every
  // real database already has schema "public" (and its satellites), so a
  // CREATE SCHEMA public in the export could never replay
  const pristine = fb.facts().filter((fact) => {
    const id = fact.id;
    if (id.kind === "schema" && (id as { name: string }).name === "public")
      return true;
    if (id.kind === "comment" || id.kind === "acl") {
      const target = (id as { target: StableId }).target;
      return (
        target.kind === "schema" &&
        (target as { name: string }).name === "public"
      );
    }
    return false;
  });
  const baseline = buildFactBase(pristine, []);
  const rendered = plan(baseline, fb);

  // group statements by file, preserving plan order within AND across
  // groups (first-statement order decides file order)
  const files = new Map<string, { firstAt: number; statements: string[] }>();
  rendered.actions.forEach((action, position) => {
    const subject = subjectOf(action);
    const path = subject === undefined ? "cluster/misc.sql" : pathFor(subject);
    const entry = files.get(path) ?? { firstAt: position, statements: [] };
    entry.statements.push(`${action.sql};`);
    files.set(path, entry);
  });

  if (layout === "ordered") {
    // statement-true splitting: runs of CONSECUTIVE same-object actions
    // become one numbered file, so lexicographic discovery IS plan order
    // and the loader converges in a single pass — an object interleaved
    // with its dependencies simply spans several numbered files
    const runs: { path: string; statements: string[] }[] = [];
    rendered.actions.forEach((action) => {
      const subject = subjectOf(action);
      const path =
        subject === undefined ? "cluster/misc.sql" : pathFor(subject);
      const last = runs[runs.length - 1];
      if (last !== undefined && last.path === path) {
        last.statements.push(`${action.sql};`);
      } else {
        runs.push({ path, statements: [`${action.sql};`] });
      }
    });
    return runs.map((run, index) => ({
      name: `${String(index).padStart(4, "0")}_${run.path.replaceAll("/", "_")}`,
      sql: `${run.statements.join("\n\n")}\n`,
    }));
  }

  const ordered = [...files.entries()].sort(
    (a, b) => a[1].firstAt - b[1].firstAt,
  );
  return ordered.map(([path, entry]) => ({
    name: path,
    sql: `${entry.statements.join("\n\n")}\n`,
  }));
}
