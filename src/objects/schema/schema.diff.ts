import type { BaseChange } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { AlterSchemaChangeOwner } from "./changes/schema.alter.ts";
import {
  CreateCommentOnSchema,
  DropCommentOnSchema,
} from "./changes/schema.comment.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import type { Schema } from "./schema.model.ts";

/**
 * Diff two sets of schemas from main and branch catalogs.
 *
 * @param main - The schemas in the main catalog.
 * @param branch - The schemas in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSchemas(
  main: Record<string, Schema>,
  branch: Record<string, Schema>,
): BaseChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: BaseChange[] = [];

  for (const schemaId of created) {
    const sc = branch[schemaId];
    changes.push(new CreateSchema({ schema: sc }));
    if (sc.comment !== null) {
      changes.push(new CreateCommentOnSchema({ schemaObj: sc }));
    }
  }

  for (const schemaId of dropped) {
    changes.push(new DropSchema({ schema: main[schemaId] }));
  }

  for (const schemaId of altered) {
    const mainSchema = main[schemaId];
    const branchSchema = branch[schemaId];

    // OWNER
    if (mainSchema.owner !== branchSchema.owner) {
      changes.push(
        new AlterSchemaChangeOwner({
          schemaObj: mainSchema,
          owner: branchSchema.owner,
        }),
      );
    }

    // COMMENT
    if (mainSchema.comment !== branchSchema.comment) {
      if (branchSchema.comment === null) {
        changes.push(new DropCommentOnSchema({ schemaObj: mainSchema }));
      } else {
        changes.push(new CreateCommentOnSchema({ schemaObj: branchSchema }));
      }
    }

    // Note: Schema renaming would also use ALTER SCHEMA ... RENAME TO ...
    // But since our Schema model uses 'schema' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}
