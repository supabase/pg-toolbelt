import type { Sql } from "postgres";
import {
  type InspectedCollation,
  inspectCollations,
} from "./objects/collations.ts";
import {
  type InspectedConstraint,
  inspectConstraints,
} from "./objects/constraints.ts";
import {
  type InspectedRelations,
  inspectRelations,
} from "./objects/relations/relations.ts";

export type InspectionResult = {
  collations: InspectedCollation[];
  constraints: InspectedConstraint[];
  tables: InspectedRelations["tables"];
  views: InspectedRelations["views"];
  materializedViews: InspectedRelations["materializedViews"];
  compositeTypes: InspectedRelations["compositeTypes"];
};

export async function inspect(sql: Sql): Promise<InspectionResult> {
  const collations = await inspectCollations(sql);
  const constraints = await inspectConstraints(sql);
  const relations = await inspectRelations(sql);

  return {
    collations,
    constraints,
    ...relations,
  };
}
