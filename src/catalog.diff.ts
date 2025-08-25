import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./objects/base.change.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffIndexes } from "./objects/index/index.diff.ts";
import { diffMaterializedViews } from "./objects/materialized-view/materialized-view.diff.ts";
import { diffProcedures } from "./objects/procedure/procedure.diff.ts";
import { diffRlsPolicies } from "./objects/rls-policy/rls-policy.diff.ts";
import { diffSchemas } from "./objects/schema/schema.diff.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { diffTables } from "./objects/table/table.diff.ts";
import { diffTriggers } from "./objects/trigger/trigger.diff.ts";
import { diffCompositeTypes } from "./objects/type/composite-type/composite-type.diff.ts";
import { diffEnums } from "./objects/type/enum/enum.diff.ts";
import { diffTypes } from "./objects/type/type.diff.ts";
import { diffViews } from "./objects/view/view.diff.ts";

export function diffCatalogs(main: Catalog, branch: Catalog) {
  const changes: Change[] = [];

  changes.push(...diffSchemas(main.schemas, branch.schemas));
  changes.push(...diffTypes(main.types, branch.types));
  changes.push(...diffEnums(main.enums, branch.enums));
  changes.push(
    ...diffCompositeTypes(main.compositeTypes, branch.compositeTypes),
  );
  changes.push(...diffDomains(main.domains, branch.domains));
  changes.push(...diffSequences(main.sequences, branch.sequences));
  changes.push(...diffTables(main.tables, branch.tables));
  changes.push(...diffViews(main.views, branch.views));
  changes.push(
    ...diffMaterializedViews(main.materializedViews, branch.materializedViews),
  );
  changes.push(...diffProcedures(main.procedures, branch.procedures));
  changes.push(...diffIndexes(main.indexes, branch.indexes));
  changes.push(...diffRlsPolicies(main.rlsPolicies, branch.rlsPolicies));
  changes.push(...diffTriggers(main.triggers, branch.triggers));

  return changes;
}
