/**
 * Builds a generic tree structure from a HierarchicalPlan.
 */

import {
  AlterTableAddColumn,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableDropColumn,
} from "../../core/objects/table/changes/table.alter.ts";
import type {
  ChangeEntry,
  ChangeGroup,
  HierarchicalPlan,
} from "../../core/plan/index.ts";
import type { TreeGroup, TreeItem } from "./tree-renderer.ts";

/**
 * Filter a ChangeGroup to only include structural changes (scope === "object").
 */
function filterStructuralChanges(group: ChangeGroup): ChangeGroup {
  return {
    create: group.create.filter((entry) => entry.serialized.scope === "object"),
    alter: group.alter.filter((entry) => entry.serialized.scope === "object"),
    drop: group.drop.filter((entry) => entry.serialized.scope === "object"),
  };
}

/**
 * Determines the primary operation symbol for an entity based on its structural changes.
 * Prioritizes create > alter > drop.
 */
function getEntitySymbol(group: ChangeGroup): string {
  const structural = filterStructuralChanges(group);
  if (structural.create.length > 0) return "+";
  if (structural.alter.length > 0) return "~";
  if (structural.drop.length > 0) return "-";
  return ""; // No structural changes
}

/**
 * Determines the primary operation symbol for a table based on its structural changes AND children changes.
 * This ensures consistency - if a table has children being created/altered/dropped, it shows a symbol.
 * Prioritizes create > alter > drop.
 */
function getTableSymbol(
  table: HierarchicalPlan["schemas"][string]["tables"][string],
): string {
  // First check table-level structural changes
  const tableStructural = filterStructuralChanges(table.changes);
  if (tableStructural.create.length > 0) return "+";
  if (tableStructural.alter.length > 0) return "~";
  if (tableStructural.drop.length > 0) return "-";

  // Then check children changes (columns, indexes, triggers, etc.)
  // Check columns
  const columnStructural = filterStructuralChanges(table.columns);
  if (columnStructural.create.length > 0) return "+";
  if (columnStructural.alter.length > 0) return "~";
  if (columnStructural.drop.length > 0) return "-";

  // Check indexes
  const indexStructural = filterStructuralChanges(table.indexes);
  if (indexStructural.create.length > 0) return "+";
  if (indexStructural.alter.length > 0) return "~";
  if (indexStructural.drop.length > 0) return "-";

  // Check triggers
  const triggerStructural = filterStructuralChanges(table.triggers);
  if (triggerStructural.create.length > 0) return "+";
  if (triggerStructural.alter.length > 0) return "~";
  if (triggerStructural.drop.length > 0) return "-";

  // Check rules
  const ruleStructural = filterStructuralChanges(table.rules);
  if (ruleStructural.create.length > 0) return "+";
  if (ruleStructural.alter.length > 0) return "~";
  if (ruleStructural.drop.length > 0) return "-";

  // Check policies
  const policyStructural = filterStructuralChanges(table.policies);
  if (policyStructural.create.length > 0) return "+";
  if (policyStructural.alter.length > 0) return "~";
  if (policyStructural.drop.length > 0) return "-";

  // Check partitions
  for (const partition of Object.values(table.partitions)) {
    const partitionSymbol = getTableSymbol(partition);
    if (partitionSymbol === "+") return "+";
    if (partitionSymbol === "~") return "~";
    if (partitionSymbol === "-") return "-";
  }

  return ""; // No structural changes in table or children
}

/**
 * Get display name for a change entry.
 * Uses instanceof checks to extract column names for column operations.
 */
function getDisplayName(entry: ChangeEntry): string {
  const { serialized, original } = entry;

  // For column operations, extract column name using instanceof
  // Column operations are stored in table.columns but serialized.name is the table name
  // We need to check the original Change object to get the actual column name
  if (
    original instanceof AlterTableAddColumn ||
    original instanceof AlterTableDropColumn ||
    original instanceof AlterTableAlterColumnType ||
    original instanceof AlterTableAlterColumnSetDefault ||
    original instanceof AlterTableAlterColumnDropDefault ||
    original instanceof AlterTableAlterColumnSetNotNull ||
    original instanceof AlterTableAlterColumnDropNotNull
  ) {
    return original.column.name;
  }

  // For all other changes, use the serialized name
  return serialized.name;
}

/**
 * Convert a ChangeGroup to TreeItems.
 */
function changeGroupToItems(group: ChangeGroup): TreeItem[] {
  const items: TreeItem[] = [];
  for (const entry of group.create) {
    items.push({ name: `+ ${getDisplayName(entry)}` });
  }
  for (const entry of group.alter) {
    items.push({ name: `~ ${getDisplayName(entry)}` });
  }
  for (const entry of group.drop) {
    items.push({ name: `- ${getDisplayName(entry)}` });
  }
  return items;
}

