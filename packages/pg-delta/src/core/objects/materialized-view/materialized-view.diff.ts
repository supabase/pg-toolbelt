import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  emitColumnPrivilegeChanges,
} from "../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../diff-context.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "./changes/materialized-view.alter.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "./changes/materialized-view.comment.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import {
  GrantMaterializedViewPrivileges,
  RevokeGrantOptionMaterializedViewPrivileges,
  RevokeMaterializedViewPrivileges,
} from "./changes/materialized-view.privilege.ts";
import type { MaterializedViewChange } from "./changes/materialized-view.types.ts";
import type { MaterializedView } from "./materialized-view.model.ts";

/**
 * Diff two sets of materialized views from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The materialized views in the main catalog.
 * @param branch - The materialized views in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffMaterializedViews(
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
  main: Record<string, MaterializedView>,
  branch: Record<string, MaterializedView>,
): MaterializedViewChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: MaterializedViewChange[] = [];

  for (const materializedViewId of created) {
    const mv = branch[materializedViewId];
    changes.push(
      new CreateMaterializedView({
        materializedView: mv,
      }),
    );

    // OWNER: If the materialized view should be owned by someone other than the current user,
    // emit ALTER MATERIALIZED VIEW ... OWNER TO after creation
    if (mv.owner !== ctx.currentUser) {
      changes.push(
        new AlterMaterializedViewChangeOwner({
          materializedView: mv,
          owner: mv.owner,
        }),
      );
    }

    // Note: RLS (row_security, force_row_security) is a non-alterable property for materialized views.
    // If RLS needs to be enabled, the materialized view must be dropped and recreated, which is
    // handled in the "altered" section when non-alterable properties change.

    // Materialized view comment on creation
    if (mv.comment !== null) {
      changes.push(
        new CreateCommentOnMaterializedView({
          materializedView: mv,
        }),
      );
    }
    // Column comments on creation
    for (const col of mv.columns) {
      if (col.comment !== null) {
        changes.push(
          new CreateCommentOnMaterializedViewColumn({
            materializedView: mv,
            column: col,
          }),
        );
      }
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "materialized_view",
      mv.schema ?? "",
    );
    const creatorFilteredDefaults =
      mv.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    const desiredPrivileges = mv.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the materialized view owner as the reference.
    const privilegeResults = diffPrivileges(
      creatorFilteredDefaults,
      desiredPrivileges,
      mv.owner,
    );

    changes.push(
      ...(emitColumnPrivilegeChanges(
        privilegeResults,
        mv,
        mv,
        "materializedView",
        {
          Grant: GrantMaterializedViewPrivileges,
          Revoke: RevokeMaterializedViewPrivileges,
          RevokeGrantOption: RevokeGrantOptionMaterializedViewPrivileges,
        },
        effectiveDefaults,
        ctx.version,
      ) as MaterializedViewChange[]),
    );
  }

  for (const materializedViewId of dropped) {
    changes.push(
      new DropMaterializedView({ materializedView: main[materializedViewId] }),
    );
  }

  for (const materializedViewId of altered) {
    const mainMaterializedView = main[materializedViewId];
    const branchMaterializedView = branch[materializedViewId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the materialized view
    const NON_ALTERABLE_FIELDS: Array<keyof MaterializedView> = [
      "definition",
      "row_security",
      "force_row_security",
      "has_indexes",
      "has_rules",
      "has_triggers",
      "has_subclasses",
      "is_populated",
      "replica_identity",
      "is_partition",
      "partition_bound",
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainMaterializedView,
      branchMaterializedView,
      NON_ALTERABLE_FIELDS,
      { options: deepEqual },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire materialized view (drop + create)
      changes.push(
        new DropMaterializedView({ materializedView: mainMaterializedView }),
        new CreateMaterializedView({
          materializedView: branchMaterializedView,
        }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainMaterializedView.owner !== branchMaterializedView.owner) {
        changes.push(
          new AlterMaterializedViewChangeOwner({
            materializedView: mainMaterializedView,
            owner: branchMaterializedView.owner,
          }),
        );
      }

      // STORAGE PARAMETERS (reloptions)
      // Emit a combined SET/RESET change similar to indexes
      if (
        !deepEqual(mainMaterializedView.options, branchMaterializedView.options)
      ) {
        const parseOptions = (options: string[] | null | undefined) => {
          const map = new Map<string, string>();
          if (!options) return map;
          for (const opt of options) {
            const eqIndex = opt.indexOf("=");
            const key = opt.slice(0, eqIndex).trim();
            const value = opt.slice(eqIndex + 1).trim();
            map.set(key, value);
          }
          return map;
        };
        const mainMap = parseOptions(mainMaterializedView.options);
        const branchMap = parseOptions(branchMaterializedView.options);
        const keysToReset: string[] = [];
        for (const key of mainMap.keys()) {
          if (!branchMap.has(key)) keysToReset.push(key);
        }
        const paramsToSet: string[] = [];
        for (const [key, newValue] of branchMap.entries()) {
          const oldValue = mainMap.get(key);
          const changed = oldValue !== newValue;
          if (changed) {
            paramsToSet.push(
              newValue === undefined ? key : `${key}=${newValue}`,
            );
          }
        }
        changes.push(
          new AlterMaterializedViewSetStorageParams({
            materializedView: mainMaterializedView,
            paramsToSet,
            keysToReset,
          }),
        );
      }

      // Note: Materialized view renaming would also use ALTER MATERIALIZED VIEW ... RENAME TO ...
      // But since our MaterializedView model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
      // MATERIALIZED VIEW COMMENT (create/drop when comment changes)
      if (mainMaterializedView.comment !== branchMaterializedView.comment) {
        if (branchMaterializedView.comment === null) {
          changes.push(
            new DropCommentOnMaterializedView({
              materializedView: mainMaterializedView,
            }),
          );
        } else {
          changes.push(
            new CreateCommentOnMaterializedView({
              materializedView: branchMaterializedView,
            }),
          );
        }
      }
      // COMMENT changes on columns
      const mainCols = new Map(
        mainMaterializedView.columns.map((c) => [c.name, c]),
      );
      const branchCols = new Map(
        branchMaterializedView.columns.map((c) => [c.name, c]),
      );
      for (const [name, branchCol] of branchCols) {
        const mainCol = mainCols.get(name);
        if (!mainCol) continue;
        if (mainCol.comment !== branchCol.comment) {
          if (branchCol.comment === null) {
            changes.push(
              new DropCommentOnMaterializedViewColumn({
                materializedView: mainMaterializedView,
                column: mainCol,
              }),
            );
          } else {
            changes.push(
              new CreateCommentOnMaterializedViewColumn({
                materializedView: branchMaterializedView,
                column: branchCol,
              }),
            );
          }
        }
      }

      // PRIVILEGES (unified object and column privileges)
      // Filter out owner privileges - owner always has ALL privileges implicitly
      // and shouldn't be compared. Use branch owner as the reference.
      const privilegeResults = diffPrivileges(
        mainMaterializedView.privileges,
        branchMaterializedView.privileges,
        branchMaterializedView.owner,
      );

      changes.push(
        ...(emitColumnPrivilegeChanges(
          privilegeResults,
          branchMaterializedView,
          mainMaterializedView,
          "materializedView",
          {
            Grant: GrantMaterializedViewPrivileges,
            Revoke: RevokeMaterializedViewPrivileges,
            RevokeGrantOption: RevokeGrantOptionMaterializedViewPrivileges,
          },
          mainMaterializedView.privileges,
          ctx.version,
        ) as MaterializedViewChange[]),
      );
    }
  }

  return changes;
}
