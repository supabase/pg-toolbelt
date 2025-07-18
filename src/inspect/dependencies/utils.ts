import { DEPENDENCY_KIND_PREFIX } from "../constants.ts";
import type { InspectionMap } from "../types.ts";
import type {
  DependencyKind,
  DependencyKindPrefix,
  InspectionPrefix,
} from "./types.ts";

export function identifyDependency(
  kind: DependencyKind,
  schema: string,
  name: string,
  identity_arguments: string | null,
): `${DependencyKindPrefix}:${string}` {
  const prefix = DEPENDENCY_KIND_PREFIX[kind];
  return `${prefix}:${schema}.${name}${identity_arguments ? `(${identity_arguments})` : ""}`;
}

export function filterInspectionByPrefix<P extends InspectionPrefix>(
  inspection: InspectionMap,
  prefix: P,
): [
  keyof InspectionMap & `${P}:${string}`,
  InspectionMap[keyof InspectionMap & `${P}:${string}`],
][] {
  return Object.entries(inspection)
    .filter(([key]) => key.startsWith(`${prefix}:`))
    .map(([key, value]) => [
      key as keyof InspectionMap & `${P}:${string}`,
      value as InspectionMap[keyof InspectionMap & `${P}:${string}`],
    ]);
}
