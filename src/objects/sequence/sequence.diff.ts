import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
import {
  AlterSequenceChangeOwner,
  ReplaceSequence,
} from "./changes/sequence.alter.ts";
import { CreateSequence } from "./changes/sequence.create.ts";
import { DropSequence } from "./changes/sequence.drop.ts";
import type { Sequence } from "./sequence.model.ts";

/**
 * Diff two sets of sequences from main and branch catalogs.
 *
 * @param main - The sequences in the main catalog.
 * @param branch - The sequences in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSequences(
  main: Record<string, Sequence>,
  branch: Record<string, Sequence>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const sequenceId of created) {
    changes.push(new CreateSequence({ sequence: branch[sequenceId] }));
  }

  for (const sequenceId of dropped) {
    changes.push(new DropSequence({ sequence: main[sequenceId] }));
  }

  for (const sequenceId of altered) {
    const mainSequence = main[sequenceId];
    const branchSequence = branch[sequenceId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the sequence
    const nonAlterablePropsChanged =
      mainSequence.data_type !== branchSequence.data_type ||
      mainSequence.start_value !== branchSequence.start_value ||
      mainSequence.minimum_value !== branchSequence.minimum_value ||
      mainSequence.maximum_value !== branchSequence.maximum_value ||
      mainSequence.increment !== branchSequence.increment ||
      mainSequence.cycle_option !== branchSequence.cycle_option ||
      mainSequence.cache_size !== branchSequence.cache_size ||
      mainSequence.persistence !== branchSequence.persistence;

    if (nonAlterablePropsChanged) {
      // Replace the entire sequence (drop + create)
      changes.push(
        new ReplaceSequence({ main: mainSequence, branch: branchSequence }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainSequence.owner !== branchSequence.owner) {
        changes.push(
          new AlterSequenceChangeOwner({
            main: mainSequence,
            branch: branchSequence,
          }),
        );
      }

      // Note: Sequence renaming would also use ALTER SEQUENCE ... RENAME TO ...
      // But since our Sequence model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
