import { z } from "zod";

export const securityLabelPropsSchema = z.object({
  provider: z.string(),
  label: z.string(),
});

export type SecurityLabelProps = z.infer<typeof securityLabelPropsSchema>;

/**
 * Pure helper: compares two arrays of security labels keyed by provider and
 * returns a deterministic list of create/drop changes.
 *
 * - Labels present only on `branch` → emit create (via makeCreate).
 * - Labels present only on `main` → emit drop (via makeDrop).
 * - Labels with differing `label` under the same provider → emit create
 *   (PostgreSQL's SECURITY LABEL … IS '…' overwrites, so no separate alter).
 * - Unchanged labels → nothing.
 *
 * Output order: by provider ascending.
 */
export function diffSecurityLabels<C>(
  main: readonly SecurityLabelProps[],
  branch: readonly SecurityLabelProps[],
  makeCreate: (props: SecurityLabelProps) => C,
  makeDrop: (props: SecurityLabelProps) => C,
): C[] {
  const mainByProvider = new Map(main.map((l) => [l.provider, l.label]));
  const branchByProvider = new Map(branch.map((l) => [l.provider, l.label]));

  const providers = new Set<string>([
    ...mainByProvider.keys(),
    ...branchByProvider.keys(),
  ]);
  const sortedProviders = [...providers].sort();

  const out: C[] = [];
  for (const provider of sortedProviders) {
    const mainLabel = mainByProvider.get(provider);
    const branchLabel = branchByProvider.get(provider);

    if (mainLabel === undefined && branchLabel !== undefined) {
      out.push(makeCreate({ provider, label: branchLabel }));
    } else if (mainLabel !== undefined && branchLabel === undefined) {
      out.push(makeDrop({ provider, label: mainLabel }));
    } else if (
      mainLabel !== undefined &&
      branchLabel !== undefined &&
      mainLabel !== branchLabel
    ) {
      out.push(makeCreate({ provider, label: branchLabel }));
    }
  }
  return out;
}
