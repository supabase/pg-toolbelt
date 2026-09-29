/** Relations and their sub-objects: tables, columns + defaults, table
 *  constraints, indexes, sequences, views + materialized views, triggers, and
 *  rewrite rules. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJson,
  aclJsonMemberAware,
  type CatalogFamily,
  deparsedDef,
  memberExtensionExpr,
  notExtensionMember,
  parseAcl,
  schemaId,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

/** Canonicalize pg_class.reloptions (a text[] of `key=value`) to a sorted array
 *  so the payload hash is order-independent, or null when there are none. */
function reloptions(row: Record<string, unknown>): string[] | null {
  const raw = row["reloptions"];
  if (raw == null) return null;
  const arr = (raw as string[]).slice().sort();
  return arr.length > 0 ? arr : null;
}

const TABLES_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relpersistence AS persistence,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security,
           c.relreplident AS replica_identity,
           (SELECT ic.relname FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            WHERE i.indrelid = c.oid AND i.indisreplident) AS replica_identity_index,
           CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END AS partition_key,
           c.reloptions AS reloptions,
           pg_get_expr(c.relpartbound, c.oid) AS partition_bound,
           (SELECT json_build_object('schema', pn.nspname, 'name', pc.relname)
            FROM pg_inherits inh
            JOIN pg_class pc ON pc.oid = inh.inhparent
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE inh.inhrelid = c.oid
            -- Multi-parent support is tracked separately; until then capture the
            -- FIRST-declared parent deterministically. Without ORDER BY the
            -- unordered LIMIT 1 can pick a different parent across extractions,
            -- flapping the fact hash and causing spurious table replaces.
            ORDER BY inh.inhseqno
            LIMIT 1) AS parent_table,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJsonMemberAware("c.relacl", "r", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('r', 'p') AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, c.relname`;

export const tablesFamily: CatalogFamily = {
  name: "tables",
  statements: () => [TABLES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: "table",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
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
            // partitionBound + parentTable are policy-API surface, not just hash
            // substance: the `partitionOf` predicate (src/policy/policy.ts)
            // matches on these exact payload field names. Renaming either
            // silently un-matches every partitionOf rule — no validatePolicy
            // error fires.
            partitionBound:
              row["partition_bound"] == null
                ? null
                : (row["partition_bound"] as string),
            parentTable:
              row["parent_table"] == null
                ? null
                : (row["parent_table"] as { schema: string; name: string }),
            reloptions: reloptions(row),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

// ── columns + defaults (defaults are their own facts, like pg_attrdef) ─

const COLUMNS_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS name,
           a.attnum AS position,
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
           (SELECT json_build_object(
                     'increment', sq.seqincrement::text, 'start', sq.seqstart::text,
                     'minValue', sq.seqmin::text, 'maxValue', sq.seqmax::text,
                     'cache', sq.seqcache::text, 'cycle', sq.seqcycle)
            FROM pg_depend d
            JOIN pg_sequence sq ON sq.seqrelid = d.objid
            WHERE d.classid = 'pg_class'::regclass
              AND d.refclassid = 'pg_class'::regclass
              AND d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.deptype = 'i'
            LIMIT 1) AS identity_options,
           -- ACL of the identity column's backing sequence. The sequence is not a
           -- fact of its own (it lives and dies with the column), so its grants
           -- ride on the column as acl satellites targeting the sequence.
           (SELECT ${aclJson("sc.relacl", "s", "sc.relowner")}
            FROM pg_depend d
            JOIN pg_class sc ON sc.oid = d.objid
            WHERE d.classid = 'pg_class'::regclass
              AND d.refclassid = 'pg_class'::regclass
              AND d.refobjid = c.oid AND d.refobjsubid = a.attnum
              AND d.deptype = 'i' AND sc.relkind = 'S'
            LIMIT 1) AS identity_sequence_acl,
           NULLIF(a.attgenerated, '') AS generated,
           -- Postgres records each partition key column as an internal
           -- dependency of its own table. This covers plain key columns and
           -- columns used in a key expression. The check walks the whole
           -- partition tree, because ALTER COLUMN ... TYPE on the root
           -- recurses into sub-partitions and fails on their keys too.
           -- Partitions match columns by name, since attnum can differ.
           CASE WHEN c.relkind = 'p' THEN EXISTS (
             SELECT 1
             FROM pg_partition_tree(c.oid) pt
             JOIN pg_attribute pa ON pa.attrelid = pt.relid AND pa.attname = a.attname
             JOIN pg_depend d ON d.classid = 'pg_class'::regclass
               AND d.objid = pt.relid AND d.objsubid = pa.attnum
               AND d.refclassid = 'pg_class'::regclass
               AND d.refobjid = pt.relid AND d.refobjsubid = 0
               AND d.deptype = 'i')
           ELSE false END AS partition_key,
           CASE WHEN a.attcollation <> t.typcollation THEN (
             SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname)
             FROM pg_collation co JOIN pg_namespace cn ON cn.oid = co.collnamespace
             WHERE co.oid = a.attcollation)
           END AS collation,
           pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
           col_description(c.oid, a.attnum) AS comment,
           -- column-level ACL (pg_attribute.attacl). Columns have no built-in
           -- default privileges, so acldefault('c', owner) is empty: a NULL
           -- attacl yields no acl facts, and a non-NULL one lists only explicit
           -- GRANT SELECT/INSERT/UPDATE/REFERENCES (col) entries.
           ${aclJson("a.attacl", "c", "c.relowner")} AS acl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p', 'f') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attislocal
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, a.attname`;

export const columnsFamily: CatalogFamily = {
  name: "columns",
  statements: () => [COLUMNS_SQL],
  apply: (ctx, rowSets) => {
    const { facts, pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
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
            // `_position` is the declared column position (pg_attribute.attnum).
            // Column ORDER is row-layout state (SELECT *, positional INSERT, the
            // relation's row type), so a from-empty CREATE must render columns in
            // this order — but positional IDENTITY is not desired state (columns
            // are name-keyed, like composite attributes), so the `_`-prefix
            // excludes it from the hash and diff (core/hash.ts, core/diff.ts): an
            // order-only reshuffle on an EXISTING table stays undiffable by design.
            // attnum has HOLES after DROP COLUMN, but ordering the survivors by it
            // still yields their declared order, which is what matters. The plan's
            // ordering phase (plan/phases/action-graph.ts) and the partitioned
            // inline-column path (plan/rules/tables.ts) render in this order.
            _position: Number(row["position"]),
            // `_partitionKey` marks a column in the partition key of its table
            // or of a sub-partition. Postgres rejects ALTER COLUMN ... TYPE
            // and DROP COLUMN on it, so the column rule replaces the
            // partitioned table instead (plan/rules/tables.ts). The table fact
            // already hashes the partition key. The `_` prefix keeps this copy
            // out of the hash and diff.
            _partitionKey: Boolean(row["partition_key"]),
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
                    options:
                      row["identity_options"] == null
                        ? null
                        : (row["identity_options"] as {
                            increment: string;
                            start: string;
                            minValue: string;
                            maxValue: string;
                            cache: string;
                            cycle: boolean;
                          }),
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
      // Identity-sequence grants: acl satellites of the column whose target is
      // the backing sequence, so they are created after the column and fold into
      // its drop (DROP IDENTITY destroys the sequence). The owner's row carries
      // `_ownerDefault` like any relation so the planner can elide it on create
      // and tell a restored default apart from a revoked one.
      const identitySequence = row["identity_sequence"] as {
        schema: string;
        name: string;
      } | null;
      if (row["identity"] != null && identitySequence != null) {
        for (const acl of parseAcl(row["identity_sequence_acl"])) {
          facts.push({
            id: {
              kind: "acl",
              target: {
                kind: "sequence",
                schema: identitySequence.schema,
                name: identitySequence.name,
              },
              grantee: acl.grantee,
            },
            parent: columnId,
            payload: {
              privileges: acl.privileges,
              grantable: acl.grantable,
              ...(acl.ownerDefault !== undefined
                ? { _ownerDefault: acl.ownerDefault }
                : {}),
            },
          });
        }
      }
      // Column-level grants (attacl): one acl satellite per grantee, targeting the
      // owning relation but qualified by this column. Parent is the column so the
      // grant folds into the column/table drop, exactly like the default above.
      for (const acl of parseAcl(row["acl"])) {
        facts.push({
          id: {
            kind: "acl",
            target: tableId,
            grantee: acl.grantee,
            column: String(row["name"]),
          },
          parent: columnId,
          payload: { privileges: acl.privileges, grantable: acl.grantable },
        });
      }
    }
  },
};

const TABLE_CONSTRAINTS_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, con.conname AS name,
           c.relkind AS table_kind,
           pg_get_constraintdef(con.oid) AS def,
           con.contype AS type, con.convalidated AS validated,
           obj_description(con.oid, 'pg_constraint') AS comment,
           CASE
             WHEN con.contype NOT IN ('p', 'u') THEN NULL
             WHEN con.conkey IS NULL OR 0 = ANY (con.conkey) THEN ARRAY[]::text[]
             ELSE (
               SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
             )
           END AS key_columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- 'f' = foreign tables: they carry only CHECK constraints (no p/u/f/x),
    -- so the contype filter already scopes them; serialized via ALTER FOREIGN
    -- TABLE (constraintTarget keys off the parent's foreignTable kind).
    -- PG 18 also catalogs a column's NOT NULL as a contype 'n' row. That stays
    -- the column's notNull attribute and must never become a second fact (the
    -- row does not exist on PG 14-17, so hashes would differ per version) --
    -- but a COMMENT ON CONSTRAINT attached to it has nowhere to live once the
    -- row is skipped. Fetch the commented ones so apply() can report the
    -- dropped comment instead of losing it silently; dependencies.ts skips
    -- the same rows as dependency endpoints (NOT_NULL_IS_NOT_A_FACT).
    WHERE ((con.contype IN ('p', 'u', 'f', 'c', 'x') AND con.conislocal)
           OR (con.contype = 'n'
               AND obj_description(con.oid, 'pg_constraint') IS NOT NULL))
      AND c.relkind IN ('r', 'p', 'f') AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, con.conname`;

export const tableConstraintsFamily: CatalogFamily = {
  name: "constraints",
  statements: () => [TABLE_CONSTRAINTS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, diagnostics } = ctx;
    for (const row of rowSets[0]!) {
      const type = String(row["type"]);
      const keyColumns = row["key_columns"];
      const schema = String(row["schema"]);
      const table = String(row["table"]);
      const relation: StableId = {
        kind: String(row["table_kind"]) === "f" ? "foreignTable" : "table",
        schema,
        name: table,
      };
      // Only COMMENTED contype 'n' rows reach here (see the query above): the
      // constraint itself is the column's notNull attribute, so report the
      // comment that cannot be carried and emit no fact for it.
      if (type === "n") {
        diagnostics.push({
          code: "table_not_null_comment_skipped",
          severity: "info",
          subject: relation,
          message:
            `${schema}.${table}: the comment on its NOT NULL constraint ` +
            `${String(row["name"])} is not modeled (NOT NULL is the column's notNull ` +
            `attribute; the constraint row exists only on PG 18+) and will not be ` +
            `diffed or exported.`,
        });
        continue;
      }
      pushWithMeta(
        {
          id: {
            kind: "constraint",
            schema,
            table,
            name: String(row["name"]),
          },
          parent: relation,
          payload: {
            def: deparsedDef(row, "constraint"),
            type,
            validated: Boolean(row["validated"]),
            // Planner-only: CREATE TABLE drops a UNIQUE whose conkey equals
            // another index constraint in the same statement; `_` keeps this
            // off the hash/diff surface.
            ...(type === "p" || type === "u"
              ? {
                  _keyColumns: Array.isArray(keyColumns)
                    ? keyColumns.map(String)
                    : [],
                }
              : {}),
          },
        },
        row,
      );
    }
  },
};

