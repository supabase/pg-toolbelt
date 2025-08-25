import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./objects/base.change.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffSchemas } from "./objects/schema/schema.diff.ts";
import { diffTypes } from "./objects/type/type.diff.ts";

export function diffCatalogs(main: Catalog, branch: Catalog) {
  const changes: Change[] = [];

  changes.push(...diffDomains(main.domains, branch.domains));
  changes.push(...diffTypes(main.types, branch.types));
  changes.push(...diffSchemas(main.schemas, branch.schemas));
  return changes;
}
