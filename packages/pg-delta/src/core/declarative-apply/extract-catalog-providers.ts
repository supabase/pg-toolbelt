/**
 * Extract functions, types, and other catalog objects from the target database
 * so pg-topo can treat them as external providers and suppress false
 * UNRESOLVED_DEPENDENCY diagnostics (e.g. now(), gen_random_uuid(), nextval(),
 * auth.users, extensions.uuid_generate_v4, etc.).
 */

import type { ObjectRef } from "@supabase/pg-topo";
import type { Pool } from "pg";

type FunctionRow = { name: string; schema: string; kind: string; signature: string };
type TypeRow = { name: string; schema: string; typetype: string };
type SchemaRow = { name: string };
type RelationRow = { name: string; schema: string; relkind: string };
type ExtensionRow = { name: string; schema: string | null };
type RoleRow = { name: string };
type LanguageRow = { name: string };
type CollationRow = { name: string; schema: string };
type FdwRow = { name: string };
type ServerRow = { name: string };
type EventTriggerRow = { name: string };
type PublicationRow = { name: string };
type SubscriptionRow = { name: string };

function addProvider(
  providers: ObjectRef[],
  ref: ObjectRef,
  alsoUnderPublic = false,
): void {
  providers.push(ref);
  if (
    alsoUnderPublic &&
    (ref.schema === "pg_catalog" || ref.schema === "information_schema")
  ) {
    providers.push({ ...ref, schema: "public" });
  }
}

/**
 * Query the target database for all catalog objects that can be dependencies.
 * Returns ObjectRefs that pg-topo can use as external providers. Objects in
 * pg_catalog/information_schema are registered under both their real schema
 * and "public" so they match how the parser resolves unqualified references.
 */
export async function extractCatalogProviders(
  pool: Pool,
): Promise<ObjectRef[]> {
  const providers: ObjectRef[] = [];

  const [
    functionsResult,
    typesResult,
    schemasResult,
    relationsResult,
    extensionsResult,
    rolesResult,
    languagesResult,
    collationsResult,
    fdwsResult,
    serversResult,
    eventTriggersResult,
    publicationsResult,
    subscriptionsResult,
  ] = await Promise.all([
    pool.query<FunctionRow>(`
      SELECT
        p.proname AS name,
        n.nspname AS schema,
        p.prokind AS kind,
        COALESCE((
          SELECT string_agg(format_type(t.oid, NULL), ',' ORDER BY ord)
          FROM unnest(p.proargtypes) WITH ORDINALITY AS t(oid, ord)
        ), '') AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
    `),
    pool.query<TypeRow>(`
      SELECT t.typname AS name, n.nspname AS schema, t.typtype AS typetype
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT LIKE 'pg_toast%'
        AND t.typtype IN ('b', 'c', 'd', 'e', 'r')
    `),
    pool.query<SchemaRow>(`
      SELECT nspname AS name FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_toast%'
    `),
    pool.query<RelationRow>(`
      SELECT c.relname AS name, n.nspname AS schema, c.relkind AS relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i')
        AND n.nspname NOT LIKE 'pg_toast%'
    `),
    pool.query<ExtensionRow>(`
      SELECT e.extname AS name, n.nspname AS schema
      FROM pg_extension e
      LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
    `),
    pool.query<RoleRow>(`SELECT rolname AS name FROM pg_roles`),
    pool.query<LanguageRow>(`SELECT lanname AS name FROM pg_language`),
    pool.query<CollationRow>(`
      SELECT c.collname AS name, n.nspname AS schema
      FROM pg_collation c
      JOIN pg_namespace n ON n.oid = c.collnamespace
      WHERE n.nspname NOT LIKE 'pg_toast%'
    `),
    pool.query<FdwRow>(`SELECT fdwname AS name FROM pg_foreign_data_wrapper`),
    pool.query<ServerRow>(`SELECT srvname AS name FROM pg_foreign_server`),
    pool.query<EventTriggerRow>(`SELECT evtname AS name FROM pg_event_trigger`),
    pool.query<PublicationRow>(`SELECT pubname AS name FROM pg_publication`),
    pool.query<SubscriptionRow>(`SELECT subname AS name FROM pg_subscription`),
  ]);

  for (const fn of functionsResult.rows) {
    const kind =
      fn.kind === "a"
        ? "aggregate"
        : fn.kind === "p"
          ? "procedure"
          : "function";
    const sig = fn.signature.trim() ? `(${fn.signature})` : "()";
    const ref: ObjectRef = { kind, name: fn.name, schema: fn.schema, signature: sig };
    addProvider(providers, ref, true);
  }

  for (const t of typesResult.rows) {
    const kind = t.typetype === "d" ? "domain" : "type";
    const ref: ObjectRef = { kind, name: t.name, schema: t.schema };
    addProvider(providers, ref, true);
  }

  for (const row of schemasResult.rows) {
    providers.push({ kind: "schema", name: row.name });
  }

  const relkindToKind: Record<string, ObjectRef["kind"]> = {
    r: "table",
    p: "table",
    v: "view",
    m: "materialized_view",
    S: "sequence",
    i: "index",
  };
  for (const row of relationsResult.rows) {
    const kind = relkindToKind[row.relkind];
    if (!kind) continue;
    const ref: ObjectRef = { kind, name: row.name, schema: row.schema };
    addProvider(providers, ref, true);
  }

  for (const row of extensionsResult.rows) {
    providers.push({
      kind: "extension",
      name: row.name,
      schema: row.schema ?? undefined,
    });
  }

  for (const row of rolesResult.rows) {
    providers.push({ kind: "role", name: row.name });
  }

  for (const row of languagesResult.rows) {
    providers.push({ kind: "language", name: row.name });
  }

  for (const row of collationsResult.rows) {
    const ref: ObjectRef = {
      kind: "collation",
      name: row.name,
      schema: row.schema,
    };
    addProvider(providers, ref, true);
  }

  for (const row of fdwsResult.rows) {
    providers.push({ kind: "foreign_data_wrapper", name: row.name });
  }

  for (const row of serversResult.rows) {
    providers.push({ kind: "foreign_server", name: row.name });
  }

  for (const row of eventTriggersResult.rows) {
    providers.push({ kind: "event_trigger", name: row.name });
  }

  for (const row of publicationsResult.rows) {
    providers.push({ kind: "publication", name: row.name });
  }

  for (const row of subscriptionsResult.rows) {
    providers.push({ kind: "subscription", name: row.name });
  }

  return providers;
}