// ── indexes (excluding constraint-backed ones) ───────────────────────
const INDEXES_SQL = `
    SELECT n.nspname AS schema, ic.relname AS name, c.relname AS table,
           c.relkind AS table_kind,
           pg_get_indexdef(i.indexrelid) AS def,
           -- Partitioned PARENT indexes (relkind I): indisvalid is attach-state,
           -- not CONCURRENTLY corruption. Treating valid as replace would DROP
           -- the parent (cascading every attached child) instead of ATTACHing the
           -- gap. Child index facts plus attachedTo fingerprint attach-state;
           -- force the parent valid so it never drives that replace.
           CASE WHEN ic.relkind = 'I' THEN true ELSE i.indisvalid END AS valid,
           (SELECT json_build_object('schema', pn.nspname, 'name', pc.relname)
            FROM pg_inherits ih
            JOIN pg_class pc ON pc.oid = ih.inhparent
            JOIN pg_namespace pn ON pn.oid = pc.relnamespace
            WHERE ih.inhrelid = i.indexrelid
            ORDER BY ih.inhseqno
            LIMIT 1) AS attached_to,
           obj_description(i.indexrelid, 'pg_class') AS comment
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    WHERE c.relkind IN ('r', 'p', 'm') AND ${USER_SCHEMA_FILTER}
      -- Exclude indexes OWNED by a constraint (PRIMARY KEY / UNIQUE / EXCLUSION),
      -- which are serialized via the constraint, not as standalone CREATE INDEX.
      -- Gate on contype: a FOREIGN KEY constraint also sets conindid — to the
      -- index on the REFERENCED table it depends on — so an unqualified check
      -- wrongly drops a standalone unique index the moment any FK references it
      -- (regression: realtime.tenants' unique index on external_id, referenced by
      -- an FK from _realtime.extensions, vanished from extraction).
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint pc
        WHERE pc.conindid = i.indexrelid AND pc.contype IN ('p', 'u', 'x')
      )
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, ic.relname`;

