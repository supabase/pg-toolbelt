import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterDomain } from "./changes/domain.alter.ts";
import { CreateDomain } from "./changes/domain.create.ts";
import { DropDomain } from "./changes/domain.drop.ts";
import type { Domain } from "./domain.model.ts";

/**
 * Diff two sets of domains from master and branch catalogs.
 *
 * @param master - The domains in the master catalog.
 * @param branch - The domains in the branch catalog.
 * @returns A list of changes to apply to master to make it match branch.
 */
export function diffDomains(
  master: Record<string, Domain>,
  branch: Record<string, Domain>,
): Change[] {
  const { created, dropped, altered } = diffObjects(master, branch);

  const changes: Change[] = [];

  for (const domainId of created) {
    changes.push(new CreateDomain({ domain: branch[domainId] }));
  }

  for (const domainId of dropped) {
    changes.push(new DropDomain({ domain: master[domainId] }));
  }

  for (const domainId of altered) {
    changes.push(
      new AlterDomain({ master: master[domainId], branch: branch[domainId] }),
    );
  }

  return changes;
}
