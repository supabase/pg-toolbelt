import type { Catalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/change.types.ts";
import { getOwner, getSchema } from "../../src/filter/utils.ts";

const SUPABASE_SCHEMAS = [
  "auth",
  "extensions",
  "graphql",
  "graphql_public",
  "pgbouncer",
  "pgmq",
  "pgmq_public",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "vault",
];

const SUPABASE_ROLES = [
  "anon",
  "authenticated",
  "authenticator",
  "dashboard_user",
  "pgbouncer",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_read_only_user",
  "supabase_realtime_admin",
  "supabase_replication_admin",
  "supabase_storage_admin",
];

export function supabaseFilter(
  _ctx: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
) {
  return changes.filter((change) => {
    const owner = getOwner(change);
    const schema = getSchema(change);

    // if new extensions are enabled, we need to include them
    if (
      change.objectType === "extension" &&
      change.operation === "create" &&
      change.scope === "object"
    ) {
      return true;
    }

    // if new schemas are created and they are used by extensions, we need to include them
    if (
      change.objectType === "schema" &&
      change.operation === "create" &&
      change.scope === "object"
    ) {
      return true;
    }

    return (
      !SUPABASE_ROLES.includes(owner) &&
      !(
        change.objectType === "role" &&
        change.scope === "membership" &&
        SUPABASE_ROLES.includes(change.member)
      ) &&
      !SUPABASE_SCHEMAS.includes(schema ?? "")
    );
  });
}
