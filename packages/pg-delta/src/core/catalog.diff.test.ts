import { describe, expect, test } from "bun:test";
import { diffCatalogs } from "./catalog.diff.ts";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import { Role, type RoleProps } from "./objects/role/role.model.ts";
import {
  GrantViewPrivileges,
  RevokeViewPrivileges,
} from "./objects/view/changes/view.privilege.ts";
import { View, type ViewProps } from "./objects/view/view.model.ts";

const idColumn: ViewProps["columns"][number] = {
  name: "id",
  position: 1,
  data_type: "integer",
  data_type_str: "integer",
  is_custom_type: false,
  custom_type_type: null,
  custom_type_category: null,
  custom_type_schema: null,
  custom_type_name: null,
  not_null: false,
  is_identity: false,
  is_identity_always: false,
  is_generated: false,
  collation: null,
  default: null,
  comment: null,
};

const nameColumn: ViewProps["columns"][number] = {
  name: "name",
  position: 2,
  data_type: "text",
  data_type_str: "text",
  is_custom_type: false,
  custom_type_type: null,
  custom_type_category: null,
  custom_type_schema: null,
  custom_type_name: null,
  not_null: false,
  is_identity: false,
  is_identity_always: false,
  is_generated: false,
  collation: null,
  default: null,
  comment: null,
};

const baseView: ViewProps = {
  schema: "public",
  name: "replaced_view",
  definition: "SELECT id FROM source_table",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "postgres",
  comment: null,
  columns: [idColumn],
  privileges: [],
};

const makeView = (override: Partial<ViewProps> = {}) =>
  new View({
    ...baseView,
    ...override,
    columns: override.columns ?? [...baseView.columns],
    privileges: override.privileges ?? [...baseView.privileges],
  });

const makeRole = (name: string, override: Partial<RoleProps> = {}) =>
  new Role({
    name,
    is_superuser: false,
    can_inherit: true,
    can_create_roles: false,
    can_create_databases: false,
    can_login: true,
    can_replicate: false,
    connection_limit: null,
    can_bypass_rls: false,
    config: null,
    comment: null,
    members: [],
    default_privileges: [],
    security_labels: [],
    ...override,
  });

describe("catalog.diff", () => {
  test("keeps replacement-created view grants through dropped-target privilege filtering", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainView = makeView();
    const branchView = makeView({
      definition: "SELECT id, name FROM source_table",
      columns: [...mainView.columns, nameColumn],
      privileges: [
        { grantee: "view_reader", privilege: "SELECT", grantable: false },
      ],
    });

    const main = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      views: { [mainView.stableId]: mainView },
    });
    const branch = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      views: { [branchView.stableId]: branchView },
    });

    const changes = diffCatalogs(main, branch);

    expect(
      changes.some((change) => change instanceof GrantViewPrivileges),
    ).toBe(true);
  });

  test("keeps replacement-created view revokes through dropped-target privilege filtering", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainView = makeView();
    const branchView = makeView({
      definition: "SELECT id, name FROM source_table",
      columns: [...mainView.columns, nameColumn],
    });
    const postgres = makeRole("postgres", {
      default_privileges: [
        {
          in_schema: "public",
          objtype: "r",
          grantee: "view_reader",
          privileges: [{ privilege: "SELECT", grantable: false }],
          is_implicit: false,
        },
      ],
    });
    const viewReader = makeRole("view_reader");

    const roles = {
      [postgres.stableId]: postgres,
      [viewReader.stableId]: viewReader,
    };
    const main = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      roles,
      views: { [mainView.stableId]: mainView },
    });
    const branch = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      roles,
      views: { [branchView.stableId]: branchView },
    });

    // The recreated view inherits SELECT from default privileges, but the
    // branch model wants no explicit reader ACL. The replacement filter must
    // keep the generated REVOKE even though the old view stable id is dropped.
    const changes = diffCatalogs(main, branch);

    expect(
      changes.some((change) => change instanceof RevokeViewPrivileges),
    ).toBe(true);
  });
});
