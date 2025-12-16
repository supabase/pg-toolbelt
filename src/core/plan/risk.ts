/**
 * Risk classification for migration plans.
 * Identifies data-loss operations that require explicit confirmation.
 */

import type { Change } from "../change.types.ts";
import { DropSequence } from "../objects/sequence/changes/sequence.drop.ts";
import { AlterTableDropColumn } from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import type { PlanRisk } from "./types.ts";

/**
 * Classify a single change for data-loss risk.
 */
function classifyChangeRisk(change: Change): string | null {
  if (change instanceof DropTable) {
    return `drop table ${change.table.schema}.${change.table.name}`;
  }

  if (change instanceof AlterTableDropColumn) {
    return `drop column ${change.column.name} on ${change.table.schema}.${change.table.name}`;
  }

  if (change instanceof DropSequence) {
    return `drop sequence ${change.sequence.schema}.${change.sequence.name}`;
  }

  // Extend here if TRUNCATE or other data-loss operations are added.
  return null;
}

/**
 * Classify all changes for data-loss risk.
 */
export function classifyChangesRisk(changes: Change[]): PlanRisk {
  const statements: string[] = [];

  for (const change of changes) {
    const reason = classifyChangeRisk(change);
    if (reason) statements.push(reason);
  }

  if (statements.length > 0) {
    return { level: "data_loss", statements };
  }

  return { level: "safe" };
}
