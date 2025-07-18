import type { DEPENDENCY_KIND_PREFIX } from "../constants.ts";
import type { InspectionKey, InspectionMap } from "../types.ts";

// PostgreSQL dependency kind (relation type)
export type DependencyKind =
  /** table */
  | "r"
  /** view */
  | "v"
  /** materialized view */
  | "m"
  /** composite type */
  | "c"
  /** function */
  | "f";

export interface InspectedDependency {
  schema: string;
  name: string;
  identity_arguments: string | null;
  kind: DependencyKind;
  schema_dependent_on: string;
  name_dependent_on: string;
  identity_arguments_dependent_on: string | null;
  kind_dependent_on: DependencyKind;
}

export type SelectableDependenciesMap = Record<
  InspectionKey,
  { dependent_on: InspectionKey[] }
>;

export type DependencyKindPrefix =
  (typeof DEPENDENCY_KIND_PREFIX)[keyof typeof DEPENDENCY_KIND_PREFIX];

export type InspectionPrefix =
  keyof InspectionMap extends `${infer Prefix}:${string}` ? Prefix : never;