/**
 * Build tree structure for table children.
 */
function buildTableChildrenTree(
  table: HierarchicalPlan["schemas"][string]["tables"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  // Columns
  if (
    table.columns.create.length +
      table.columns.alter.length +
      table.columns.drop.length >
    0
  ) {
    groups.push({
      name: "columns",
      items: changeGroupToItems(table.columns),
    });
  }

  // Indexes
  if (
    table.indexes.create.length +
      table.indexes.alter.length +
      table.indexes.drop.length >
    0
  ) {
    groups.push({
      name: "indexes",
      items: changeGroupToItems(table.indexes),
    });
  }

  // Triggers
  if (
    table.triggers.create.length +
      table.triggers.alter.length +
      table.triggers.drop.length >
    0
  ) {
    groups.push({
      name: "triggers",
      items: changeGroupToItems(table.triggers),
    });
  }

  // Rules
  if (
    table.rules.create.length +
      table.rules.alter.length +
      table.rules.drop.length >
    0
  ) {
    groups.push({
      name: "rules",
      items: changeGroupToItems(table.rules),
    });
  }

  // Policies
  if (
    table.policies.create.length +
      table.policies.alter.length +
      table.policies.drop.length >
    0
  ) {
    groups.push({
      name: "policies",
      items: changeGroupToItems(table.policies),
    });
  }

  // Partitions
  const partitionNames = Object.keys(table.partitions).sort();
  if (partitionNames.length > 0) {
    const partitionGroups: TreeGroup[] = [];
    for (const partitionName of partitionNames) {
      const partition = table.partitions[partitionName];
      const symbol = getTableSymbol(partition);
      partitionGroups.push({
        name: symbol ? `${symbol} ${partitionName}` : partitionName,
        groups: buildTableChildrenTree(partition),
      });
    }
    groups.push({
      name: "partitions",
      groups: partitionGroups,
    });
  }

  return groups;
}

/**
 * Determines the primary operation symbol for a materialized view based on its structural changes AND children changes.
 * Similar to getTableSymbol but for materialized views.
 */
function getMaterializedViewSymbol(
  matview: HierarchicalPlan["schemas"][string]["materializedViews"][string],
): string {
  // First check view-level structural changes
  const viewStructural = filterStructuralChanges(matview.changes);
  if (viewStructural.create.length > 0) return "+";
  if (viewStructural.alter.length > 0) return "~";
  if (viewStructural.drop.length > 0) return "-";

  // Then check children changes (indexes)
  const indexStructural = filterStructuralChanges(matview.indexes);
  if (indexStructural.create.length > 0) return "+";
  if (indexStructural.alter.length > 0) return "~";
  if (indexStructural.drop.length > 0) return "-";

  return ""; // No structural changes in view or children
}

/**
 * Build tree structure for materialized view children.
 */
function buildMaterializedViewChildrenTree(
  matview: HierarchicalPlan["schemas"][string]["materializedViews"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  if (
    matview.indexes.create.length +
      matview.indexes.alter.length +
      matview.indexes.drop.length >
    0
  ) {
    groups.push({
      name: "indexes",
      items: changeGroupToItems(matview.indexes),
    });
  }

  return groups;
}

/**
 * Build tree structure for cluster group.
 */
function buildClusterTree(cluster: HierarchicalPlan["cluster"]): TreeGroup[] {
  const groups: TreeGroup[] = [];

  if (
    cluster.roles.create.length +
      cluster.roles.alter.length +
      cluster.roles.drop.length >
    0
  ) {
    groups.push({
      name: "roles",
      items: changeGroupToItems(cluster.roles),
    });
  }

  if (
    cluster.extensions.create.length +
      cluster.extensions.alter.length +
      cluster.extensions.drop.length >
    0
  ) {
    groups.push({
      name: "extensions",
      items: changeGroupToItems(cluster.extensions),
    });
  }

  if (
    cluster.eventTriggers.create.length +
      cluster.eventTriggers.alter.length +
      cluster.eventTriggers.drop.length >
    0
  ) {
    groups.push({
      name: "event-triggers",
      items: changeGroupToItems(cluster.eventTriggers),
    });
  }

  if (
    cluster.publications.create.length +
      cluster.publications.alter.length +
      cluster.publications.drop.length >
    0
  ) {
    groups.push({
      name: "publications",
      items: changeGroupToItems(cluster.publications),
    });
  }

  if (
    cluster.subscriptions.create.length +
      cluster.subscriptions.alter.length +
      cluster.subscriptions.drop.length >
    0
  ) {
    groups.push({
      name: "subscriptions",
      items: changeGroupToItems(cluster.subscriptions),
    });
  }

  if (
    cluster.foreignDataWrappers.create.length +
      cluster.foreignDataWrappers.alter.length +
      cluster.foreignDataWrappers.drop.length >
    0
  ) {
    groups.push({
      name: "foreign-data-wrappers",
      items: changeGroupToItems(cluster.foreignDataWrappers),
    });
  }

  if (
    cluster.servers.create.length +
      cluster.servers.alter.length +
      cluster.servers.drop.length >
    0
  ) {
    groups.push({
      name: "servers",
      items: changeGroupToItems(cluster.servers),
    });
  }

  if (
    cluster.userMappings.create.length +
      cluster.userMappings.alter.length +
      cluster.userMappings.drop.length >
    0
  ) {
    groups.push({
      name: "user-mappings",
      items: changeGroupToItems(cluster.userMappings),
    });
  }

  return groups;
}

/**
 * Build tree structure for schema group.
 */
function buildSchemaTree(
  schema: HierarchicalPlan["schemas"][string],
): TreeGroup[] {
  const groups: TreeGroup[] = [];

  // Tables
  const tableNames = Object.keys(schema.tables).sort();
  if (tableNames.length > 0) {
    const tableGroups: TreeGroup[] = [];
    for (const tableName of tableNames) {
      const table = schema.tables[tableName];
      const symbol = getTableSymbol(table);
      const childrenGroups = buildTableChildrenTree(table);
      
      // Only include table if it has structural changes OR has children with changes
      const tableStructural = filterStructuralChanges(table.changes);
      const hasTableChanges = tableStructural.create.length > 0 || tableStructural.alter.length > 0 || tableStructural.drop.length > 0;
      if (hasTableChanges || childrenGroups.length > 0) {
        tableGroups.push({
          name: symbol ? `${symbol} ${tableName}` : tableName,
          groups: childrenGroups,
        });
      }
    }
    if (tableGroups.length > 0) {
      groups.push({
        name: "tables",
        groups: tableGroups,
      });
    }
  }

  // Views
  const viewNames = Object.keys(schema.views).sort();
  if (viewNames.length > 0) {
    const viewGroups: TreeGroup[] = [];
    for (const viewName of viewNames) {
      const view = schema.views[viewName];
      const symbol = getTableSymbol(view);
      const viewChildrenGroups = buildTableChildrenTree(view);
      
      // Only include view if it has structural changes OR has children with changes
      const viewStructural = filterStructuralChanges(view.changes);
      const hasViewChanges = viewStructural.create.length > 0 || viewStructural.alter.length > 0 || viewStructural.drop.length > 0;
      if (hasViewChanges || viewChildrenGroups.length > 0) {
        viewGroups.push({
          name: symbol ? `${symbol} ${viewName}` : viewName,
          groups: viewChildrenGroups,
        });
      }
    }
    if (viewGroups.length > 0) {
      groups.push({
        name: "views",
        groups: viewGroups,
      });
    }
  }

  // Materialized Views
  const matviewNames = Object.keys(schema.materializedViews).sort();
  if (matviewNames.length > 0) {
    const matviewGroups: TreeGroup[] = [];
    for (const matviewName of matviewNames) {
      const matview = schema.materializedViews[matviewName];
      const symbol = getMaterializedViewSymbol(matview);
      const matviewChildrenGroups = buildMaterializedViewChildrenTree(matview);
      
      // Only include materialized view if it has structural changes OR has children with changes
      const matviewStructural = filterStructuralChanges(matview.changes);
      const hasMatviewChanges = matviewStructural.create.length > 0 || matviewStructural.alter.length > 0 || matviewStructural.drop.length > 0;
      if (hasMatviewChanges || matviewChildrenGroups.length > 0) {
        matviewGroups.push({
          name: symbol ? `${symbol} ${matviewName}` : matviewName,
          groups: matviewChildrenGroups,
        });
      }
    }
    if (matviewGroups.length > 0) {
      groups.push({
        name: "materialized-views",
        groups: matviewGroups,
      });
    }
  }

  // Functions
  if (
    schema.functions.create.length +
      schema.functions.alter.length +
      schema.functions.drop.length >
    0
  ) {
    groups.push({
      name: "functions",
      items: changeGroupToItems(schema.functions),
    });
  }

  // Procedures
  if (
    schema.procedures.create.length +
      schema.procedures.alter.length +
      schema.procedures.drop.length >
    0
  ) {
    groups.push({
      name: "procedures",
      items: changeGroupToItems(schema.procedures),
    });
  }

  // Aggregates
  if (
    schema.aggregates.create.length +
      schema.aggregates.alter.length +
      schema.aggregates.drop.length >
    0
  ) {
    groups.push({
      name: "aggregates",
      items: changeGroupToItems(schema.aggregates),
    });
  }

  // Sequences
  if (
    schema.sequences.create.length +
      schema.sequences.alter.length +
      schema.sequences.drop.length >
    0
  ) {
    groups.push({
      name: "sequences",
      items: changeGroupToItems(schema.sequences),
    });
  }

  // Types
  const hasTypes =
    schema.types.enums.create.length +
      schema.types.enums.alter.length +
      schema.types.enums.drop.length +
      schema.types.composites.create.length +
      schema.types.composites.alter.length +
      schema.types.composites.drop.length +
      schema.types.ranges.create.length +
      schema.types.ranges.alter.length +
      schema.types.ranges.drop.length +
      schema.types.domains.create.length +
      schema.types.domains.alter.length +
      schema.types.domains.drop.length >
    0;

  if (hasTypes) {
    const typeGroups: TreeGroup[] = [];
    if (
      schema.types.enums.create.length +
        schema.types.enums.alter.length +
        schema.types.enums.drop.length >
      0
    ) {
      typeGroups.push({
        name: "enums",
        items: changeGroupToItems(schema.types.enums),
      });
    }
    if (
      schema.types.composites.create.length +
        schema.types.composites.alter.length +
        schema.types.composites.drop.length >
      0
    ) {
      typeGroups.push({
        name: "composite-types",
        items: changeGroupToItems(schema.types.composites),
      });
    }
    if (
      schema.types.ranges.create.length +
        schema.types.ranges.alter.length +
        schema.types.ranges.drop.length >
      0
    ) {
      typeGroups.push({
        name: "ranges",
        items: changeGroupToItems(schema.types.ranges),
      });
    }
    if (
      schema.types.domains.create.length +
        schema.types.domains.alter.length +
        schema.types.domains.drop.length >
      0
    ) {
      typeGroups.push({
        name: "domains",
        items: changeGroupToItems(schema.types.domains),
      });
    }
    groups.push({
      name: "types",
      groups: typeGroups,
    });
  }

  // Collations
  if (
    schema.collations.create.length +
      schema.collations.alter.length +
      schema.collations.drop.length >
    0
  ) {
    groups.push({
      name: "collations",
      items: changeGroupToItems(schema.collations),
    });
  }

  // Foreign Tables
  const foreignTableNames = Object.keys(schema.foreignTables).sort();
  if (foreignTableNames.length > 0) {
    const ftGroups: TreeGroup[] = [];
    for (const ftName of foreignTableNames) {
      const ft = schema.foreignTables[ftName];
      const symbol = getTableSymbol(ft);
      const ftChildrenGroups = buildTableChildrenTree(ft);
      
      // Only include foreign table if it has structural changes OR has children with changes
      const ftStructural = filterStructuralChanges(ft.changes);
      const hasFtChanges = ftStructural.create.length > 0 || ftStructural.alter.length > 0 || ftStructural.drop.length > 0;
      if (hasFtChanges || ftChildrenGroups.length > 0) {
        ftGroups.push({
          name: symbol ? `${symbol} ${ftName}` : ftName,
          groups: ftChildrenGroups,
        });
      }
    }
    if (ftGroups.length > 0) {
      groups.push({
        name: "foreign-tables",
        groups: ftGroups,
      });
    }
  }

  return groups;
}

/**
 * Build a generic tree structure from a HierarchicalPlan.
 */
export function buildPlanTree(plan: HierarchicalPlan): TreeGroup {
  const rootGroups: TreeGroup[] = [];

  // Cluster-wide objects
  const clusterGroups = buildClusterTree(plan.cluster);
  if (clusterGroups.length > 0) {
    rootGroups.push({
      name: "cluster",
      groups: clusterGroups,
    });
  }

  // Schema-scoped objects
  const schemaNames = Object.keys(plan.schemas).sort();
  if (schemaNames.length > 0) {
    const schemaGroups: TreeGroup[] = [];
    for (const schemaName of schemaNames) {
      const schema = plan.schemas[schemaName];
      const structuralChanges = filterStructuralChanges(schema.changes);
      const symbol = getEntitySymbol(structuralChanges);
      const childGroups = buildSchemaTree(schema);
      
      // Only include schemas that have changes (structural changes or child objects with changes)
      const hasSchemaChanges = structuralChanges.create.length > 0 ||
        structuralChanges.alter.length > 0 ||
        structuralChanges.drop.length > 0;
      
      if (hasSchemaChanges || childGroups.length > 0) {
        schemaGroups.push({
          name: `${symbol} ${schemaName}`,
          groups: childGroups,
        });
      }
    }
    
    // Only add database group if there are schemas with changes
    if (schemaGroups.length > 0) {
      rootGroups.push({
        name: "database",
        groups: [
          {
            name: "schemas",
            groups: schemaGroups,
          },
        ],
      });
    }
  }

  return {
    name: "Migration Plan",
    groups: rootGroups,
  };
}
