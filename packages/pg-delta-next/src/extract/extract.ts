/**
 * Stage 2: catalog → fact base (target-architecture §3.1–3.2).
 *
 * Doctrine carried from the old extractor corpus:
 * - logical names, never physical attnums
 * - canonical `pg_get_*def()` output as the comparison form
 * - extraction queries return identity PARTS as columns; only the
 *   library-side codec builds identity strings (guardrail 1)
 *
 * Capture model: a single REPEATABLE READ READ ONLY transaction on one
 * connection — consistent by construction. (Parallel workers via
 * `pg_export_snapshot()` are a later optimization; serial is the documented
 * fallback and plenty fast at current scale.)
 *
 * v1 kind coverage: schema, role, extension, table (+ column, default,
 * constraint, trigger, policy), index, sequence, view, materializedView,
 * procedure/function, comments, ACLs. Extension-member objects are excluded
 * for now (provenance-as-edges arrives with the policy layer, stage 8).
 */
import type { Pool, PoolClient } from "pg";
import type { Diagnostic } from "../core/diagnostic.ts";
import {
  buildFactBase,
  FactBase,
  type DependencyEdge,
  type Fact,
} from "../core/fact.ts";

import type { StableId } from "../core/stable-id.ts";

export interface ExtractResult {
  factBase: FactBase;
  pgVersion: string;
  diagnostics: Diagnostic[];
}

/** Schemas never treated as user state. */
const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`;
const USER_SCHEMA_FILTER = `
  n.nspname NOT IN ${SYSTEM_SCHEMAS}
  AND n.nspname NOT LIKE 'pg\\_toast%'
  AND n.nspname NOT LIKE 'pg\\_temp%'`;

/** Anti-join fragment: exclude objects owned by extensions (stage-8 TODO: provenance edges instead). */
function notExtensionMember(classid: string, oidExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM pg_depend ext_d
    WHERE ext_d.classid = '${classid}'::regclass
      AND ext_d.objid = ${oidExpr}
      AND ext_d.deptype = 'e')`;
}

interface Row {
  [key: string]: unknown;
}

