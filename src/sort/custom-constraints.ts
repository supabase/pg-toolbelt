import type { Change } from "../change.types.ts";
import { getSchema } from "../filter/utils.ts";
import {
  GrantRoleDefaultPrivileges,
  RevokeRoleDefaultPrivileges,
} from "../objects/role/changes/role.privilege.ts";
import type { Constraint, CustomConstraintFunction } from "./types.ts";

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
 * Ensure ALTER DEFAULT PRIVILEGES comes before CREATE statements.
 *
 * This constraint is targeted:
 * - Only applies when the default privilege's schema matches the CREATE statement's schema
 *   (or if the default privilege is global, applies to all schemas)
 * - Only applies when the default privilege's objtype matches the CREATE statement's object type
 * - Excludes CREATE ROLE and CREATE SCHEMA since they are dependencies
 *   of ALTER DEFAULT PRIVILEGES and must come before it
 */
function defaultPrivilegesBeforeCreate(
  a: Change,
  b: Change,
): "a_before_b" | undefined {
  const aIsDefaultPriv =
    a instanceof GrantRoleDefaultPrivileges ||
    a instanceof RevokeRoleDefaultPrivileges;
  const bIsCreate = b.operation === "create" && b.scope === "object";

  if (!aIsDefaultPriv || !bIsCreate) {
    return undefined;
  }

  // Exclude CREATE ROLE and CREATE SCHEMA since they are dependencies
  // of ALTER DEFAULT PRIVILEGES and must come before it
  if (b.objectType === "role" || b.objectType === "schema") {
    return undefined;
  }

  // Get the schema and objtype from the default privilege change
  const defaultPrivSchema = (a as { inSchema: string | null }).inSchema;
  const defaultPrivObjtype = (a as { objtype: string }).objtype;

  // Get the schema from the CREATE statement
  const createSchema = getSchema(b);

  // Default privileges only apply to schema-dependent objects
  // If the CREATE statement is for a non-schema object, skip the constraint
  if (createSchema === null) {
    return undefined;
  }

  // Match schema: if default privilege is global (null), it applies to all schemas
  // Otherwise, schemas must match
  const schemasMatch =
    defaultPrivSchema === null || defaultPrivSchema === createSchema;

  if (!schemasMatch) {
    return undefined;
  }

  // Match object type: convert CREATE statement's object type to objtype
  const createObjtype = objectTypeToObjtype(b.objectType);

  // Only apply constraint if objtypes match
  if (defaultPrivObjtype === createObjtype) {
    return "a_before_b";
  }

  return undefined;
}

/**
 * All custom constraints.
 *
 * Add new constraints here to extend the sorting behavior.
 */
const customConstraints: CustomConstraintFunction[] = [
  defaultPrivilegesBeforeCreate,
];

/**
 * Generate Constraints from custom constraint functions.
 *
 * Iterates through all pairs of changes and applies each custom constraint,
 * converting the pairwise decisions into Constraints.
 */
export function generateCustomConstraints(changes: Change[]): Constraint[] {
  const constraints: Constraint[] = [];

  for (let i = 0; i < changes.length; i++) {
    for (let j = 0; j < changes.length; j++) {
      if (i === j) continue;

      const a = changes[i];
      const b = changes[j];

      for (const customConstraint of customConstraints) {
        const decision = customConstraint(a, b);
        if (!decision) continue;

        const sourceIndex = decision === "a_before_b" ? i : j;
        const targetIndex = decision === "a_before_b" ? j : i;

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
