import type { Sql } from "postgres";
import {
  type InspectedCollation,
  inspectCollations,
} from "./objects/collations.ts";
import {
  type InspectedConstraint,
  inspectConstraints,
} from "./objects/constraints.ts";
import { type InspectedDomain, inspectDomains } from "./objects/domains.ts";
import { type InspectedEnum, inspectEnums } from "./objects/enums.ts";
import {
  type InspectedExtension,
  inspectExtensions,
} from "./objects/extensions.ts";
import {
  type InspectedFunction,
  inspectFunctions,
} from "./objects/functions.ts";
import { type InspectedIndex, inspectIndexes } from "./objects/indexes.ts";
import {
  type InspectedPrivilege,
  inspectPrivileges,
} from "./objects/privileges.ts";
import {
  type InspectedRelations,
  inspectRelations,
} from "./objects/relations/relations.ts";
import {
  type InspectedRLSPolicy,
  inspectRLSPolicies,
} from "./objects/rls-policies.ts";
import { type InspectedSchema, inspectSchemas } from "./objects/schemas.ts";
import {
  type InspectedSequence,
  inspectSequences,
} from "./objects/sequences.ts";
import { type InspectedTrigger, inspectTriggers } from "./objects/triggers.ts";
import { type InspectedType, inspectTypes } from "./objects/types.ts";

export type InspectionResult = {
  collations: InspectedCollation[];
  compositeTypes: InspectedRelations["compositeTypes"];
  constraints: InspectedConstraint[];
  domains: InspectedDomain[];
  enums: InspectedEnum[];
  extensions: InspectedExtension[];
  functions: InspectedFunction[];
  indexes: InspectedIndex[];
  materializedViews: InspectedRelations["materializedViews"];
  privileges: InspectedPrivilege[];
  rlsPolicies: InspectedRLSPolicy[];
  schemas: InspectedSchema[];
  sequences: InspectedSequence[];
  tables: InspectedRelations["tables"];
  triggers: InspectedTrigger[];
  types: InspectedType[];
  views: InspectedRelations["views"];
};

export async function inspect(sql: Sql): Promise<InspectionResult> {
  const collations = await inspectCollations(sql);
  const constraints = await inspectConstraints(sql);
  const domains = await inspectDomains(sql);
  const enums = await inspectEnums(sql);
  const extensions = await inspectExtensions(sql);
  const functions = await inspectFunctions(sql);
  const indexes = await inspectIndexes(sql);
  const privileges = await inspectPrivileges(sql);
  const relations = await inspectRelations(sql);
  const rlsPolicies = await inspectRLSPolicies(sql);
  const schemas = await inspectSchemas(sql);
  const sequences = await inspectSequences(sql);
  const triggers = await inspectTriggers(sql);
  const types = await inspectTypes(sql);

  return {
    collations,
    constraints,
    domains,
    enums,
    extensions,
    functions,
    indexes,
    privileges,
    ...relations,
    rlsPolicies,
    schemas,
    sequences,
    triggers,
    types,
  };
}
