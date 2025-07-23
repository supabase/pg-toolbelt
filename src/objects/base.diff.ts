import type { BasePgModel } from "./base.model.ts";

export function diffObjects<T extends BasePgModel>(
  master: Record<string, T>,
  branch: Record<string, T>,
) {
  const masterIds = new Set(Object.keys(master));
  const branchIds = new Set(Object.keys(branch));

  const created = [...branchIds.difference(masterIds)];
  const dropped = [...masterIds.difference(branchIds)];
  const altered = [...masterIds.intersection(branchIds)].filter((id) => {
    const masterModel = master[id];
    const branchModel = branch[id];

    return !masterModel.equals(branchModel);
  });

  return { created, dropped, altered };
}
