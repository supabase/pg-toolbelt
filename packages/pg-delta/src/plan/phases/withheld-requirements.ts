/**
 * Withheld-requirement cascade (managed-view-architecture.md, Follow-up 4).
 *
 * A kept CREATE whose requirement (parent, raw-desired `depends` target, or
 * security-label provider extension) the policy withholds and the target lacks
 * cannot apply, so it is reverted with its subtree into `filteredDeltas` and
 * reported. Reverting anything else would leave looser state live, so a
 * stranded change to an existing object, or a stranded restrictive RLS policy,
 * throws instead. Unwithheld requirements are left to the requirement guard.
 */
import type { Diagnostic } from "../../core/diagnostic.ts";
import { EXCLUDED_BY_CASCADE } from "../../core/diagnostic.ts";
import { subjectOf, type Delta } from "../../core/diff.ts";
import type { FactBase } from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { TracedSuppression } from "../../policy/reconstruct.ts";
import {
  extensionMemberClosure,
  type ProjectionAuditStage,
} from "../../policy/view.ts";
import {
  ROLE_NAME_BEARING_KINDS,
  relabelRoleNames,
} from "../identity-normalize.ts";
import { ambientRequirements } from "../internal.ts";
import { subtreeIds } from "../renames.ts";
import { securityLabelProviderExtension } from "../rules/metadata.ts";
import { isRestrictivePolicy } from "../rules/policies.ts";

/** Projection stages that take a fact out of the user's hands. `managedBy`
 * (intent replay provisions it), `managementScope` (assumed roles cover it) and
 * `baseline` (present by definition) do not withhold. */
const WITHHOLDING_STAGES: ReadonlySet<ProjectionAuditStage> = new Set([
  "policyScopeRule",
  "capability",
  "referenceOnly",
]);

interface Attribution {
  stage: ProjectionAuditStage;
  reasonCode: string;
}

interface WithheldRequirementInputs {
  rawSource: FactBase;
  rawDesired: FactBase;
  /** canonical managed views */
  source: FactBase;
  desired: FactBase;
  /** policy-kept canonical deltas */
  deltas: Delta[];
  projectionSuppressions: readonly TracedSuppression[];
  /** source role name → desired role name for accepted role renames */
  roleRenameMap: ReadonlyMap<string, string>;
  assumedRoleNames: ReadonlySet<string>;
  assumedSchemaNames: ReadonlySet<string>;
  assumedPresentIds: ReadonlySet<string>;
}

