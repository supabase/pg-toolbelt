import type { Catalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/objects/base.change.ts";
import { CreateProcedure } from "../../src/objects/procedure/changes/procedure.create.ts";
import { CreateRlsPolicy } from "../../src/objects/rls-policy/changes/rls-policy.create.ts";
import { CreateTrigger } from "../../src/objects/trigger/changes/trigger.create.ts";
import { CreateView } from "../../src/objects/view/changes/view.create.ts";

const SUPABASE_EXTENSION_SCHEMAS = ["vault", "cron", "pgsodium"];

export function supabaseFilter(
  _ctx: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
) {
  return changes.filter(
    (change) =>
      !(
        (change instanceof CreateView &&
          SUPABASE_EXTENSION_SCHEMAS.includes(change.view.schema)) ||
        (change instanceof CreateProcedure &&
          SUPABASE_EXTENSION_SCHEMAS.includes(change.procedure.schema)) ||
        (change instanceof CreateTrigger &&
          SUPABASE_EXTENSION_SCHEMAS.includes(change.trigger.schema)) ||
        (change instanceof CreateRlsPolicy &&
          SUPABASE_EXTENSION_SCHEMAS.includes(change.rlsPolicy.schema))
      ),
  );
}
