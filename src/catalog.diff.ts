import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./objects/base.change.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";

export function diffCatalogs(master: Catalog, branch: Catalog) {
  const changes: Change[] = [];

  changes.push(...diffDomains(master.domains, branch.domains));

  // TODO: Use the dependency graph to determine the order of changes

  return changes;
}
