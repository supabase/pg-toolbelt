import { identifyTable } from "../objects/tables.ts";
import type { InspectionMap } from "../types.ts";
import type {
  SelectableDependenciesMap,
} from "./types.ts";
import { filterInspectionByPrefix } from "./utils.ts";

/**
 * Adds table inheritance and partitioning dependencies to the inspection map.
 *
 * For each table, if it has a parent_schema and parent_name, it will add the parent as a dependency.
 * This covers both table inheritance and table partitioning.
 */
export function buildTableDependencies(
  selectableDependencies: SelectableDependenciesMap,
  inspection: InspectionMap,
) {
  for (const [tableKey, table] of filterInspectionByPrefix(
    inspection,
    "table",
  )) {
    // Add partitioned and inherited table dependencies
    if (table.parent_schema && table.parent_name) {
      const parentKey = `table:${identifyTable({
        schema: table.parent_schema,
        name: table.parent_name,
      })}` as const;
      const parent = inspection[parentKey];
      if (parent) {
        if (!table.dependent_on.includes(parentKey)) {
          table.dependent_on.push(parentKey);
        }
        if (!parent.dependents.includes(tableKey)) {
          parent.dependents.push(tableKey);
        }
      }
    }

    // Add columns dependencies
    for (const column of table.columns) {
      if (column.data_type) {
      }
    }

    // Add selectable dependencies (composites types, functions, views, materialized views)
    if (selectableDependencies[tableKey]) {
      for (const dependentOn of selectableDependencies[tableKey].dependent_on) {
        if (inspection[dependentOn]) {
          inspection[dependentOn].dependents.push(tableKey);
        }
      }
    }
  }
}
