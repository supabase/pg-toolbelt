import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import type { ColumnProps } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import { Table, type TableProps } from "../table.model.ts";
import {
  CreateSecurityLabelOnColumn,
  CreateSecurityLabelOnTable,
  DropSecurityLabelOnColumn,
  DropSecurityLabelOnTable,
} from "./table.security-label.ts";

const makeColumn = (overrides: Partial<ColumnProps> = {}): ColumnProps => ({
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
  ...overrides,
});

const makeTable = (): Table =>
  new Table({
    schema: "public",
    name: "users",
    persistence: "p",
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
    partition_by: null,
    owner: "postgres",
    comment: null,
    parent_schema: null,
    parent_name: null,
    columns: [makeColumn({ name: "email" })],
    privileges: [],
    security_labels: [],
  } as TableProps);

describe("table.security-label", () => {
  test("table create serializes and tracks dependencies", async () => {
    const table = makeTable();
    const change = new CreateSecurityLabelOnTable({
      table,
      securityLabel: { provider: "dummy", label: "classified" },
    });

    expect(change.scope).toBe("security_label");
    expect(change.objectType).toBe("table");
    expect(change.operation).toBe("create");
    expect(change.creates).toEqual([
      stableId.securityLabel(table.stableId, "dummy"),
    ]);
    expect(change.requires).toEqual([table.stableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON TABLE public.users IS 'classified'",
    );
  });

  test("table drop serializes to IS NULL", async () => {
    const table = makeTable();
    const change = new DropSecurityLabelOnTable({
      table,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.drops).toEqual([
      stableId.securityLabel(table.stableId, "dummy"),
    ]);
    expect(change.requires).toEqual([
      stableId.securityLabel(table.stableId, "dummy"),
      table.stableId,
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON TABLE public.users IS NULL",
    );
  });

  test("column create serializes and tracks dependencies", async () => {
    const table = makeTable();
    const column = makeColumn({ name: "email" });
    const change = new CreateSecurityLabelOnColumn({
      table,
      column,
      securityLabel: { provider: "dummy", label: "classified" },
    });

    const colStableId = stableId.column(table.schema, table.name, column.name);
    expect(change.creates).toEqual([
      stableId.securityLabel(colStableId, "dummy"),
    ]);
    expect(change.requires).toEqual([colStableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON COLUMN public.users.email IS 'classified'",
    );
  });

  test("column drop serializes to IS NULL", async () => {
    const table = makeTable();
    const column = makeColumn({ name: "email" });
    const change = new DropSecurityLabelOnColumn({
      table,
      column,
      securityLabel: { provider: "dummy", label: "x" },
    });
    const colStableId = stableId.column(table.schema, table.name, column.name);
    expect(change.drops).toEqual([
      stableId.securityLabel(colStableId, "dummy"),
    ]);
    expect(change.requires).toEqual([
      stableId.securityLabel(colStableId, "dummy"),
      colStableId,
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON COLUMN public.users.email IS NULL",
    );
  });
});