export function cascadeWithheldRequirements(
  inputs: WithheldRequirementInputs,
): { kept: Delta[]; cascaded: Delta[]; diagnostics: Diagnostic[] } {
  const { rawSource, rawDesired, source, desired, deltas, roleRenameMap } =
    inputs;

  const withheld = new Map<string, Attribution>();
  for (const { side, suppression } of inputs.projectionSuppressions) {
    if (side !== "desired" || suppression.subject.kind !== "fact") continue;
    if (!WITHHOLDING_STAGES.has(suppression.stage)) continue;
    const key = encodeId(suppression.subject.id);
    if (!withheld.has(key)) {
      withheld.set(key, {
        stage: suppression.stage,
        reasonCode: suppression.reasonCode,
      });
    }
  }
  if (withheld.size === 0) {
    return { kept: deltas, cascaded: [], diagnostics: [] };
  }

  const keptAdds = new Set<string>();
  const subjects = new Map<string, StableId>();
  for (const delta of deltas) {
    if (delta.verb === "add") keptAdds.add(encodeId(delta.fact.id));
    if (delta.verb === "remove" || delta.verb === "unlink") continue;
    const id = subjectOf(delta);
    const key = encodeId(id);
    if (!subjects.has(key) && desired.has(id)) subjects.set(key, id);
  }

  // Canonical ids are the raw ids relabelled into desired-name space; only
  // role-name-bearing kinds differ, and only under an accepted role rename.
  const renamed = roleRenameMap.size > 0;
  const toSourceName = new Map(
    [...roleRenameMap].map(([from, to]) => [to, from]),
  );
  const rawSourceHas = (id: StableId): boolean =>
    rawSource.has(
      renamed && ROLE_NAME_BEARING_KINDS.has(id.kind)
        ? relabelRoleNames(id, toSourceName)
        : id,
    );

  const requirementsOf = (id: StableId): StableId[] => {
    const out: StableId[] = [];
    const parent = desired.get(id)?.parent;
    if (parent !== undefined) out.push(parent);
    const edges =
      renamed && ROLE_NAME_BEARING_KINDS.has(id.kind)
        ? desired.outgoingEdges(id)
        : rawDesired.outgoingEdges(id);
    for (const edge of edges) {
      if (edge.kind !== "depends") continue;
      out.push(renamed ? relabelRoleNames(edge.to, roleRenameMap) : edge.to);
    }
    const provider = securityLabelProviderExtension(id);
    if (provider !== undefined && rawDesired.has(provider)) out.push(provider);
    return out;
  };

  // encoded id → attribution of the root cause that reverted it
  const reverted = new Map<string, Attribution>();
  const { isAmbient, memberExtensionPresent } = ambientRequirements({
    source,
    desired,
    isProduced: (key) => keptAdds.has(key) && !reverted.has(key),
    assumedRoleNames: inputs.assumedRoleNames,
    assumedSchemaNames: inputs.assumedSchemaNames,
    assumedPresentIds: inputs.assumedPresentIds,
  });
  const satisfied = (id: StableId, key: string): boolean =>
    keptAdds.has(key) ||
    source.has(id) ||
    rawSourceHas(id) ||
    isAmbient(id) ||
    memberExtensionPresent(key);

  // An extension member is always reference-only; it is withheld only when an
  // owning extension is (or was reverted here). Raw closure: projection prunes
  // the membership edge of a hidden extension.
  let rawMembers: Map<string, StableId[]> | undefined;
  const withheldCause = (key: string): Attribution | undefined => {
    rawMembers ??= extensionMemberClosure(rawDesired);
    const extensions = rawMembers.get(key);
    if (extensions === undefined) return withheld.get(key);
    for (const extension of extensions) {
      const extensionKey = encodeId(extension);
      const cause = reverted.get(extensionKey) ?? withheld.get(extensionKey);
      if (cause !== undefined) return cause;
    }
    return undefined;
  };

  const requirements = new Map<string, StableId[]>();
  const diagnostics: Diagnostic[] = [];
  const refusals: string[] = [];
  // Absent reference-only requirements stay in the desired view; revert them
  // too so the plan target matches what apply produces.
  const absentReferences = new Map<string, Delta>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, id] of subjects) {
      if (reverted.has(key)) continue;
      let list = requirements.get(key);
      if (list === undefined) {
        list = requirementsOf(id);
        requirements.set(key, list);
      }
      for (const requirement of list) {
        const requirementKey = encodeId(requirement);
        const upstream = reverted.get(requirementKey);
        const cause =
          upstream ??
          (satisfied(requirement, requirementKey)
            ? undefined
            : withheldCause(requirementKey));
        if (cause === undefined) continue;
        const why =
          upstream === undefined
            ? `which the policy withholds (${cause.reasonCode}) and the target lacks`
            : `which this plan does not apply (${cause.reasonCode})`;
        const fact = desired.get(id);
        if (
          !keptAdds.has(key) ||
          (fact !== undefined && isRestrictivePolicy(fact))
        ) {
          refusals.push(`  - ${key} requires ${requirementKey}, ${why}`);
          break;
        }
        for (const member of subtreeIds(desired, id)) {
          const memberKey = encodeId(member);
          if (!reverted.has(memberKey)) reverted.set(memberKey, cause);
        }
        const absent =
          upstream === undefined ? desired.get(requirement) : undefined;
        if (absent !== undefined && !absentReferences.has(requirementKey)) {
          absentReferences.set(requirementKey, { verb: "add", fact: absent });
        }
        diagnostics.push({
          code: EXCLUDED_BY_CASCADE,
          severity: "warning",
          subject: id,
          message: `${key} was not planned: it requires ${requirementKey}, ${why}`,
          context: {
            requirement: requirementKey,
            stage: cause.stage,
            reasonCode: cause.reasonCode,
          },
        });
        changed = true;
        break;
      }
    }
  }
  if (refusals.length > 0) {
    throw new Error(
      `plan: these changes depend on objects the policy withholds and the target lacks; ` +
        `skipping them would leave looser state live (an old definition, or access a ` +
        `restrictive policy would deny). Provide the prerequisite on the target or drop ` +
        `the change from the desired state:\n${[...new Set(refusals)].sort().join("\n")}`,
    );
  }
  if (reverted.size === 0) {
    return { kept: deltas, cascaded: [], diagnostics: [] };
  }

  const kept: Delta[] = [];
  const cascaded: Delta[] = [];
  for (const delta of deltas) {
    if (delta.verb !== "remove" && reverted.has(encodeId(subjectOf(delta)))) {
      cascaded.push(delta);
    } else {
      kept.push(delta);
    }
  }
  cascaded.push(...absentReferences.values());
  return { kept, cascaded, diagnostics };
}
