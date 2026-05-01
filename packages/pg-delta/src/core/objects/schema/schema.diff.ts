import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
} from "../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../diff-context.ts";
import { diffSecurityLabels } from "../security-label.types.ts";
import { AlterSchemaChangeOwner } from "./changes/schema.alter.ts";
import {
  CreateCommentOnSchema,
  DropCommentOnSchema,
} from "./changes/schema.comment.ts";
import { CreateSchema } from "./changes/schema.create.ts";
import { DropSchema } from "./changes/schema.drop.ts";
import {
  GrantSchemaPrivileges,
  RevokeGrantOptionSchemaPrivileges,
  RevokeSchemaPrivileges,
} from "./changes/schema.privilege.ts";
import {
  CreateSecurityLabelOnSchema,
  DropSecurityLabelOnSchema,
} from "./changes/schema.security-label.ts";
import type { SchemaChange } from "./changes/schema.types.ts";
import type { Schema } from "./schema.model.ts";

/**
 * Diff two sets of schemas from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The schemas in the main catalog.
 * @param branch - The schemas in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffSchemas(
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
  main: Record<string, Schema>,
  branch: Record<string, Schema>,
): SchemaChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: SchemaChange[] = [];

  for (const schemaId of created) {
    const sc = branch[schemaId];
    changes.push(new CreateSchema({ schema: sc }));
    if (sc.comment !== null) {
      changes.push(new CreateCommentOnSchema({ schema: sc }));
    }
    for (const label of sc.security_labels) {
      changes.push(
        new CreateSecurityLabelOnSchema({
          schema: sc,
          securityLabel: label,
        }),
      );
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    // Note: Schemas don't have a schema property, so we pass empty string
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "schema",
      "",
    );
    const creatorFilteredDefaults =
      sc.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    const desiredPrivileges = sc.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use the schema owner as the reference.
    const privilegeResults = diffPrivileges(
      creatorFilteredDefaults,
      desiredPrivileges,
      sc.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        sc,
        sc,
        "schema",
        {
          Grant: GrantSchemaPrivileges,
          Revoke: RevokeSchemaPrivileges,
          RevokeGrantOption: RevokeGrantOptionSchemaPrivileges,
        },
        ctx.version,
      ) as SchemaChange[]),
    );
  }

  for (const schemaId of dropped) {
    const mainSchema = main[schemaId];
    for (const label of mainSchema.security_labels) {
      changes.push(
        new DropSecurityLabelOnSchema({
          schema: mainSchema,
          securityLabel: label,
        }),
      );
    }
    changes.push(new DropSchema({ schema: mainSchema }));
  }

  for (const schemaId of altered) {
    const mainSchema = main[schemaId];
    const branchSchema = branch[schemaId];

    // OWNER
    if (mainSchema.owner !== branchSchema.owner) {
      changes.push(
        new AlterSchemaChangeOwner({
          schema: mainSchema,
          owner: branchSchema.owner,
        }),
      );
    }

    // COMMENT
    if (mainSchema.comment !== branchSchema.comment) {
      if (branchSchema.comment === null) {
        changes.push(new DropCommentOnSchema({ schema: mainSchema }));
      } else {
        changes.push(new CreateCommentOnSchema({ schema: branchSchema }));
      }
    }

    // SECURITY LABELS
    changes.push(
      ...diffSecurityLabels<
        CreateSecurityLabelOnSchema | DropSecurityLabelOnSchema
      >(
        mainSchema.security_labels,
        branchSchema.security_labels,
        (securityLabel) =>
          new CreateSecurityLabelOnSchema({
            schema: branchSchema,
            securityLabel,
          }),
        (securityLabel) =>
          new DropSecurityLabelOnSchema({
            schema: mainSchema,
            securityLabel,
          }),
      ),
    );

    // PRIVILEGES
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Use branch owner as the reference.
    const privilegeResults = diffPrivileges(
      mainSchema.privileges,
      branchSchema.privileges,
      branchSchema.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        branchSchema,
        mainSchema,
        "schema",
        {
          Grant: GrantSchemaPrivileges,
          Revoke: RevokeSchemaPrivileges,
          RevokeGrantOption: RevokeGrantOptionSchemaPrivileges,
        },
        ctx.version,
      ) as SchemaChange[]),
    );

    // Note: Schema renaming would also use ALTER SCHEMA ... RENAME TO ...
    // But since our Schema model uses 'schema' as the identity field,
    // a name change would be handled as drop + create by diffObjects()
  }

  return changes;
}
