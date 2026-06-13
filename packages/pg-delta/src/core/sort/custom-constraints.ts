import type { Change } from "../change.types.ts";
import { getSchema } from "../change-utils.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import { AlterMaterializedViewChangeOwner } from "../objects/materialized-view/changes/materialized-view.alter.ts";
import {
  AlterSequenceChangeOwner,
  AlterSequenceSetOwnedBy,
} from "../objects/sequence/changes/sequence.alter.ts";
import {
  AlterTableAlterColumnAddIdentity,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropIdentity,
  AlterTableAlterColumnSetDefault,
  AlterTableChangeOwner,
} from "../objects/table/changes/table.alter.ts";
import type { Constraint } from "./types.ts";

/**
 * Maps object type names to PostgreSQL default privilege objtype codes.
 * This mirrors the mapping in base.default-privileges.ts.
 */
function objectTypeToObjtype(objectType: string): string | null {
  switch (objectType) {
    case "table":
    case "view":
    case "materialized_view":
      return "r"; // Relations
    case "sequence":
      return "S"; // Sequences
    case "procedure":
    case "function":
    case "aggregate":
      return "f"; // Functions/routines
    case "type":
    case "domain":
    case "enum":
    case "range":
    case "composite_type":
      return "T"; // Types
    case "schema":
      return "n"; // Schemas
    default:
      return null;
  }
}

/**
 * A function that generates constraints for a list of changes.
 * Should be optimized to avoid O(N²) complexity by using lookups/indexing.
 */
type ConstraintGenerator = (changes: Change[]) => Constraint[];

/**
 * Generate constraints to ensure ALTER DEFAULT PRIVILEGES comes before CREATE statements.
 *
 * Rules:
 * - Only applies when the default privilege's schema matches the CREATE statement's schema
 *   (or if the default privilege is global, applies to all schemas)
 * - Only applies when the default privilege's objtype matches the CREATE statement's object type
 * - Excludes CREATE ROLE and CREATE SCHEMA since they are dependencies
 *   of ALTER DEFAULT PRIVILEGES and must come before it
 *
 * implementation: O(N) using schema/objtype indexing.
 */
function generateDefaultPrivilegeConstraints(changes: Change[]): Constraint[] {
  const constraints: Constraint[] = [];
  const defaultPrivilegeIndices: number[] = [];
  // Map<objtype_code, Map<schema_name, index[]>>
  const createsByObjTypeAndSchema = new Map<string, Map<string, number[]>>();

  // Pass 1: Index changes
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    // Identify default privilege changes
    if (
      change instanceof GrantRoleDefaultPrivileges ||
      change instanceof RevokeRoleDefaultPrivileges
    ) {
      defaultPrivilegeIndices.push(i);
      continue;
    }

    // Identify CREATE object changes (excluding role/schema)
    if (
      change.operation === "create" &&
      change.scope === "object" &&
      change.objectType !== "role" &&
      change.objectType !== "schema"
    ) {
      const objTypeCode = objectTypeToObjtype(change.objectType);
      if (!objTypeCode) continue;

      const schema = getSchema(change);
      // Default privileges only apply to schema-contained objects.
      if (schema) {
        let schemaMap = createsByObjTypeAndSchema.get(objTypeCode);
        if (!schemaMap) {
          schemaMap = new Map();
          createsByObjTypeAndSchema.set(objTypeCode, schemaMap);
        }

        let indices = schemaMap.get(schema);
        if (!indices) {
          indices = [];
          schemaMap.set(schema, indices);
        }
        indices.push(i);
      }
    }
  }

  // Pass 2: Generate constraints
  for (const privIndex of defaultPrivilegeIndices) {
    const privChange = changes[privIndex] as {
      inSchema: string | null;
      objtype: string;
    };
    const privSchema = privChange.inSchema;
    const privObjType = privChange.objtype;

    const schemaMap = createsByObjTypeAndSchema.get(privObjType);
    if (!schemaMap) continue;

    if (privSchema === null) {
      // Global default privilege: applies to ALL schemas
      for (const indices of schemaMap.values()) {
        for (const createIndex of indices) {
          // (No self-check needed as types differ)
          constraints.push({
            sourceChangeIndex: privIndex,
            targetChangeIndex: createIndex,
            source: "custom",
          });
        }
      }
    } else {
      // Specific schema: applies only to that schema
      const indices = schemaMap.get(privSchema);
      if (indices) {
        for (const createIndex of indices) {
          constraints.push({
            sourceChangeIndex: privIndex,
            targetChangeIndex: createIndex,
            source: "custom",
          });
        }
      }
    }
  }

  return constraints;
}

function generateIdentityTransitionConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const dropDefaultByColumn = new Map<string, number[]>();
  const dropIdentityByColumn = new Map<string, number[]>();
  const addIdentityByColumn = new Map<string, number[]>();
  const setDefaultByColumn = new Map<string, number[]>();
  const setDefaultChanges: Array<{
    index: number;
    change: AlterTableAlterColumnSetDefault;
  }> = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const columnKey =
      "table" in change && "column" in change
        ? `${change.table.schema}.${change.table.name}.${change.column.name}`
        : null;
    if (!columnKey) continue;

    if (change instanceof AlterTableAlterColumnDropDefault) {
      const entries = dropDefaultByColumn.get(columnKey) ?? [];
      entries.push(i);
      dropDefaultByColumn.set(columnKey, entries);
    } else if (change instanceof AlterTableAlterColumnAddIdentity) {
      const entries = addIdentityByColumn.get(columnKey) ?? [];
      entries.push(i);
      addIdentityByColumn.set(columnKey, entries);
    } else if (change instanceof AlterTableAlterColumnDropIdentity) {
      const entries = dropIdentityByColumn.get(columnKey) ?? [];
      entries.push(i);
      dropIdentityByColumn.set(columnKey, entries);
    } else if (change instanceof AlterTableAlterColumnSetDefault) {
      const entries = setDefaultByColumn.get(columnKey) ?? [];
      entries.push(i);
      setDefaultByColumn.set(columnKey, entries);
      setDefaultChanges.push({ index: i, change });
    }
  }

  // These rules only order same-column ALTERs inside the create/alter phase.
  // Sequence drops are handled separately in the earlier drop phase.
  for (const [columnKey, dropDefaultIndexes] of dropDefaultByColumn) {
    const addIdentityIndexes = addIdentityByColumn.get(columnKey) ?? [];
    for (const sourceIndex of dropDefaultIndexes) {
      for (const targetIndex of addIdentityIndexes) {
        constraints.push({
          sourceChangeIndex: sourceIndex,
          targetChangeIndex: targetIndex,
          source: "custom",
        });
      }
    }
  }

  for (const [columnKey, dropIdentityIndexes] of dropIdentityByColumn) {
    const setDefaultIndexes = setDefaultByColumn.get(columnKey) ?? [];
    for (const sourceIndex of dropIdentityIndexes) {
      for (const targetIndex of setDefaultIndexes) {
        constraints.push({
          sourceChangeIndex: sourceIndex,
          targetChangeIndex: targetIndex,
          source: "custom",
        });
      }
    }
  }

  for (const { index: targetIndex, change } of setDefaultChanges) {
    if (!change.table.parent_schema || !change.table.parent_name) continue;

    const parentColumnKey = `${change.table.parent_schema}.${change.table.parent_name}.${change.column.name}`;
    const parentSetDefaultIndexes =
      setDefaultByColumn.get(parentColumnKey) ?? [];
    for (const sourceIndex of parentSetDefaultIndexes) {
      if (sourceIndex === targetIndex) continue;
      constraints.push({
        sourceChangeIndex: sourceIndex,
        targetChangeIndex: targetIndex,
        source: "custom",
      });
    }
  }

  return constraints;
}

function parseTableStableIdFromStableId(id: string): string | null {
  if (id.startsWith("table:")) {
    return id;
  }
  const parseSubEntity = (prefix: string) => {
    if (!id.startsWith(prefix)) return null;
    const parts = id.slice(prefix.length).split(".");
    if (parts.length < 2) return null;
    return `table:${parts[0]}.${parts[1]}`;
  };
  return (
    parseSubEntity("column:") ??
    parseSubEntity("constraint:") ??
    parseSubEntity("index:")
  );
}

function getRelatedTableStableIds(change: Change): Set<string> {
  const tableIds = new Set<string>();
  if (
    "table" in change &&
    change.table &&
    typeof change.table === "object" &&
    "stableId" in change.table &&
    typeof change.table.stableId === "string"
  ) {
    tableIds.add(change.table.stableId);
  }
  if (
    "index" in change &&
    change.index &&
    typeof change.index === "object" &&
    "tableStableId" in change.index &&
    typeof change.index.tableStableId === "string"
  ) {
    tableIds.add(change.index.tableStableId);
  }
  for (const id of [
    ...change.creates,
    ...change.drops,
    ...change.requires,
    ...change.invalidates,
  ]) {
    const tableId = parseTableStableIdFromStableId(id);
    if (tableId) tableIds.add(tableId);
  }
  return tableIds;
}

function generateTableOwnerRestoreLastConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const ownerChanges: Array<{ index: number; tableId: string }> = [];
  const changesByTable = new Map<string, number[]>();

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (
      change.objectType !== "sequence" &&
      !(change instanceof AlterTableChangeOwner)
    ) {
      const tableIds = getRelatedTableStableIds(change);
      for (const tableId of tableIds) {
        const indexes = changesByTable.get(tableId) ?? [];
        indexes.push(index);
        changesByTable.set(tableId, indexes);
      }
    }
    if (change instanceof AlterTableChangeOwner) {
      ownerChanges.push({ index, tableId: change.table.stableId });
    }
  }

  for (const ownerChange of ownerChanges) {
    const relatedIndexes = changesByTable.get(ownerChange.tableId) ?? [];
    for (const relatedIndex of relatedIndexes) {
      if (relatedIndex === ownerChange.index) continue;
      constraints.push({
        sourceChangeIndex: relatedIndex,
        targetChangeIndex: ownerChange.index,
        source: "custom",
      });
    }
  }

  return constraints;
}

function parseMaterializedViewStableIdFromStableId(id: string): string | null {
  if (id.startsWith("materializedView:")) {
    return id;
  }
  return null;
}

function getRelatedMaterializedViewStableIds(change: Change): Set<string> {
  const materializedViewIds = new Set<string>();
  if (
    "materializedView" in change &&
    change.materializedView &&
    typeof change.materializedView === "object" &&
    "stableId" in change.materializedView &&
    typeof change.materializedView.stableId === "string"
  ) {
    materializedViewIds.add(change.materializedView.stableId);
  }
  if (
    "index" in change &&
    change.index &&
    typeof change.index === "object" &&
    "tableStableId" in change.index &&
    typeof change.index.tableStableId === "string" &&
    change.index.tableStableId.startsWith("materializedView:")
  ) {
    materializedViewIds.add(change.index.tableStableId);
  }
  for (const id of [
    ...change.creates,
    ...change.drops,
    ...change.requires,
    ...change.invalidates,
  ]) {
    const materializedViewId = parseMaterializedViewStableIdFromStableId(id);
    if (materializedViewId) materializedViewIds.add(materializedViewId);
  }
  return materializedViewIds;
}

function generateMaterializedViewOwnerRestoreLastConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const ownerChanges: Array<{ index: number; materializedViewId: string }> = [];
  const changesByMaterializedView = new Map<string, number[]>();

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (!(change instanceof AlterMaterializedViewChangeOwner)) {
      const materializedViewIds = getRelatedMaterializedViewStableIds(change);
      for (const materializedViewId of materializedViewIds) {
        const indexes = changesByMaterializedView.get(materializedViewId) ?? [];
        indexes.push(index);
        changesByMaterializedView.set(materializedViewId, indexes);
      }
    } else {
      ownerChanges.push({
        index,
        materializedViewId: change.materializedView.stableId,
      });
    }
  }

  for (const ownerChange of ownerChanges) {
    const relatedIndexes =
      changesByMaterializedView.get(ownerChange.materializedViewId) ?? [];
    for (const relatedIndex of relatedIndexes) {
      if (relatedIndex === ownerChange.index) continue;
      constraints.push({
        sourceChangeIndex: relatedIndex,
        targetChangeIndex: ownerChange.index,
        source: "custom",
      });
    }
  }

  return constraints;
}

function parseSequenceStableIdFromStableId(id: string): string | null {
  if (id.startsWith("sequence:")) {
    return id;
  }
  return null;
}

function getRelatedSequenceStableIds(change: Change): Set<string> {
  const sequenceIds = new Set<string>();
  if (
    "sequence" in change &&
    change.sequence &&
    typeof change.sequence === "object" &&
    "stableId" in change.sequence &&
    typeof change.sequence.stableId === "string"
  ) {
    sequenceIds.add(change.sequence.stableId);
  }
  for (const id of [
    ...change.creates,
    ...change.drops,
    ...change.requires,
    ...change.invalidates,
  ]) {
    const sequenceId = parseSequenceStableIdFromStableId(id);
    if (sequenceId) sequenceIds.add(sequenceId);
  }
  return sequenceIds;
}

function generateSequenceOwnerRestoreLastConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const ownerChanges: Array<{ index: number; sequenceId: string }> = [];
  const changesBySequence = new Map<string, number[]>();

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (change instanceof AlterSequenceChangeOwner) {
      ownerChanges.push({
        index,
        sequenceId: change.sequence.stableId,
      });
      continue;
    }
    if (change instanceof AlterSequenceSetOwnedBy && change.ownedBy !== null) {
      continue;
    }
    const sequenceIds = getRelatedSequenceStableIds(change);
    for (const sequenceId of sequenceIds) {
      const indexes = changesBySequence.get(sequenceId) ?? [];
      indexes.push(index);
      changesBySequence.set(sequenceId, indexes);
    }
  }

  for (const ownerChange of ownerChanges) {
    const relatedIndexes = changesBySequence.get(ownerChange.sequenceId) ?? [];
    for (const relatedIndex of relatedIndexes) {
      if (relatedIndex === ownerChange.index) continue;
      constraints.push({
        sourceChangeIndex: relatedIndex,
        targetChangeIndex: ownerChange.index,
        source: "custom",
      });
    }
  }

  return constraints;
}

function generateOwnedSequenceAttachmentConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const tableOwnerChanges = new Map<string, number[]>();
  const sequenceOwnerChanges = new Map<string, number[]>();
  const ownedSequenceOwnerChanges: Array<{
    index: number;
    tableId: string;
  }> = [];
  const ownedByChanges: Array<{
    index: number;
    sequenceId: string;
    tableId: string;
  }> = [];

  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (change instanceof AlterTableChangeOwner) {
      const entries = tableOwnerChanges.get(change.table.stableId) ?? [];
      entries.push(index);
      tableOwnerChanges.set(change.table.stableId, entries);
    } else if (change instanceof AlterSequenceChangeOwner) {
      const entries = sequenceOwnerChanges.get(change.sequence.stableId) ?? [];
      entries.push(index);
      sequenceOwnerChanges.set(change.sequence.stableId, entries);
      if (change.sequence.owned_by_schema && change.sequence.owned_by_table) {
        ownedSequenceOwnerChanges.push({
          index,
          tableId: `table:${change.sequence.owned_by_schema}.${change.sequence.owned_by_table}`,
        });
      }
    } else if (
      change instanceof AlterSequenceSetOwnedBy &&
      change.ownedBy !== null
    ) {
      ownedByChanges.push({
        index,
        sequenceId: change.sequence.stableId,
        tableId: `table:${change.ownedBy.schema}.${change.ownedBy.table}`,
      });
    }
  }

  for (const sequenceOwnerChange of ownedSequenceOwnerChanges) {
    for (const sourceChangeIndex of tableOwnerChanges.get(
      sequenceOwnerChange.tableId,
    ) ?? []) {
      if (sourceChangeIndex === sequenceOwnerChange.index) continue;
      constraints.push({
        sourceChangeIndex,
        targetChangeIndex: sequenceOwnerChange.index,
        source: "custom",
      });
    }
  }

  for (const ownedByChange of ownedByChanges) {
    for (const sourceChangeIndex of [
      ...(tableOwnerChanges.get(ownedByChange.tableId) ?? []),
      ...(sequenceOwnerChanges.get(ownedByChange.sequenceId) ?? []),
    ]) {
      if (sourceChangeIndex === ownedByChange.index) continue;
      constraints.push({
        sourceChangeIndex,
        targetChangeIndex: ownedByChange.index,
        source: "custom",
      });
    }
  }

  return constraints;
}

/**
 * All custom constraint generators.
 */
const customConstraintGenerators: ConstraintGenerator[] = [
  generateDefaultPrivilegeConstraints,
  generateIdentityTransitionConstraints,
  generateTableOwnerRestoreLastConstraints,
  generateMaterializedViewOwnerRestoreLastConstraints,
  generateSequenceOwnerRestoreLastConstraints,
  generateOwnedSequenceAttachmentConstraints,
];

/**
 * Generate Constraints from custom constraint generators.
 *
 * Iterates through registered generators to produce constraints.
 * Generators should be optimized (e.g. using indexing) to avoid O(N²) complexity.
 */
export function generateCustomConstraints(changes: Change[]): Constraint[] {
  return customConstraintGenerators.flatMap((generate) => generate(changes));
}
