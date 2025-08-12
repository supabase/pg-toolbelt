import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import { hasNonAlterableChanges } from "../utils.ts";
import {
  AlterSchemaChangeOwner,
  ReplaceSchema,
} from "./changes/schema.alter.ts";
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
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const schemaId of created) {
    changes.push(new CreateSchema({ schema: branch[schemaId] }));
  }

  for (const schemaId of dropped) {
    changes.push(new DropSchema({ schema: main[schemaId] }));
  }

  for (const schemaId of altered) {
    const mainSchema = main[schemaId];
    const branchSchema = branch[schemaId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the schema
    const NON_ALTERABLE_FIELDS: Array<keyof Schema> = [];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainSchema,
      branchSchema,
      NON_ALTERABLE_FIELDS,
    ); // All schema properties are alterable

    if (nonAlterablePropsChanged) {
      // Replace the entire schema (drop + create)
      changes.push(
        new ReplaceSchema({ main: mainSchema, branch: branchSchema }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainSchema.owner !== branchSchema.owner) {
        changes.push(
          new AlterSchemaChangeOwner({
            main: mainSchema,
            branch: branchSchema,
          }),
        );
      }

      // Note: Schema renaming would also use ALTER SCHEMA ... RENAME TO ...
      // But since our Schema model uses 'schema' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