export const indexesFamily: CatalogFamily = {
  name: "indexes",
  statements: () => [INDEXES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
      const tableKind =
        String(row["table_kind"]) === "m" ? "materializedView" : "table";
      const id = {
        kind: "index" as const,
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      const attachedTo =
        row["attached_to"] == null
          ? null
          : (row["attached_to"] as { schema: string; name: string });
      pushWithMeta(
        {
          id,
          parent: {
            kind: tableKind,
            schema: String(row["schema"]),
            name: String(row["table"]),
          },
          // `valid` is SEMANTIC for regular indexes (failed CREATE INDEX
          // CONCURRENTLY). Partitioned parents stay forced-valid: their
          // indisvalid is child attach-state, modeled by child facts +
          // `attachedTo`. Unmasking it would `valid: "replace"` the parent and
          // CASCADE-drop attached children that this plan does not recreate.
          payload: {
            def: deparsedDef(row, "index"),
            valid: Boolean(row["valid"]),
            attachedTo,
          },
        },
        row,
      );
    }
  },
};

// ── sequences (identity-column internals excluded) ───────────────────
const SEQUENCES_SQL = `
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
           ${aclJsonMemberAware("c.relacl", "s", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_sequence s
    JOIN pg_class c ON c.oid = s.seqrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE ${USER_SCHEMA_FILTER}
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype = 'i')
    ORDER BY n.nspname, c.relname`;

