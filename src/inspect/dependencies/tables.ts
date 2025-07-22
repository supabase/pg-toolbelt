import { identifyDomain } from "../objects/domains.ts";
import { identifyEnum } from "../objects/enums.ts";
import { identifyTable } from "../objects/tables.ts";
import { identifyType } from "../objects/types.ts";
import type { InspectionKey, InspectionMap } from "../types.ts";
import type { SelectableDependenciesMap } from "./types.ts";
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
      if (
        column.is_custom_type &&
        column.custom_type_type &&
        column.custom_type_schema &&
        column.custom_type_name
      ) {
        let key: InspectionKey;
        switch (column.custom_type_type) {
          case "e":
            key = `enum:${identifyEnum({
              schema: column.custom_type_schema,
              name: column.custom_type_name,
            })}` as const;
            break;
          case "c":
            key = `compositeType:${identifyType({
              schema: column.custom_type_schema,
              name: column.custom_type_name,
            })}` as const;
            break;
          case "d":
            key = `domain:${identifyDomain({
              schema: column.custom_type_schema,
              name: column.custom_type_name,
            })}` as const;
            break;
          default:
            throw new Error(
              `Unsupported custom type : ${column.custom_type_type}`,
            );
        }
        if (inspection[key]) {
          column.dependent_on.push(key);
        }
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
