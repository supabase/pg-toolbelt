import type { Change } from "../change.types.ts";
import {
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropIdentity,
  AlterTableAlterColumnType,
} from "../objects/table/changes/table.alter.ts";

/**
 * Execution phases for changes.
 */
export type Phase = "drop" | "create_alter_object";

/**
 * Check if a stable ID represents metadata (ACL, default privileges, comments, etc.)
 * rather than an actual database object.
 *
 * Unified check used by both logical sorting and dependency sorting.
 */
export function isMetadataStableId(stableId: string): boolean {
  return (
    stableId.startsWith("acl:") ||
    stableId.startsWith("defacl:") ||
    stableId.startsWith("aclcol:") ||
    stableId.startsWith("membership:") ||
    stableId.startsWith("comment:")
  );
}

/**
 * Determine the execution phase for a change based on its properties.
 *
 * Rules:
 * - DROP operations → drop phase
 * - CREATE operations → create_alter_object phase
 * - ALTER operations with scope="privilege" → create_alter_object phase (metadata changes)
 * - ALTER operations that drop actual objects → drop phase (destructive ALTER)
 * - ALTER operations that don't drop objects → create_alter_object phase (non-destructive ALTER)
 *
 * Dependency-breaking ALTERs that remove a `pg_depend` edge to another
 * object that may be dropped in the same plan (for example
 * `ALTER COLUMN ... DROP DEFAULT` releasing a sequence reference, or
 * `ALTER COLUMN ... TYPE <built-in>` releasing a user-defined type
 * reference) are routed to the drop phase. The drop phase sorts in reverse
 * dependency order using the main catalog, so the catalog edges already
 * in `pg_depend` order the ALTER before any dependent `DROP TYPE` /
 * `DROP SEQUENCE` / `DROP FUNCTION` and PostgreSQL no longer rejects the
 * drop with error 2BP01.
 */
export function getExecutionPhase(change: Change): Phase {
  // DROP operations always go to drop phase
  if (change.operation === "drop") {
    return "drop";
  }

  // CREATE operations always go to create_alter phase
  if (change.operation === "create") {
    return "create_alter_object";
  }

  // For ALTER operations, determine based on what they do
  if (change.operation === "alter") {
    // Privilege changes (metadata) always go to create_alter phase
    if (change.scope === "privilege") {
      return "create_alter_object";
    }

    // Check if this ALTER drops actual objects (not metadata)
    const droppedIds = change.drops ?? [];
    const dropsObjects = droppedIds.some(
      (id: string) => !isMetadataStableId(id),
    );

    if (dropsObjects) {
      // Destructive ALTER (DROP COLUMN, DROP CONSTRAINT, etc.) → drop phase
      return "drop";
    }

    // Dependency-breaking column ALTERs that release a pg_depend edge.
    // Routing these to the drop phase lets the existing catalog dependency
    // edges (column → sequence, column → identity sequence) order them
    // before the matching DROP statement.
    if (
      change instanceof AlterTableAlterColumnDropDefault ||
      change instanceof AlterTableAlterColumnDropIdentity
    ) {
      return "drop";
    }

    // ALTER COLUMN ... TYPE only safely runs in the drop phase when the
    // target type is built-in. For user-defined target types we cannot tell
    // here whether the type is created in the same plan, and the create
    // happens in create_alter phase, so we keep the alter in that phase to
    // preserve the create-then-alter ordering.
    if (
      change instanceof AlterTableAlterColumnType &&
      !change.column.is_custom_type
    ) {
      return "drop";
    }

    // Non-destructive ALTER (ADD COLUMN, GRANT, etc.) → create_alter phase
    return "create_alter_object";
  }

  // Safe default
  return "create_alter_object";
}
