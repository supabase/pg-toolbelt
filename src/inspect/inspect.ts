import type { Sql } from "postgres";
import {
  type InspectedCompositeType,
  inspectCompositeTypes,
} from "./objects2/composite-types.ts";
import {
  type InspectedCollation,
  type InspectedConstraint,
  type InspectedDomain,
  type InspectedEnum,
  type InspectedExtension,
  type InspectedFunction,
  type InspectedIndex,
  type InspectedPrivilege,
  type InspectedRlsPolicy,
  type InspectedSchema,
  type InspectedSequence,
  type InspectedTrigger,
  type InspectedType,
  inspectCollations,
  inspectConstraints,
  inspectDomains,
  inspectEnums,
  inspectExtensions,
  inspectFunctions,
  inspectIndexes,
  inspectPrivileges,
  inspectRlsPolicies,
  inspectSchemas,
  inspectSequences,
  inspectTriggers,
  inspectTypes,
} from "./objects2/index.ts";
import {
  type InspectedMaterializedView,
  inspectMaterializedViews,
} from "./objects2/materialized-views.ts";
import { type InspectedTable, inspectTables } from "./objects2/tables.ts";
import { type InspectedView, inspectViews } from "./objects2/views.ts";

export type InspectionResult = {
  collations: Map<string, InspectedCollation>;
  compositeTypes: Map<string, InspectedCompositeType>;
  constraints: Map<string, InspectedConstraint>;
  domains: Map<string, InspectedDomain>;
  enums: Map<string, InspectedEnum[]>;
  extensions: Map<string, InspectedExtension>;
  functions: Map<string, InspectedFunction>;
  indexes: Map<string, InspectedIndex>;
  materializedViews: Map<string, InspectedMaterializedView>;
  privileges: Map<string, InspectedPrivilege>;
  rlsPolicies: Map<string, InspectedRlsPolicy>;
  schemas: Map<string, InspectedSchema>;
  sequences: Map<string, InspectedSequence>;
  tables: Map<string, InspectedTable>;
  triggers: Map<string, InspectedTrigger>;
  types: Map<string, InspectedType>;
  views: Map<string, InspectedView>;
};

export async function inspect(sql: Sql): Promise<InspectionResult> {
  const [
    collations,
    compositeTypes,
    constraints,
    domains,
    enums,
    extensions,
    functions,
    indexes,
    materializedViews,
    privileges,
    rlsPolicies,
    schemas,
    sequences,
    tables,
    triggers,
    types,
    views,
  ] = await Promise.all([
    inspectCollations(sql),
    inspectCompositeTypes(sql),
    inspectConstraints(sql),
    inspectDomains(sql),
    inspectEnums(sql),
    inspectExtensions(sql),
    inspectFunctions(sql),
    inspectIndexes(sql),
    inspectMaterializedViews(sql),
    inspectPrivileges(sql),
    inspectRlsPolicies(sql),
    inspectSchemas(sql),
    inspectSequences(sql),
    inspectTables(sql),
    inspectTriggers(sql),
    inspectTypes(sql),
    inspectViews(sql),
  ]);

  return {
    collations,
    compositeTypes,
    constraints,
    domains,
    enums,
    extensions,
    functions,
    indexes,
    materializedViews,
    privileges,
    rlsPolicies,
    schemas,
    sequences,
    tables,
    triggers,
    types,
    views,
  };
}
