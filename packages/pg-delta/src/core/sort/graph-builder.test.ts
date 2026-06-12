import { describe, expect, test } from "bun:test";
import { AlterPublicationDropTables } from "../objects/publication/changes/publication.alter.ts";
import { Publication } from "../objects/publication/publication.model.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import { Table } from "../objects/table/table.model.ts";
import { stableId } from "../objects/utils.ts";
import { buildGraphData } from "./graph-builder.ts";

const publication = new Publication({
  name: "pub_accounts",
  owner: "postgres",
  comment: null,
  all_tables: false,
  publish_insert: true,
  publish_update: true,
  publish_delete: true,
  publish_truncate: true,
  publish_via_partition_root: false,
  tables: [
    {
      schema: "public",
      name: "accounts",
      columns: ["id", "status_label"],
      row_filter: null,
    },
  ],
  schemas: [],
});

const table = new Table({
  schema: "public",
  name: "accounts",
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
  columns: [],
  constraints: [],
  privileges: [],
});

describe("buildGraphData", () => {
  test("publication table removals only produce table ids when the table is also dropped", () => {
    const publicationDrop = new AlterPublicationDropTables({
      publication,
      tables: publication.tables,
    });
    const publicationDropOnly = buildGraphData([publicationDrop], {
      invert: true,
    });

    expect(publicationDropOnly.createdStableIdSets[0].has(table.stableId)).toBe(
      false,
    );

    const publicationDropWithTableDrop = buildGraphData(
      [publicationDrop, new DropTable({ table })],
      { invert: true },
    );

    expect(
      publicationDropWithTableDrop.createdStableIdSets[0].has(
        stableId.table("public", "accounts"),
      ),
    ).toBe(true);
  });
});
