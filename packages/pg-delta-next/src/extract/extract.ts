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
  type FactSource,
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

export async function extract(
  pool: Pool,
  options: { source?: FactSource } = {},
): Promise<ExtractResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await extractOnClient(client, options.source ?? "liveDb");
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function extractOnClient(
  client: PoolClient,
  source: FactSource,
): Promise<ExtractResult> {
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

  /** ACL subquery: aggregated per grantee, sorted, PUBLIC for grantee 0.
   *  A NULL acl column means "the built-in default" — coalescing through
   *  acldefault() (pg_dump's model) makes NULL and an explicitly
   *  instantiated default extract identically, so a REVOKE that merely
   *  materializes the owner's implicit grant is not a diff. */
  const aclJson = (aclColumn: string, objtype: string, ownerColumn: string) => `
    (SELECT json_agg(json_build_object(
        'grantee', acl.grantee_name,
        'privileges', acl.privileges,
        'grantable', acl.grantable) ORDER BY acl.grantee_name)
     FROM (
       SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
              array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
              array_agg(e.privilege_type ORDER BY e.privilege_type)
                FILTER (WHERE e.is_grantable) AS grantable
       FROM aclexplode(COALESCE(${aclColumn}, acldefault('${objtype}', ${ownerColumn}))) e
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
           r.rolcreatedb, r.rolcanlogin, r.rolreplication, r.rolbypassrls,
           COALESCE((SELECT array_agg(cfg ORDER BY cfg)
                     FROM pg_db_role_setting s, unnest(s.setconfig) cfg
                     WHERE s.setrole = r.oid AND s.setdatabase = 0),
                    '{}')::text[] AS config
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
        config: (row["config"] as string[]).map(String),
      },
    });
  }

  // ── role memberships (cluster-level; multi-grantor rows deduped) ─────
  for (const row of await q(`
    SELECT r1.rolname AS role, r2.rolname AS member,
           bool_or(m.admin_option) AS admin
    FROM pg_auth_members m
    JOIN pg_roles r1 ON r1.oid = m.roleid
    JOIN pg_roles r2 ON r2.oid = m.member
    WHERE r1.rolname NOT LIKE 'pg\\_%' AND r2.rolname NOT LIKE 'pg\\_%'
    GROUP BY 1, 2
    ORDER BY 1, 2`)) {
    facts.push({
      id: {
        kind: "membership",
        role: String(row["role"]),
        member: String(row["member"]),
      },
      payload: { admin: Boolean(row["admin"]) },
    });
  }

  // ── default privileges ───────────────────────────────────────────────
  for (const row of await q(`
    SELECT dr.rolname AS role, n.nspname AS schema, d.defaclobjtype AS objtype,
           acl.grantee_name AS grantee, acl.privileges, acl.grantable
    FROM pg_default_acl d
    JOIN pg_roles dr ON dr.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
    LATERAL (
      SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee_name,
             array_agg(e.privilege_type ORDER BY e.privilege_type) AS privileges,
             array_agg(e.privilege_type ORDER BY e.privilege_type)
               FILTER (WHERE e.is_grantable) AS grantable
      FROM aclexplode(d.defaclacl) e
      LEFT JOIN pg_roles g ON g.oid = e.grantee
      GROUP BY 1
    ) acl
    ORDER BY 1, 2, 3, 4`)) {
    facts.push({
      id: {
        kind: "defaultPrivilege",
        role: String(row["role"]),
        schema: row["schema"] == null ? null : (row["schema"] as string),
        objtype: String(row["objtype"]),
        grantee: String(row["grantee"]),
      },
      payload: {
        privileges: (row["privileges"] as string[]).map(String),
        grantable: ((row["grantable"] as string[] | null) ?? []).map(String),
      },
    });
  }

  // ── schemas ──────────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT n.nspname AS name, r.rolname AS owner,
           obj_description(n.oid, 'pg_namespace') AS comment,
           ${aclJson("n.nspacl", "n", "n.nspowner")} AS acl
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
           c.relreplident AS replica_identity,
           (SELECT ic.relname FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = c.oid AND i.indisreplident) AS replica_identity_index,
           CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
           pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
           (SELECT json_build_object('schema', pn.nspname, 'name', pc.relname)
            FROM pg_inherits inh
            JOIN pg_class pc ON pc.oid = inh.inhparent
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE inh.inhrelid = c.oid
            LIMIT 1) AS parent_table,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl", "r", "c.relowner")} AS acl
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
          replicaIdentity: String(row["replica_identity"]),
          replicaIdentityIndex:
            row["replica_identity_index"] == null
              ? null
              : (row["replica_identity_index"] as string),
          partitionKey:
            row["partition_key"] == null
              ? null
              : (row["partition_key"] as string),
          partitionBound:
            row["partition_bound"] == null
              ? null
              : (row["partition_bound"] as string),
          parentTable:
            row["parent_table"] == null
              ? null
              : (row["parent_table"] as { schema: string; name: string }),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── columns + defaults (defaults are their own facts, like pg_attrdef) ─
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
           c.relkind AS table_kind,
           format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS not_null,
           NULLIF(a.attidentity, '') AS identity,
           (SELECT json_build_object('schema', sn.nspname, 'name', sc.relname)
            FROM pg_depend d
            JOIN pg_class sc ON sc.oid = d.objid
            JOIN pg_namespace sn ON sn.oid = sc.relnamespace
            WHERE d.classid = 'pg_class'::regclass
              AND d.refclassid = 'pg_class'::regclass
              AND d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.deptype = 'i' AND sc.relkind = 'S'
            LIMIT 1) AS identity_sequence,
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
    WHERE c.relkind IN ('r', 'p', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attislocal
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, a.attname`)) {
    const tableId: StableId = {
      kind: String(row["table_kind"]) === "f" ? "foreignTable" : "table",
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
            row["identity"] == null
              ? null
              : {
                  generation: row["identity"] as string,
                  sequence: row["identity_sequence"] as {
                    schema: string;
                    name: string;
                  } | null,
                },
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
      AND NOT EXISTS (SELECT 1 FROM pg_inherits ih WHERE ih.inhrelid = i.indexrelid)
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
           (SELECT json_build_object('schema', tn.nspname, 'table', tc.relname,
                                     'column', ta.attname)
            FROM pg_depend od
            JOIN pg_class tc ON tc.oid = od.refobjid
            JOIN pg_namespace tn ON tn.oid = tc.relnamespace
            JOIN pg_attribute ta ON ta.attrelid = tc.oid AND ta.attnum = od.refobjsubid
            WHERE od.classid = 'pg_class'::regclass AND od.objid = c.oid
              AND od.refclassid = 'pg_class'::regclass AND od.deptype = 'a'
              AND od.refobjsubid > 0
            LIMIT 1) AS owned_by,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl", "s", "c.relowner")} AS acl
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
          ownedBy:
            row["owned_by"] == null
              ? null
              : (row["owned_by"] as {
                  schema: string;
                  table: string;
                  column: string;
                }),
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
           ${aclJson("c.relacl", "r", "c.relowner")} AS acl
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
           ${aclJson("p.proacl", "f", "p.proowner")} AS acl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prokind IN ('f', 'p') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_proc", "p.oid")}
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend idep
        WHERE idep.classid = 'pg_proc'::regclass AND idep.objid = p.oid
          AND idep.deptype = 'i')
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
           c.relkind AS table_kind,
           pg_get_triggerdef(t.oid) AS def,
           t.tgenabled AS enabled,
           obj_description(t.oid, 'pg_trigger') AS comment
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND t.tgparentid = 0 AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, t.tgname`)) {
    const relkind = String(row["table_kind"]);
    pushWithMeta(
      {
        id: {
          kind: "trigger",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: {
          kind:
            relkind === "v"
              ? "view"
              : relkind === "m"
                ? "materializedView"
                : relkind === "f"
                  ? "foreignTable"
                  : "table",
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: {
          def: String(row["def"]),
          enabled: String(row["enabled"]),
        },
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

  // ── domains (+ their CHECK constraints as facts) ─────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           format_type(t.typbasetype, t.typtypmod) AS base_type,
           t.typnotnull AS not_null, t.typdefault AS default_expr,
           CASE WHEN t.typcollation <> bt.typcollation THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = t.typcollation)
           END AS collation,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJson("t.typacl", "T", "t.typowner")} AS acl
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    JOIN pg_type bt ON bt.oid = t.typbasetype
    WHERE t.typtype = 'd' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname`)) {
    pushWithMeta(
      {
        id: {
          kind: "domain",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          baseType: String(row["base_type"]),
          notNull: Boolean(row["not_null"]),
          default:
            row["default_expr"] == null
              ? null
              : (row["default_expr"] as string),
          collation:
            row["collation"] == null ? null : (row["collation"] as string),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS domain, con.conname AS name,
           pg_get_constraintdef(con.oid) AS def,
           con.contype AS type, con.convalidated AS validated,
           obj_description(con.oid, 'pg_constraint') AS comment
    FROM pg_constraint con
    JOIN pg_type t ON t.oid = con.contypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE con.contypid <> 0 AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname, con.conname`)) {
    pushWithMeta(
      {
        id: {
          kind: "constraint",
          schema: String(row["schema"]),
          table: String(row["domain"]),
          name: String(row["name"]),
        },
        parent: {
          kind: "domain",
          schema: String(row["schema"]),
          name: String(row["domain"]),
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

  // ── types: enums, standalone composites, ranges ──────────────────────
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           ARRAY(SELECT e.enumlabel::text FROM pg_enum e
                 WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder) AS values,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJson("t.typacl", "T", "t.typowner")} AS acl
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE t.typtype = 'e' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname`)) {
    pushWithMeta(
      {
        id: {
          kind: "type",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          variant: "enum",
          owner: String(row["owner"]),
          values: (row["values"] as string[]).map(String),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           (SELECT json_agg(json_build_object(
              'name', a.attname,
              'type', format_type(a.atttypid, a.atttypmod),
              'collation', CASE WHEN a.attcollation <> at.typcollation THEN (
                SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
                FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
                WHERE co.oid = a.attcollation) END
            ) ORDER BY a.attnum)
            FROM pg_attribute a
            JOIN pg_type at ON at.oid = a.atttypid
            WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) AS attrs,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJson("t.typacl", "T", "t.typowner")} AS acl
    FROM pg_type t
    JOIN pg_class tc ON tc.oid = t.typrelid AND tc.relkind = 'c'
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE t.typtype = 'c' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname`)) {
    pushWithMeta(
      {
        id: {
          kind: "type",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          variant: "composite",
          owner: String(row["owner"]),
          attributes:
            (row["attrs"] as
              | { name: string; type: string; collation: string | null }[]
              | null) ?? [],
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, t.typname AS name, r.rolname AS owner,
           format_type(rng.rngsubtype, NULL) AS subtype,
           CASE WHEN rng.rngcollation <> 0 THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = rng.rngcollation) END AS collation,
           CASE WHEN rng.rngsubdiff <> 0 THEN rng.rngsubdiff::regproc::text END AS subtype_diff,
           obj_description(t.oid, 'pg_type') AS comment,
           ${aclJson("t.typacl", "T", "t.typowner")} AS acl
    FROM pg_range rng
    JOIN pg_type t ON t.oid = rng.rngtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE t.typtype = 'r' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_type", "t.oid")}
    ORDER BY n.nspname, t.typname`)) {
    pushWithMeta(
      {
        id: {
          kind: "type",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          variant: "range",
          owner: String(row["owner"]),
          subtype: String(row["subtype"]),
          collation:
            row["collation"] == null ? null : (row["collation"] as string),
          subtypeDiff:
            row["subtype_diff"] == null
              ? null
              : (row["subtype_diff"] as string),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── collations (collversion deliberately excluded from equality) ─────
  for (const row of await q(`
    SELECT n.nspname AS schema, c.collname AS name, r.rolname AS owner,
           c.collprovider AS provider, c.collisdeterministic AS deterministic,
           to_jsonb(c) AS raw,
           obj_description(c.oid, 'pg_collation') AS comment
    FROM pg_collation c
    JOIN pg_namespace n ON n.oid = c.collnamespace
    JOIN pg_roles r ON r.oid = c.collowner
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_collation", "c.oid")}
    ORDER BY n.nspname, c.collname`)) {
    const raw = row["raw"] as Record<string, unknown>;
    const locale =
      (raw["colllocale"] as string | null) ??
      (raw["colliculocale"] as string | null) ??
      null;
    pushWithMeta(
      {
        id: {
          kind: "collation",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          provider: String(row["provider"]),
          deterministic: Boolean(row["deterministic"]),
          locale,
          lcCollate: (raw["collcollate"] as string | null) ?? null,
          lcCtype: (raw["collctype"] as string | null) ?? null,
        },
      },
      row,
    );
  }

  // ── event triggers ───────────────────────────────────────────────────
  for (const row of await q(`
    SELECT e.evtname AS name, e.evtevent AS event, e.evtenabled AS enabled,
           COALESCE(e.evttags, '{}')::text[] AS tags,
           pn.nspname AS func_schema, p.proname AS func_name,
           r.rolname AS owner,
           obj_description(e.oid, 'pg_event_trigger') AS comment
    FROM pg_event_trigger e
    JOIN pg_proc p ON p.oid = e.evtfoid
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = e.evtowner
    WHERE ${notExtensionMember("pg_event_trigger", "e.oid")}
    ORDER BY e.evtname`)) {
    pushWithMeta(
      {
        id: { kind: "eventTrigger", name: String(row["name"]) },
        payload: {
          event: String(row["event"]),
          enabled: String(row["enabled"]),
          tags: (row["tags"] as string[]).map(String).sort(),
          owner: String(row["owner"]),
          functionSchema: String(row["func_schema"]),
          functionName: String(row["func_name"]),
        },
      },
      row,
    );
  }

  // ── rewrite rules (user rules; the view _RETURN rule is the view def) ─
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS table, c.relkind AS table_kind,
           rw.rulename AS name, pg_get_ruledef(rw.oid) AS def,
           rw.ev_enabled AS enabled,
           obj_description(rw.oid, 'pg_rewrite') AS comment
    FROM pg_rewrite rw
    JOIN pg_class c ON c.oid = rw.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE rw.rulename <> '_RETURN' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, rw.rulename`)) {
    const relkind = String(row["table_kind"]);
    pushWithMeta(
      {
        id: {
          kind: "rule",
          schema: String(row["schema"]),
          table: String(row["table"]),
          name: String(row["name"]),
        },
        parent: {
          kind:
            relkind === "v"
              ? "view"
              : relkind === "m"
                ? "materializedView"
                : "table",
          schema: String(row["schema"]),
          name: String(row["table"]),
        },
        payload: { def: String(row["def"]), enabled: String(row["enabled"]) },
      },
      row,
    );
  }

  // ── aggregates (CREATE AGGREGATE is reconstructed from pg_aggregate) ─
  for (const row of await q(`
    SELECT n.nspname AS schema, p.proname AS name, r.rolname AS owner,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS identity_args,
           a.aggkind AS agg_kind, a.aggnumdirectargs AS num_direct_args,
           a.aggtransfn::regproc::text AS sfunc,
           format_type(a.aggtranstype, NULL) AS stype,
           CASE WHEN a.aggfinalfn <> 0 THEN a.aggfinalfn::regproc::text END AS finalfunc,
           a.agginitval AS initcond,
           obj_description(p.oid, 'pg_proc') AS comment,
           ${aclJson("p.proacl", "f", "p.proowner")} AS acl
    FROM pg_proc p
    JOIN pg_aggregate a ON a.aggfnoid = p.oid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prokind = 'a' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_proc", "p.oid")}
    ORDER BY n.nspname, p.proname`)) {
    pushWithMeta(
      {
        id: {
          kind: "aggregate",
          schema: String(row["schema"]),
          name: String(row["name"]),
          args: (row["identity_args"] as string[]).map(String),
        },
        parent: schemaId(row["schema"]),
        payload: {
          owner: String(row["owner"]),
          aggKind: String(row["agg_kind"]),
          numDirectArgs: Number(row["num_direct_args"]),
          sfunc: String(row["sfunc"]),
          stype: String(row["stype"]),
          finalfunc:
            row["finalfunc"] == null ? null : (row["finalfunc"] as string),
          initcond:
            row["initcond"] == null ? null : (row["initcond"] as string),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── foreign data wrappers / servers / user mappings / foreign tables ─
  for (const row of await q(`
    SELECT f.fdwname AS name, r.rolname AS owner,
           CASE WHEN f.fdwhandler <> 0 THEN f.fdwhandler::regproc::text END AS handler,
           CASE WHEN f.fdwvalidator <> 0 THEN f.fdwvalidator::regproc::text END AS validator,
           COALESCE(ARRAY(SELECT opt FROM unnest(f.fdwoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(f.oid, 'pg_foreign_data_wrapper') AS comment,
           ${aclJson("f.fdwacl", "F", "f.fdwowner")} AS acl
    FROM pg_foreign_data_wrapper f
    JOIN pg_roles r ON r.oid = f.fdwowner
    WHERE ${notExtensionMember("pg_foreign_data_wrapper", "f.oid")}
    ORDER BY f.fdwname`)) {
    pushWithMeta(
      {
        id: { kind: "fdw", name: String(row["name"]) },
        payload: {
          owner: String(row["owner"]),
          handler: row["handler"] == null ? null : (row["handler"] as string),
          validator:
            row["validator"] == null ? null : (row["validator"] as string),
          options: (row["options"] as string[]).map(String),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }
  for (const row of await q(`
    SELECT s.srvname AS name, f.fdwname AS fdw, r.rolname AS owner,
           s.srvtype AS type, s.srvversion AS version,
           (SELECT e.extname FROM pg_depend d
            JOIN pg_extension e ON e.oid = d.refobjid
            WHERE d.classid = 'pg_foreign_data_wrapper'::regclass
              AND d.objid = f.oid
              AND d.refclassid = 'pg_extension'::regclass
              AND d.deptype = 'e'
            LIMIT 1) AS fdw_extension,
           COALESCE(ARRAY(SELECT opt FROM unnest(s.srvoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(s.oid, 'pg_foreign_server') AS comment,
           ${aclJson("s.srvacl", "S", "s.srvowner")} AS acl
    FROM pg_foreign_server s
    JOIN pg_foreign_data_wrapper f ON f.oid = s.srvfdw
    JOIN pg_roles r ON r.oid = s.srvowner
    WHERE ${notExtensionMember("pg_foreign_server", "s.oid")}
    ORDER BY s.srvname`)) {
    pushWithMeta(
      {
        id: { kind: "server", name: String(row["name"]) },
        // an extension-provided FDW has no fact of its own — parent the
        // server to the extension instead so the reference resolves
        parent:
          row["fdw_extension"] != null
            ? { kind: "extension", name: row["fdw_extension"] as string }
            : { kind: "fdw", name: String(row["fdw"]) },
        payload: {
          owner: String(row["owner"]),
          fdw: String(row["fdw"]),
          type: row["type"] == null ? null : (row["type"] as string),
          version: row["version"] == null ? null : (row["version"] as string),
          options: (row["options"] as string[]).map(String),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }
  for (const row of await q(`
    SELECT s.srvname AS server, COALESCE(r.rolname, 'PUBLIC') AS role,
           COALESCE(ARRAY(SELECT opt FROM unnest(u.umoptions) opt ORDER BY opt), '{}')::text[] AS options
    FROM pg_user_mapping u
    JOIN pg_foreign_server s ON s.oid = u.umserver
    LEFT JOIN pg_roles r ON r.oid = u.umuser
    ORDER BY s.srvname, 2`)) {
    facts.push({
      id: {
        kind: "userMapping",
        server: String(row["server"]),
        role: String(row["role"]),
      },
      parent: { kind: "server", name: String(row["server"]) },
      payload: { options: (row["options"] as string[]).map(String) },
    });
  }
  for (const row of await q(`
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           s.srvname AS server,
           COALESCE(ARRAY(SELECT opt FROM unnest(ft.ftoptions) opt ORDER BY opt), '{}')::text[] AS options,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJson("c.relacl", "r", "c.relowner")} AS acl
    FROM pg_foreign_table ft
    JOIN pg_class c ON c.oid = ft.ftrelid
    JOIN pg_foreign_server s ON s.oid = ft.ftserver
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname`)) {
    pushWithMeta(
      {
        id: {
          kind: "foreignTable",
          schema: String(row["schema"]),
          name: String(row["name"]),
        },
        parent: { kind: "server", name: String(row["server"]) },
        payload: {
          owner: String(row["owner"]),
          server: String(row["server"]),
          options: (row["options"] as string[]).map(String),
        },
      },
      row,
      parseAcl(row["acl"]),
    );
  }

  // ── publications ─────────────────────────────────────────────────────
  for (const row of await q(`
    SELECT p.pubname AS name, r.rolname AS owner,
           p.puballtables AS all_tables, p.pubviaroot AS via_root,
           p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
           (SELECT json_agg(json_build_object(
              'schema', pn.nspname, 'name', pc.relname,
              'columns', (SELECT array_agg(att.attname::text ORDER BY att.attname)
                          FROM unnest(pr.prattrs) WITH ORDINALITY AS pa(attnum, ord)
                          JOIN pg_attribute att ON att.attrelid = pc.oid AND att.attnum = pa.attnum),
              'where', pg_get_expr(pr.prqual, pr.prrelid)
            ) ORDER BY pn.nspname, pc.relname)
            FROM pg_publication_rel pr
            JOIN pg_class pc ON pc.oid = pr.prrelid
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE pr.prpubid = p.oid) AS tables,
           (SELECT array_agg(pn2.nspname::text ORDER BY 1)
            FROM pg_publication_namespace pns
            JOIN pg_namespace pn2 ON pn2.oid = pns.pnnspid
            WHERE pns.pnpubid = p.oid) AS schemas,
           obj_description(p.oid, 'pg_publication') AS comment
    FROM pg_publication p
    JOIN pg_roles r ON r.oid = p.pubowner
    WHERE ${notExtensionMember("pg_publication", "p.oid")}
    ORDER BY p.pubname`)) {
    const publish: string[] = [];
    if (row["pubinsert"]) publish.push("insert");
    if (row["pubupdate"]) publish.push("update");
    if (row["pubdelete"]) publish.push("delete");
    if (row["pubtruncate"]) publish.push("truncate");
    pushWithMeta(
      {
        id: { kind: "publication", name: String(row["name"]) },
        payload: {
          owner: String(row["owner"]),
          allTables: Boolean(row["all_tables"]),
          viaRoot: Boolean(row["via_root"]),
          publish,
          tables:
            (row["tables"] as
              | {
                  schema: string;
                  name: string;
                  columns: string[] | null;
                  where: string | null;
                }[]
              | null) ?? [],
          schemas: ((row["schemas"] as string[] | null) ?? []).map(String),
        },
      },
      row,
    );
  }

  // ── subscriptions (database-local rows only) ─────────────────────────
  for (const row of await q(`
    SELECT s.subname AS name, r.rolname AS owner, s.subenabled AS enabled,
           s.subconninfo AS conninfo, s.subslotname AS slot_name,
           s.subpublications::text[] AS publications,
           obj_description(s.oid, 'pg_subscription') AS comment
    FROM pg_subscription s
    JOIN pg_roles r ON r.oid = s.subowner
    JOIN pg_database d ON d.oid = s.subdbid
    WHERE d.datname = current_database()
    ORDER BY s.subname`)) {
    pushWithMeta(
      {
        id: { kind: "subscription", name: String(row["name"]) },
        payload: {
          owner: String(row["owner"]),
          enabled: Boolean(row["enabled"]),
          conninfo: String(row["conninfo"]),
          slotName:
            row["slot_name"] == null ? null : (row["slot_name"] as string),
          publications: (row["publications"] as string[]).map(String).sort(),
        },
      },
      row,
    );
  }

  // ── security labels (satellite facts, like comments) ────────────────
  // pg_seclabel / pg_shseclabel are EMPTY unless a label provider module
  // labeled something, so this is inert on label-free databases. The
  // target's identity parts come back as a resolved StableId built inline.
  const pushSeclabel = (
    target: StableId,
    provider: string,
    label: string,
  ): void => {
    facts.push({
      id: { kind: "securityLabel", target, provider },
      parent: target,
      payload: { label },
    });
  };
  // relations (tables/views/matviews/sequences/foreign tables) + columns
  for (const row of await q(`
    SELECT sl.provider, sl.label, sl.objsubid,
           n.nspname AS schema, c.relname AS name, c.relkind AS relkind,
           a.attname AS column
    FROM pg_seclabel sl
    JOIN pg_class c ON c.oid = sl.objoid AND sl.classoid = 'pg_class'::regclass
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = sl.objsubid
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY 1, 4, 5`)) {
    const schema = String(row["schema"]);
    const relkind = String(row["relkind"]);
    if (Number(row["objsubid"]) > 0) {
      pushSeclabel(
        {
          kind: "column",
          schema,
          table: String(row["name"]),
          name: String(row["column"]),
        },
        String(row["provider"]),
        String(row["label"]),
      );
      continue;
    }
    const relKindMap: Record<string, StableId["kind"]> = {
      r: "table",
      p: "table",
      v: "view",
      m: "materializedView",
      S: "sequence",
      f: "foreignTable",
    };
    const kind = relKindMap[relkind];
    if (kind === undefined) continue;
    pushSeclabel(
      { kind, schema, name: String(row["name"]) } as StableId,
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // routines
  for (const row of await q(`
    SELECT sl.provider, sl.label, n.nspname AS schema, p.proname AS name,
           p.prokind AS prokind,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS args
    FROM pg_seclabel sl
    JOIN pg_proc p ON p.oid = sl.objoid AND sl.classoid = 'pg_proc'::regclass
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY 1, 3, 4`)) {
    pushSeclabel(
      {
        kind: String(row["prokind"]) === "a" ? "aggregate" : "procedure",
        schema: String(row["schema"]),
        name: String(row["name"]),
        args: (row["args"] as string[]).map(String),
      },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // schemas, types/domains
  for (const row of await q(`
    SELECT sl.provider, sl.label, n.nspname AS name
    FROM pg_seclabel sl
    JOIN pg_namespace n ON n.oid = sl.objoid AND sl.classoid = 'pg_namespace'::regclass
    WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS} AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "schema", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  for (const row of await q(`
    SELECT sl.provider, sl.label, n.nspname AS schema, t.typname AS name,
           t.typtype AS typtype
    FROM pg_seclabel sl
    JOIN pg_type t ON t.oid = sl.objoid AND sl.classoid = 'pg_type'::regclass
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY 1, 3, 4`)) {
    pushSeclabel(
      {
        kind: String(row["typtype"]) === "d" ? "domain" : "type",
        schema: String(row["schema"]),
        name: String(row["name"]),
      },
      String(row["provider"]),
      String(row["label"]),
    );
  }
  // roles (shared catalog)
  for (const row of await q(`
    SELECT sl.provider, sl.label, r.rolname AS name
    FROM pg_shseclabel sl
    JOIN pg_authid r ON r.oid = sl.objoid AND sl.classoid = 'pg_authid'::regclass
    WHERE r.rolname NOT LIKE 'pg\\_%'
    ORDER BY 1, 3`)) {
    pushSeclabel(
      { kind: "role", name: String(row["name"]) },
      String(row["provider"]),
      String(row["label"]),
    );
  }

  // ── inheritance / partition edges (child depends on parent) ──────────
  for (const row of await q(`
    SELECT cn.nspname AS child_schema, cc.relname AS child_name,
           pn.nspname AS parent_schema, pc.relname AS parent_name
    FROM pg_inherits i
    JOIN pg_class cc ON cc.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = cc.relnamespace
    JOIN pg_class pc ON pc.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    WHERE cc.relkind IN ('r', 'p')
      AND cn.nspname NOT IN ${SYSTEM_SCHEMAS}`)) {
    edges.push({
      from: {
        kind: "table",
        schema: String(row["child_schema"]),
        name: String(row["child_name"]),
      },
      to: {
        kind: "table",
        schema: String(row["parent_schema"]),
        name: String(row["parent_name"]),
      },
      kind: "depends",
    });
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
      WHEN cls.classid = 'pg_class'::regclass AND cls.objsubid > 0 THEN COALESCE(
        (SELECT json_build_object('kind', 'column', 'schema', rn.nspname,
                                 'table', rc.relname, 'name', att.attname)
        FROM pg_class rc
        JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        JOIN pg_attribute att ON att.attrelid = rc.oid AND att.attnum = cls.objsubid
        WHERE rc.oid = cls.objid AND rc.relkind IN ('r','p','f') AND NOT att.attisdropped),
        -- view/matview columns are not facts: resolve to the relation
        (SELECT json_build_object(
           'kind', CASE rc.relkind WHEN 'm' THEN 'materializedView' ELSE 'view' END,
           'schema', rn.nspname, 'name', rc.relname)
        FROM pg_class rc JOIN pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE rc.oid = cls.objid AND rc.relkind IN ('v','m')))
      WHEN cls.classid = 'pg_proc'::regclass THEN COALESCE(
        -- extension-member routines are not facts: resolve to the extension
        (SELECT json_build_object('kind', 'extension', 'name', ext.extname)
         FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
         WHERE ed.classid = 'pg_proc'::regclass AND ed.objid = cls.objid
           AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
         LIMIT 1),
        (SELECT json_build_object(
                 'kind', CASE pp.prokind WHEN 'a' THEN 'aggregate' ELSE 'procedure' END,
                 'schema', pn.nspname,
                 'name', pp.proname,
                 'args', ARRAY(SELECT format_type(t.t, NULL)
                               FROM unnest(pp.proargtypes) WITH ORDINALITY AS t(t, ord)
                               ORDER BY t.ord)::text[])
        FROM pg_proc pp JOIN pg_namespace pn ON pn.oid = pp.pronamespace
        WHERE pp.oid = cls.objid AND pp.prokind IN ('f','p','a')))
      WHEN cls.classid = 'pg_constraint'::regclass THEN COALESCE(
        (SELECT json_build_object('kind', 'constraint', 'schema', cn.nspname,
                                  'table', cc.relname, 'name', con.conname)
         FROM pg_constraint con
         JOIN pg_class cc ON cc.oid = con.conrelid
         JOIN pg_namespace cn ON cn.oid = cc.relnamespace
         WHERE con.oid = cls.objid AND con.conrelid <> 0),
        (SELECT json_build_object('kind', 'constraint', 'schema', dn.nspname,
                                  'table', dt.typname, 'name', con.conname)
         FROM pg_constraint con
         JOIN pg_type dt ON dt.oid = con.contypid
         JOIN pg_namespace dn ON dn.oid = dt.typnamespace
         WHERE con.oid = cls.objid AND con.contypid <> 0))
      WHEN cls.classid = 'pg_type'::regclass THEN COALESCE(
        (SELECT json_build_object('kind', 'extension', 'name', ext.extname)
         FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
         WHERE ed.classid = 'pg_type'::regclass AND ed.objid = cls.objid
           AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
         LIMIT 1),
        (SELECT json_build_object(
                 'kind', CASE tt.typtype WHEN 'd' THEN 'domain' ELSE 'type' END,
                 'schema', tn.nspname, 'name', tt.typname)
        FROM pg_type tt JOIN pg_namespace tn ON tn.oid = tt.typnamespace
        WHERE tt.oid = cls.objid AND tt.typtype IN ('d','e','c','r')))
      WHEN cls.classid = 'pg_opclass'::regclass THEN (
        SELECT json_build_object('kind', 'extension', 'name', ext.extname)
        FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
        WHERE ed.classid = 'pg_opclass'::regclass AND ed.objid = cls.objid
          AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
        LIMIT 1)
      WHEN cls.classid = 'pg_opfamily'::regclass THEN (
        SELECT json_build_object('kind', 'extension', 'name', ext.extname)
        FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
        WHERE ed.classid = 'pg_opfamily'::regclass AND ed.objid = cls.objid
          AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
        LIMIT 1)
      WHEN cls.classid = 'pg_operator'::regclass THEN (
        SELECT json_build_object('kind', 'extension', 'name', ext.extname)
        FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
        WHERE ed.classid = 'pg_operator'::regclass AND ed.objid = cls.objid
          AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
        LIMIT 1)
      WHEN cls.classid = 'pg_collation'::regclass THEN (
        SELECT json_build_object('kind', 'collation', 'schema', cln.nspname,
                                 'name', cl.collname)
        FROM pg_collation cl JOIN pg_namespace cln ON cln.oid = cl.collnamespace
        WHERE cl.oid = cls.objid)
      WHEN cls.classid = 'pg_policy'::regclass THEN (
        SELECT json_build_object('kind', 'policy', 'schema', poln.nspname,
                                 'table', polc.relname, 'name', pol.polname)
        FROM pg_policy pol
        JOIN pg_class polc ON polc.oid = pol.polrelid
        JOIN pg_namespace poln ON poln.oid = polc.relnamespace
        WHERE pol.oid = cls.objid)
      WHEN cls.classid = 'pg_event_trigger'::regclass THEN (
        SELECT json_build_object('kind', 'eventTrigger', 'name', evt.evtname)
        FROM pg_event_trigger evt WHERE evt.oid = cls.objid)
      WHEN cls.classid = 'pg_publication'::regclass THEN (
        SELECT json_build_object('kind', 'publication', 'name', pub.pubname)
        FROM pg_publication pub WHERE pub.oid = cls.objid)
      WHEN cls.classid = 'pg_publication_rel'::regclass THEN (
        SELECT json_build_object('kind', 'publication', 'name', pub2.pubname)
        FROM pg_publication_rel pr2
        JOIN pg_publication pub2 ON pub2.oid = pr2.prpubid
        WHERE pr2.oid = cls.objid)
      WHEN cls.classid = 'pg_foreign_data_wrapper'::regclass THEN COALESCE(
        -- extension-member FDWs are not facts: resolve to the extension
        (SELECT json_build_object('kind', 'extension', 'name', ext.extname)
         FROM pg_depend ed JOIN pg_extension ext ON ext.oid = ed.refobjid
         WHERE ed.classid = 'pg_foreign_data_wrapper'::regclass
           AND ed.objid = cls.objid
           AND ed.refclassid = 'pg_extension'::regclass AND ed.deptype = 'e'
         LIMIT 1),
        (SELECT json_build_object('kind', 'fdw', 'name', fd.fdwname)
         FROM pg_foreign_data_wrapper fd WHERE fd.oid = cls.objid))
      WHEN cls.classid = 'pg_foreign_server'::regclass THEN (
        SELECT json_build_object('kind', 'server', 'name', fs.srvname)
        FROM pg_foreign_server fs WHERE fs.oid = cls.objid)
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
    WHERE d.deptype IN ('n', 'a')
      -- sequence OWNED BY is carried as payload + ALTER SEQUENCE … OWNED BY
      -- (pg_dump's model); the auto edge would cycle with the column default
      AND NOT (d.deptype = 'a'
               AND d.classid = 'pg_class'::regclass
               AND d.refclassid = 'pg_class'::regclass
               AND d.refobjsubid > 0
               AND EXISTS (SELECT 1 FROM pg_class sc
                           WHERE sc.oid = d.objid AND sc.relkind = 'S'))`);

  const toId = (raw: unknown): StableId | undefined => {
    if (raw == null) return undefined;
    const o = raw as Record<string, string>;
    switch (o["kind"]) {
      case "schema":
        return { kind: "schema", name: o["name"] as string };
      case "eventTrigger":
      case "publication":
      case "fdw":
      case "server":
      case "extension":
        return { kind: o["kind"], name: o["name"] as string };
      case "table":
      case "view":
      case "materializedView":
      case "index":
      case "sequence":
      case "domain":
      case "type":
      case "collation":
      case "foreignTable":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          name: o["name"] as string,
        };
      case "column":
      case "constraint":
      case "default":
      case "trigger":
      case "policy":
      case "rule":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          table: o["table"] as string,
          name: o["name"] as string,
        };
      case "procedure":
      case "aggregate":
        return {
          kind: o["kind"],
          schema: o["schema"] as string,
          name: o["name"] as string,
          args: (o["args"] as unknown as string[]).map(String),
        };
      default:
        return undefined;
    }
  };

  // A pg_depend endpoint resolves to one of three things:
  //  - null JSON      → a built-in / unmodeled object (pg_catalog type, …):
  //                     legitimately skipped, NOT a gap.
  //  - structured obj → a user object the resolver recognized; toId must
  //                     produce its id. If toId returns undefined here the
  //                     resolver and the codec disagree — a real extraction
  //                     gap, surfaced as a diagnostic (stage-2 doctrine).
  //  - resolved id whose fact is absent → a dangling edge, already turned
  //                     into a diagnostic by the FactBase constructor.
  const resolveEndpoint = (
    raw: unknown,
    role: string,
  ): StableId | undefined => {
    if (raw == null) return undefined; // built-in / unmodeled — skip quietly
    const id = toId(raw);
    if (id === undefined) {
      diagnostics.push({
        code: "unresolved_dependency",
        severity: "warning",
        message: `pg_depend ${role} ${JSON.stringify(raw)} was recognized by the resolver but the codec could not build its id — resolver/codec mismatch`,
      });
    }
    return id;
  };
  const seenEdges = new Set<string>();
  for (const row of dependRows) {
    const from = resolveEndpoint(row["dependent"], "dependent");
    const to = resolveEndpoint(row["referenced"], "referenced");
    if (!from || !to) continue;
    const key = JSON.stringify([from, to]);
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from, to, kind: "depends" });
  }

  const factBase = buildFactBase(facts, edges, source);
  // dangling edges (e.g. references to unextracted kinds) become diagnostics
  diagnostics.push(...factBase.diagnostics);
  return { factBase, pgVersion, diagnostics };
}