export const sequencesFamily: CatalogFamily = {
  name: "sequences",
  statements: () => [SEQUENCES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: "sequence",
        schema: String(row["schema"]),
        name: String(row["name"]),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
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
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

// ── views + materialized views ───────────────────────────────────────
const VIEWS_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, r.rolname AS owner,
           c.relkind AS kind,
           pg_get_viewdef(c.oid) AS def,
           c.reloptions AS reloptions,
           obj_description(c.oid, 'pg_class') AS comment,
           ${aclJsonMemberAware("c.relacl", "r", "c.relowner", "pg_class", "c.oid")} AS acl,
           ${memberExtensionExpr("pg_class", "c.oid")} AS ext_member_of
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('v', 'm') AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, c.relname`;

// View/matview column-level ACLs. View columns are not facts (they come from
// the view definition), so these grants hang off the view itself.
const VIEW_COLUMN_ACLS_SQL = `
    SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
           a.attname AS column,
           ${aclJson("a.attacl", "c", "c.relowner")} AS acl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
      AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, a.attname`;

export const viewsFamily: CatalogFamily = {
  name: "views",
  statements: () => [VIEWS_SQL, VIEW_COLUMN_ACLS_SQL],
  apply: (ctx, rowSets) => {
    const { facts, pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    const viewId = (row: Record<string, unknown>): StableId => ({
      kind: String(row["kind"]) === "m" ? "materializedView" : "view",
      schema: String(row["schema"]),
      name: String(row["name"]),
    });
    for (const row of rowSets[0]!) {
      const id = viewId(row);
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
            def: deparsedDef(row, "view"),
            reloptions: reloptions(row),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
    for (const row of rowSets[1]!) {
      const target = viewId(row);
      for (const acl of parseAcl(row["acl"])) {
        facts.push({
          id: {
            kind: "acl",
            target,
            grantee: acl.grantee,
            column: String(row["column"]),
          },
          parent: target,
          payload: { privileges: acl.privileges, grantable: acl.grantable },
        });
      }
    }
  },
};

const TRIGGERS_SQL = `
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
    ORDER BY n.nspname, c.relname, t.tgname`;

export const triggersFamily: CatalogFamily = {
  name: "triggers",
  statements: () => [TRIGGERS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
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
            def: deparsedDef(row, "trigger"),
            enabled: String(row["enabled"]),
          },
        },
        row,
      );
    }
  },
};

// ── rewrite rules (user rules; the view _RETURN rule is the view def) ─
const RULES_SQL = `
    SELECT n.nspname AS schema, c.relname AS table, c.relkind AS table_kind,
           rw.rulename AS name, pg_get_ruledef(rw.oid) AS def,
           rw.ev_enabled AS enabled,
           obj_description(rw.oid, 'pg_rewrite') AS comment
    FROM pg_rewrite rw
    JOIN pg_class c ON c.oid = rw.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE rw.rulename <> '_RETURN' AND ${USER_SCHEMA_FILTER}
      AND ${notExtensionMember("pg_class", "c.oid")}
    ORDER BY n.nspname, c.relname, rw.rulename`;

export const rulesFamily: CatalogFamily = {
  name: "rules",
  statements: () => [RULES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta } = ctx;
    for (const row of rowSets[0]!) {
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
          payload: {
            def: deparsedDef(row, "rule"),
            enabled: String(row["enabled"]),
          },
        },
        row,
      );
    }
  },
};
