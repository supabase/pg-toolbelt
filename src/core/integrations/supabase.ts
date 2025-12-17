import type { Change } from "../change.types.ts";
import { getOwner, getSchema } from "../filter/utils.ts";
import type { ChangeFilter, ChangeSerializer, DiffContext } from "../main.ts";
import type { Integration } from "./integration.types.ts";

const _SUPABASE_EXTENSIONS_SCHEMAS = [
  "graphql",
  "pgmq",
  "pgsodium",
  "pgtle",
  "tiger",
  "topology",
  "vault",
];

/**
 * Supabase specific schemas.
 * @see https://github.com/supabase/supabase/blob/5cee4744a18b2c51595e7dd3c451049be6ef4a32/apps/studio/hooks/useProtectedSchemas.ts#L16-L34
 */
const SUPABASE_SCHEMAS = [
  "_analytics", // local only
  "_realtime", // local only
  "_supavisor", // local only
  "auth",
  "cron",
  "extensions",
  "graphql",
  "graphql_public",
  "information_schema",
  "net",
  "pgbouncer",
  "pgmq",
  "pgmq_public",
  "pgsodium",
  "pgsodium_masks",
  "pgtle",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "vault",
];

/**
 * Supabase specific roles.
 * @see https://github.com/supabase/supabase/blob/5cee4744a18b2c51595e7dd3c451049be6ef4a32/apps/studio/components/interfaces/Database/Roles/Roles.constants.ts#L1-L19
 */
const SUPABASE_ROLES = [
  "anon",
  "authenticated",
  "authenticator",
  "dashboard_user",
  "pgbouncer",
  "pgsodium_keyholder",
  "pgsodium_keyiduser",
  "pgsodium_keymaker",
  "pgtle_admin",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_functions_admin",
  "supabase_read_only_user",
  "supabase_realtime_admin",
  "supabase_replication_admin",
  "supabase_storage_admin",
];

// Supabase-specific filter (filters out Supabase system objects)
const supabaseFilter: ChangeFilter = (_ctx: DiffContext, change: Change) => {
  // Then apply Supabase-specific filter
  const isCreateSchema =
    change.objectType === "schema" &&
    change.operation === "create" &&
    change.scope === "object";
  const isCreateExtension =
    change.objectType === "extension" &&
    change.operation === "create" &&
    change.scope === "object";
  const isSupabaseSchema = SUPABASE_SCHEMAS.includes(getSchema(change) ?? "");
  const owner = getOwner(change);
  const isSupabaseRole = owner !== null && SUPABASE_ROLES.includes(owner);
  const isMembershipForSupabaseRole =
    change.objectType === "role" &&
    change.scope === "membership" &&
    SUPABASE_ROLES.includes(change.member);

  if (isCreateSchema) {
    return true;
  }

  if (isCreateExtension) {
    return true;
  }

  return !isSupabaseSchema && !isSupabaseRole && !isMembershipForSupabaseRole;
};

// Supabase-specific serialize (applies masking + custom schema handling)
const supabaseSerialize: ChangeSerializer = (_ctx, change) => {
  const owner = getOwner(change);
  const isCreateSchemaOwnedBySupabaseRole =
    change.objectType === "schema" &&
    change.operation === "create" &&
    change.scope === "object" &&
    owner !== null &&
    SUPABASE_ROLES.includes(owner);

  if (isCreateSchemaOwnedBySupabaseRole) {
    return change.serialize({ skipAuthorization: true });
  }

  return change.serialize();
};

export const supabase: Integration = {
  filter: supabaseFilter,
  serialize: supabaseSerialize,
};
