import type { Change } from "../change.types.ts";
import { getSchema } from "../change-utils.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainSetDefault,
} from "../objects/domain/changes/domain.alter.ts";
import { CreateProcedure } from "../objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "../objects/procedure/changes/procedure.drop.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import {
  AlterTableAlterColumnAddIdentity,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropIdentity,
  AlterTableAlterColumnSetDefault,
  AlterTableAddConstraint,
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

function generateProcedureSignatureReplacementConstraints(
  changes: Change[],
): Constraint[] {
  const constraints: Constraint[] = [];
  const createProcedureIndexesByName = new Map<string, number[]>();
  const createdProcedureIds = new Set<string>();
  const dropProcedureIndexes: Array<{
    index: number;
    id: string;
    key: string;
  }> = [];
  const expressionUpdateIndexes: number[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change instanceof CreateProcedure) {
      for (const id of change.creates ?? []) {
        createdProcedureIds.add(id);
        const key = parseProcedureSchemaName(id);
        if (!key) continue;
        const entries = createProcedureIndexesByName.get(key) ?? [];
        entries.push(i);
        createProcedureIndexesByName.set(key, entries);
      }
    } else if (change instanceof DropProcedure) {
      for (const id of change.drops ?? []) {
        const key = parseProcedureSchemaName(id);
        if (key) {
          dropProcedureIndexes.push({ index: i, id, key });
        }
      }
    } else if (
      change instanceof AlterTableAlterColumnSetDefault ||
      change instanceof AlterDomainSetDefault ||
      change instanceof AlterTableAddConstraint ||
      change instanceof AlterDomainAddConstraint
    ) {
      expressionUpdateIndexes.push(i);
    }
  }

  for (const drop of dropProcedureIndexes) {
    if (createdProcedureIds.has(drop.id)) continue;
    const createIndexes = createProcedureIndexesByName.get(drop.key) ?? [];
    if (createIndexes.length === 0) continue;

    for (const createIndex of createIndexes) {
      constraints.push({
        sourceChangeIndex: createIndex,
        targetChangeIndex: drop.index,
        source: "custom",
      });
    }

    for (const expressionUpdateIndex of expressionUpdateIndexes) {
      // Restore expressions only after the old overload is gone; otherwise
      // PostgreSQL can bind the recreated expression back to the exact old
      // signature and make the following DROP FUNCTION fail.
      constraints.push({
        sourceChangeIndex: drop.index,
        targetChangeIndex: expressionUpdateIndex,
        source: "custom",
      });
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

  return constraints;
}

/**
 * All custom constraint generators.
 */
const customConstraintGenerators: ConstraintGenerator[] = [
  generateDefaultPrivilegeConstraints,
  generateProcedureSignatureReplacementConstraints,
  generateIdentityTransitionConstraints,
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

function parseProcedureSchemaName(stableId: string): string | null {
  if (!stableId.startsWith("procedure:")) return null;
  const paren = stableId.indexOf("(");
  if (paren === -1) return null;
  return stableId.slice("procedure:".length, paren);
}
