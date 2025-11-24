import type { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../../base.privilege-diff.ts";
import type { Role } from "../../role/role.model.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "./changes/foreign-data-wrapper.alter.ts";
import {
  CreateCommentOnForeignDataWrapper,
  DropCommentOnForeignDataWrapper,
} from "./changes/foreign-data-wrapper.comment.ts";
import { CreateForeignDataWrapper } from "./changes/foreign-data-wrapper.create.ts";
import { DropForeignDataWrapper } from "./changes/foreign-data-wrapper.drop.ts";
import {
  GrantForeignDataWrapperPrivileges,
  RevokeForeignDataWrapperPrivileges,
  RevokeGrantOptionForeignDataWrapperPrivileges,
} from "./changes/foreign-data-wrapper.privilege.ts";
import type { ForeignDataWrapperChange } from "./changes/foreign-data-wrapper.types.ts";
import type { ForeignDataWrapper } from "./foreign-data-wrapper.model.ts";

/**
 * Diff two sets of foreign data wrappers from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The foreign data wrappers in the main catalog.
 * @param branch - The foreign data wrappers in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffForeignDataWrappers(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
    mainRoles: Record<string, Role>;
  },
  main: Record<string, ForeignDataWrapper>,
  branch: Record<string, ForeignDataWrapper>,
): ForeignDataWrapperChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ForeignDataWrapperChange[] = [];

  for (const fdwId of created) {
    const createdFdw = branch[fdwId];
    changes.push(
      new CreateForeignDataWrapper({ foreignDataWrapper: createdFdw }),
    );

    // OWNER: If the FDW should be owned by someone other than the current user,
    // emit ALTER FOREIGN DATA WRAPPER ... OWNER TO after creation
    if (createdFdw.owner !== ctx.currentUser) {
      changes.push(
        new AlterForeignDataWrapperChangeOwner({
          foreignDataWrapper: createdFdw,
          owner: createdFdw.owner,
        }),
      );
    }

    if (createdFdw.comment !== null) {
      changes.push(
        new CreateCommentOnForeignDataWrapper({
          foreignDataWrapper: createdFdw,
        }),
      );
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // Foreign Data Wrappers don't have default privileges, so we compare against empty array
    const effectiveDefaults: Array<{
      grantee: string;
      privilege: string;
      grantable: boolean;
    }> = [];
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "foreign_data_wrapper",
      createdFdw.privileges,
    );
    // Filter out owner privileges - owner always has ALL privileges implicitly
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
      createdFdw.owner,
      ctx.mainRoles,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantForeignDataWrapperPrivileges({
              foreignDataWrapper: createdFdw,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeForeignDataWrapperPrivileges({
              foreignDataWrapper: createdFdw,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionForeignDataWrapperPrivileges({
            foreignDataWrapper: createdFdw,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const fdwId of dropped) {
    changes.push(
      new DropForeignDataWrapper({ foreignDataWrapper: main[fdwId] }),
    );
  }

  for (const fdwId of altered) {
    const mainFdw = main[fdwId];
    const branchFdw = branch[fdwId];

    // OWNER
    if (mainFdw.owner !== branchFdw.owner) {
      changes.push(
        new AlterForeignDataWrapperChangeOwner({
          foreignDataWrapper: mainFdw,
          owner: branchFdw.owner,
        }),
      );
    }

    // HANDLER - if changed, need to recreate (not directly alterable)
    if (mainFdw.handler !== branchFdw.handler) {
      changes.push(new DropForeignDataWrapper({ foreignDataWrapper: mainFdw }));
      changes.push(
        new CreateForeignDataWrapper({ foreignDataWrapper: branchFdw }),
      );
      if (branchFdw.comment !== null) {
        changes.push(
          new CreateCommentOnForeignDataWrapper({
            foreignDataWrapper: branchFdw,
          }),
        );
      }
      continue;
    }

    // VALIDATOR - if changed, need to recreate (not directly alterable)
    if (mainFdw.validator !== branchFdw.validator) {
      changes.push(new DropForeignDataWrapper({ foreignDataWrapper: mainFdw }));
      changes.push(
        new CreateForeignDataWrapper({ foreignDataWrapper: branchFdw }),
      );
      if (branchFdw.comment !== null) {
        changes.push(
          new CreateCommentOnForeignDataWrapper({
            foreignDataWrapper: branchFdw,
          }),
        );
      }
      continue;
    }

    // OPTIONS
    const optionsChanged = diffOptions(mainFdw.options, branchFdw.options);
    if (optionsChanged.length > 0) {
      changes.push(
        new AlterForeignDataWrapperSetOptions({
          foreignDataWrapper: mainFdw,
          options: optionsChanged,
        }),
      );
    }

    // COMMENT
    if (mainFdw.comment !== branchFdw.comment) {
      if (branchFdw.comment === null) {
        changes.push(
          new DropCommentOnForeignDataWrapper({ foreignDataWrapper: mainFdw }),
        );
      } else {
        changes.push(
          new CreateCommentOnForeignDataWrapper({
            foreignDataWrapper: branchFdw,
          }),
        );
      }
    }

    // PRIVILEGES
    const mainPrivilegesFiltered = filterPublicBuiltInDefaults(
      "foreign_data_wrapper",
      mainFdw.privileges,
    );
    const branchPrivilegesFiltered = filterPublicBuiltInDefaults(
      "foreign_data_wrapper",
      branchFdw.privileges,
    );
    const privilegeResults = diffPrivileges(
      mainPrivilegesFiltered,
      branchPrivilegesFiltered,
      branchFdw.owner,
      ctx.mainRoles,
    );

    for (const [grantee, result] of privilegeResults) {
      // Generate grant changes
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantForeignDataWrapperPrivileges({
              foreignDataWrapper: branchFdw,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeForeignDataWrapperPrivileges({
              foreignDataWrapper: mainFdw,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionForeignDataWrapperPrivileges({
            foreignDataWrapper: mainFdw,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }

    // Note: FDW renaming would also use ALTER FOREIGN DATA WRAPPER ... RENAME TO ...
    // But since our ForeignDataWrapper model uses 'name' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}

/**
 * Diff options arrays to determine ADD/SET/DROP operations.
 * Options are stored as [key1, value1, key2, value2, ...]
 */
function diffOptions(
  mainOptions: string[] | null,
  branchOptions: string[] | null,
): Array<{ action: "ADD" | "SET" | "DROP"; option: string; value?: string }> {
  const mainMap = new Map<string, string>();
  const branchMap = new Map<string, string>();

  // Parse main options
  if (mainOptions) {
    for (let i = 0; i < mainOptions.length; i += 2) {
      if (i + 1 < mainOptions.length) {
        mainMap.set(mainOptions[i], mainOptions[i + 1]);
      }
    }
  }

  // Parse branch options
  if (branchOptions) {
    for (let i = 0; i < branchOptions.length; i += 2) {
      if (i + 1 < branchOptions.length) {
        branchMap.set(branchOptions[i], branchOptions[i + 1]);
      }
    }
  }

  const changes: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }> = [];

  // Find options to ADD or SET
  for (const [key, value] of branchMap) {
    const mainValue = mainMap.get(key);
    if (mainValue === undefined) {
      changes.push({ action: "ADD", option: key, value });
    } else if (mainValue !== value) {
      changes.push({ action: "SET", option: key, value });
    }
  }

  // Find options to DROP
  for (const [key] of mainMap) {
    if (!branchMap.has(key)) {
      changes.push({ action: "DROP", option: key });
    }
  }

  return changes;
}
