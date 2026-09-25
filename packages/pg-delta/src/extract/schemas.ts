/** Schemas and extensions. */
import type { Payload } from "../core/hash.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  aclJsonMemberAware,
  type CatalogFamily,
  memberExtensionExpr,
  parseAcl,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

/**
 * The extension fact payload as extraction produces it. Tests that exercise
 * this exact shape should build it through here rather than hand-rolling the
 * literal (scenarios needing extra keys — an `owner`, a `_schemaIsMember` —
 * still compose their own). `_relocatable` (pg_extension.extrelocatable)
 * is NON-SEMANTIC METADATA (the `_` prefix — see hash.ts): a control-file
 * property of the INSTALLED VERSION, not user-manageable state, so it is
 * excluded from the diff/hash surface for the same reason `version` is —
 * otherwise an extension whose control files flip relocatability across
 * versions (wrappers did) produces a `set` delta no rule can converge, and
 * plan() throws guardrail 3 (CLI-2219). It rides along for the schema rule's
 * plan-time `replaceWhen` read only (a non-relocatable extension relocates by
 * drop + recreate, never SET SCHEMA). `_controlSchema` is the schema the
 * control file pins (read by the create rule), metadata for the same reason.
 */
export function extensionPayload(
  schema: string,
  relocatable: boolean,
  controlSchema?: string,
): Payload {
  return controlSchema === undefined
    ? { schema, _relocatable: relocatable }
    : { schema, _relocatable: relocatable, _controlSchema: controlSchema };
}

// ── schemas ──────────────────────────────────────────────────────────────
const SCHEMAS_SQL = `
    SELECT n.nspname AS name, r.rolname AS owner,
           obj_description(n.oid, 'pg_namespace') AS comment,
           ${aclJsonMemberAware("n.nspacl", "n", "n.nspowner", "pg_namespace", "n.oid")} AS acl,
           ${memberExtensionExpr("pg_namespace", "n.oid")} AS ext_member_of
    FROM pg_namespace n
    JOIN pg_roles r ON r.oid = n.nspowner
    WHERE ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname`;

// ── extensions (version deliberately excluded from the payload) ─────
// `control_schema`: the schema the control file pins, only when the installed
// AND default versions agree on it — a bare CREATE EXTENSION installs the
// default version, and secondary control files may set `schema` per version.
// NULL when unpinned or a control file is missing.
const EXTENSIONS_SQL = `
    SELECT e.extname AS name, n.nspname AS schema,
           e.extrelocatable AS relocatable,
           CASE WHEN iv.schema = dv.schema THEN iv.schema::text END AS control_schema,
           obj_description(e.oid, 'pg_extension') AS comment
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    LEFT JOIN pg_available_extensions a ON a.name = e.extname
    LEFT JOIN pg_available_extension_versions iv
           ON iv.name = e.extname AND iv.version = e.extversion
    LEFT JOIN pg_available_extension_versions dv
           ON dv.name = e.extname AND dv.version = a.default_version
    WHERE e.extname <> 'plpgsql'
    ORDER BY e.extname`;

export const schemasAndExtensionsFamily: CatalogFamily = {
  name: "schemas",
  statements: () => [SCHEMAS_SQL, EXTENSIONS_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;

    for (const row of rowSets[0]!) {
      const id: StableId = { kind: "schema", name: String(row["name"]) };
      pushWithMeta(
        {
          id,
          payload: {},
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }

    for (const row of rowSets[1]!) {
      pushWithMeta(
        {
          id: { kind: "extension", name: String(row["name"]) },
          payload: extensionPayload(
            String(row["schema"]),
            Boolean(row["relocatable"]),
            typeof row["control_schema"] === "string"
              ? row["control_schema"]
              : undefined,
          ),
        },
        row,
      );
    }
  },
};