export async function extract(pool: Pool): Promise<ExtractResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await extractOnClient(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function extractOnClient(client: PoolClient): Promise<ExtractResult> {
  const facts: Fact[] = [];
  const edges: DependencyEdge[] = [];
  const diagnostics: Diagnostic[] = [];

  const q = async (sql: string): Promise<Row[]> =>
    (await client.query(sql)).rows as Row[];

  const pgVersion =
    ((await q(`SHOW server_version`))[0]?.["server_version"] as string) ??
    "unknown";

  /** Helper: push a fact plus its optional comment/acl satellite facts. */
  const pushWithMeta = (
    fact: Fact,
    row: Row,
    aclTargets?: {
      privileges: string[];
      grantable: string[];
      grantee: string;
    }[],
  ): void => {
    facts.push(fact);
    const comment = row["comment"];
    if (typeof comment === "string") {
      facts.push({
        id: { kind: "comment", target: fact.id },
        parent: fact.id,
        payload: { text: comment },
      });
    }
    for (const acl of aclTargets ?? []) {
      facts.push({
        id: { kind: "acl", target: fact.id, grantee: acl.grantee },
        parent: fact.id,
        payload: { privileges: acl.privileges, grantable: acl.grantable },
      });
    }
  };

  /** ACL subquery: aggregated per grantee, sorted, PUBLIC for grantee 0. */
  const aclJson = (aclColumn: string) => `
    (SELECT json_agg(json_build_object(
        'grantee', acl.grantee_name,
        'privileges', acl.privileges,
        'grantable', acl.grantable) ORDER BY acl.grantee_name)
     FROM (
       SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
              array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
              array_agg(e.privilege_type ORDER BY e.privilege_type)
                FILTER (WHERE e.is_grantable) AS grantable
       FROM aclexplode(${aclColumn}) e
       LEFT JOIN pg_roles g ON g.oid = e.grantee
       GROUP BY 1
     ) acl)`;

  const parseAcl = (
    raw: unknown,
  ): { grantee: string; privileges: string[]; grantable: string[] }[] => {
    if (raw == null) return [];
    const entries = raw as {
      grantee: string;
      privileges: string[];
      grantable: string[] | null;
    }[];
    return entries.map((e) => ({
      grantee: e.grantee,
      privileges: e.privileges,
      grantable: e.grantable ?? [],
    }));
  };

  // ── roles (cluster-level) ────────────────────────────────────────────
  for (const row of await q(`
    SELECT r.rolname AS name, r.rolsuper, r.rolinherit, r.rolcreaterole,
           r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname NOT LIKE 'pg\\_%'
    ORDER BY r.rolname`)) {
    facts.push({
      id: { kind: "role", name: String(row["name"]) },
      payload: {
        superuser: Boolean(row["rolsuper"]),
        inherit: Boolean(row["rolinherit"]),
        createRole: Boolean(row["rolcreaterole"]),
        createDb: Boolean(row["rolcreatedb"]),
        login: Boolean(row["rolcanlogin"]),
        replication: Boolean(row["rolreplication"]),
        bypassRls: Boolean(row["rolbypassrls"]),
      },
    });
  }

  // ── schemas ──────────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS name, r.rolname AS owner,
           obj_description(n.oid, 'pg_namespace') AS comment,
           ${aclJson("n.nspacl")} AS acl
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_namespace", "n.oid")}
    ORDER BY n.nspname`)) {
    pushWithMeta(
      {
        id: { kind: "schema", name: String(row["name"]) },
        payload: { owner: String(row["owner"]) },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── extensions (version deliberately excluded from the payload) ─────
  for (const row of await q(`
    SELECT e.extname AS name, n.nspname AS schema,
           obj_description(e.oid, 'pg_extension') AS comment
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname <> 'plpgsql'
    ORDER BY e.extname`)) {
    pushWithMeta(
      {
        id: { kind: "extension", name: String(row["name"]) },
        payload: { schema: String(row["schema"]) },
      },
      row,
    );
  }

  const schemaId = (name: unknown): StableId => ({
    kind: "schema",
    name: String(name),
  });

  // ── tables ───────────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relpersistence AS persistence,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl")} AS acl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('r', 'p') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname`)) {
    pushWithMeta(
      {
        id: {
          kind: "table",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          persistence: String(row["persistence"]),
          rowSecurity: Boolean(row["row_security"]),
          forceRowSecurity: Boolean(row["force_row_security"]),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── columns + defaults (defaults are their own facts, like pg_attrdef) ─
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           NULLIF(a.attidentity, '') AS identity,
           NULLIF(a.attgenerated, '') AS generated,
           CASE WHEN a.attcollation <> t.typcollation THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = a.attcollation)
           END AS collation,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
           col_description(c.oid, a.attnum) AS comment
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, a.attname`)) {
    const tableId: StableId = {
      kind: "table",
      schema: String(row["schema"]),
      name: String(row["table"]),
    };
    const columnId: StableId = {
      kind: "column",
      schema: String(row["schema"]),
      table: String(row["table"]),
      name: String(row["name"]),
    };
    const generated = row["generated"] != null;
    pushWithMeta(
      {
        id: columnId,
        parent: tableId,
        payload: {
          type: String(row["type"]),
          notNull: Boolean(row["not_null"]),
          identity:
            row["identity"] == null ? null : (row["identity"] as string),
          collation:
            row["collation"] == null ? null : (row["collation"] as string),
          generatedExpr:
            generated && row["default_expr"] != null
              ? (row["default_expr"] as string)
              : null,
        },
      },
      row,
    );
    if (!generated && row["default_expr"] != null) {
      facts.push({
        id: {
          kind: "default",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: columnId,
        payload: { expr: row["default_expr"] as string },
      });
    }
  }

  // ── constraints ──────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
           pg_get_constraintdef(con.oid) AS def,
           con.contype AS type, con.convalidated AS validated,
           obj_description(con.oid, 'pg_constraint') AS comment
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype IN ('p', 'u', 'f', 'c', 'x') AND con.conislocal
      AND c.relkind IN ('r', 'p') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, con.conname`)) {
    pushWithMeta(
      {
        id: {
          kind: "constraint",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: {
          kind: "table",
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: {
          def: String(row["def"]),
          type: String(row["type"]),
          validated: Boolean(row["validated"]),
        },
      },
      row,
    );
  }

  // ── indexes (excluding constraint-backed ones) ───────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, ic.relname AS name, c.relname AS table,
           c.relkind AS table_kind,
           pg_get_indexdef(i.indexrelid) AS def,
           obj_description(i.indexrelid, 'pg_class') AS comment
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    WHERE c.relkind IN ('r', 'p', 'm') AND ${USER_SCHEMA_FILTER}
      AND NOT EXISTS (SELECT 1 FROM pg_constraint pc WHERE pc.conindid = i.indexrelid)
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, ic.relname`)) {
    const tableKind =
      String(row["table_kind"]) === "m" ? "materializedView" : "table";
    pushWithMeta(
      {
        id: {
          kind: "index",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: {
          kind: tableKind,
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: { def: String(row["def"]) },
      },
      row,
    );
  }

  // ── sequences (identity-column internals excluded) ───────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           format_type(s.seqtypid, NULL) AS data_type,
           s.seqstart::text AS start, s.seqincrement::text AS increment,
           s.seqmin::text AS min_value, s.seqmax::text AS max_value,
           s.seqcache::text AS cache, s.seqcycle AS cycle,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl")} AS acl
    FROM pg_sequence s
    JOIN pg_class c ON c.oid = s.seqrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype = 'i')
    ORDER BY n.nspname, c.relname`)) {
    pushWithMeta(
      {
        id: {
          kind: "sequence",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          dataType: String(row["data_type"]),
          start: String(row["start"]),
          increment: String(row["increment"]),
          minValue: String(row["min_value"]),
          maxValue: String(row["max_value"]),
          cache: String(row["cache"]),
          cycle: Boolean(row["cycle"]),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── views + materialized views ───────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relkind AS kind,
           pg_get_viewdef(c.oid) AS def,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl")} AS acl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname`)) {
    pushWithMeta(
      {
        id: {
          kind: String(row["kind"]) === "m" ? "materializedView" : "view",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: { owner: String(row["owner"]), def: String(row["def"]) },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── routines (functions + procedures; pg_get_functiondef canonical) ──
  for (const row of await q(`
    SELECT n.nspname AS schema, p.proname AS name, r.rolname AS owner,
           p.prokind AS prokind,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS identity_args,
           pg_get_functiondef(p.oid) AS def,
           obj_description(p.oid, 'pg_proc') AS comment,
           ${aclJson("p.proacl")} AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prokind IN ('f', 'p') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_proc", "p.oid")}
    ORDER BY n.nspname, p.proname`)) {
    const args = (row["identity_args"] as string[]).map(String);
    pushWithMeta(
      {
        id: {
          kind: "procedure",
          schema: String(row["schema"]),
          name: String(row["name"]),
          args,
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          def: String(row["def"]),
          routineKind: String(row["prokind"]),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── triggers ─────────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name,
           pg_get_triggerdef(t.oid) AS def,
           obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, t.tgname`)) {
    pushWithMeta(
      {
        id: {
          kind: "trigger",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: {
          kind: "table",
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: { def: String(row["def"]) },
      },
      row,
    );
  }

  // ── row-level security policies ──────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, pol.polname AS name,
           pol.polcmd AS cmd, pol.polpermissive AS permissive,
           pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           CASE WHEN pol.polroles = '{0}'::oid[] THEN ARRAY['PUBLIC']::text[]
                ELSE ARRAY(SELECT rolname::text FROM pg_roles WHERE oid = ANY(pol.polroles) ORDER BY rolname)
           END AS roles,
           obj_description(pol.oid, 'pg_policy') AS comment
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, pol.polname`)) {
    pushWithMeta(
      {
        id: {
          kind: "policy",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: {
          kind: "table",
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: {
          cmd: String(row["cmd"]),
          permissive: Boolean(row["permissive"]),
          usingExpr:
            row["using_expr"] == null ? null : (row["using_expr"] as string),
          checkExpr:
            row["check_expr"] == null ? null : (row["check_expr"] as string),
          roles: (row["roles"] as string[]).map(String),
        },
      },
      row,
    );
  }

  // ── dependency edges from pg_depend (the authoritative source, P1) ───
  const resolver = `
    CASE
      WHEN cls.classid = 'pg_class'::regclass AND cls.objsubid = 0 THEN COALESCE(
        -- a constraint-backed index is not a fact: resolve to its constraint
        (SELECT json_build_object('kind', 'constraint', 'schema', cn2.nspname,
                                  'table', cc2.relname, 'name', con2.conname)
         FROM pg_constraint con2
         JOIN pg_class cc2 ON cc2.oid = con2.conrelid
         JOIN pg_namespace cn2 ON cn2.oid = cc2.relnamespace
         WHERE con2.conindid = cls.objid AND con2.contype IN ('p','u','x')
         LIMIT 1),
        (SELECT json_build_object(
          'kind', CASE rc.relkind
                    WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
                    WHEN 'v' THEN 'view' WHEN 'm' THEN 'materializedView'
                    WHEN 'i' THEN 'index' WHEN 'I' THEN 'index'
                    WHEN 'S' THEN 'sequence' END,
          'schema', rn.nspname, 'name', rc.relname)
        FROM pg_class rc JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE rc.oid = cls.objid AND rc.relkind IN ('r','p','v','m','i','I','S')))
      WHEN cls.classid = 'pg_class'::regclass AND cls.objsubid > 0 THEN (
        SELECT json_build_object('kind', 'column', 'schema', rn.nspname,
                                 'table', rc.relname, 'name', att.attname)
        FROM pg_class rc
        JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        JOIN pg_attribute att ON att.attrelid = rc.oid AND att.attnum = cls.objsubid
        WHERE rc.oid = cls.objid AND rc.relkind IN ('r','p') AND NOT att.attisdropped)
      WHEN cls.classid = 'pg_proc'::regclass THEN (
        SELECT json_build_object('kind', 'procedure', 'schema', pn.nspname,
                                 'name', pp.proname,
                                 'args', ARRAY(SELECT format_type(t.t, NULL)
                                               FROM unnest(pp.proargtypes) WITH ORDINALITY AS t(t, ord)
                                               ORDER BY t.ord)::text[])
        FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
        WHERE pp.oid = cls.objid AND pp.prokind IN ('f','p'))
      WHEN cls.classid = 'pg_constraint'::regclass THEN (
        SELECT json_build_object('kind', 'constraint', 'schema', cn.nspname,
                                 'table', cc.relname, 'name', con.conname)
        FROM pg_constraint con
        JOIN pg_class cc ON cc.oid = con.conrelid
        JOIN pg_namespace cn ON cn.oid = cc.relnamespace
        WHERE con.oid = cls.objid AND con.conrelid <> 0)
      WHEN cls.classid = 'pg_attrdef'::regclass THEN (
        SELECT json_build_object('kind', 'default', 'schema', dn.nspname,
                                 'table', dc.relname, 'name', da.attname)
        FROM pg_attrdef ad
        JOIN pg_class dc ON dc.oid = ad.adrelid
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        JOIN pg_attribute da ON da.attrelid = ad.adrelid AND da.attnum = ad.adnum
        WHERE ad.oid = cls.objid)
      WHEN cls.classid = 'pg_rewrite'::regclass THEN (
        SELECT json_build_object(
          'kind', CASE vc.relkind WHEN 'm' THEN 'materializedView' ELSE 'view' END,
          'schema', vn.nspname, 'name', vc.relname)
        FROM pg_rewrite rw
        JOIN pg_class vc ON vc.oid = rw.ev_class
        JOIN pg_namespace vn ON vn.oid = vc.relnamespace
        WHERE rw.oid = cls.objid AND vc.relkind IN ('v','m'))
      WHEN cls.classid = 'pg_trigger'::regclass THEN (
        SELECT json_build_object('kind', 'trigger', 'schema', tn.nspname,
                                 'table', tc.relname, 'name', tg.tgname)
        FROM pg_trigger tg
        JOIN pg_class tc ON tc.oid = tg.tgrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tg.oid = cls.objid AND NOT tg.tgisinternal)
      WHEN cls.classid = 'pg_namespace'::regclass THEN (
        SELECT json_build_object('kind', 'schema', 'name', ns.nspname)
        FROM pg_namespace ns WHERE ns.oid = cls.objid)
      ELSE NULL
    END`;

  const dependRows = await q(`
    SELECT
      (SELECT ${resolver} FROM (SELECT d.classid, d.objid, d.objsubid) cls) AS dependent,
      (SELECT ${resolver} FROM (SELECT d.refclassid AS classid, d.refobjid AS objid, d.refobjsubid AS objsubid) cls) AS referenced,
      d.deptype
    FROM pg_depend d
    WHERE d.deptype IN ('n', 'a')`);

  const toId = (raw: unknown): StableId | undefined => {
    if (raw == null) return undefined;
    const o = raw as Record<string, string>;
    switch (o["kind"]) {
      case "schema":
        return { kind: "schema", name: o["name"] as string };
      case "table":
      case "view":
      case "materializedView":
      case "index":
      case "sequence":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          name: o["name"] as string,
        };
      case "column":
      case "constraint":
      case "default":
      case "trigger":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          table: o["table"] as string,
          name: o["name"] as string,
        };
      case "procedure":
        return {
          kind: "procedure",
          schema: o["schema"] as string,
          name: o["name"] as string,
          args: (o["args"] as unknown as string[]).map(String),
        };
      default:
        return undefined;
    }
  };

  const seenEdges = new Set<string>();
  for (const row of dependRows) {
    const from = toId(row["dependent"]);
    const to = toId(row["referenced"]);
    if (!from || !to) continue;
    const key = JSON.stringify([from, to]);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from, to, kind: "depends" });
  }

  const factBase = buildFactBase(facts, edges);
  // dangling edges (e.g. references to unextracted kinds) become diagnostics
  diagnostics.push(...factBase.diagnostics);
  return { factBase, pgVersion, diagnostics };
}
