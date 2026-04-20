import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "../materialized-view.model.ts";
import {
  CreateSecurityLabelOnMaterializedView,
  DropSecurityLabelOnMaterializedView,
} from "./materialized-view.security-label.ts";

const makeMV = (): MaterializedView =>
  new MaterializedView({
    schema: "public",
    name: "mv",
    definition: "SELECT 1",
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
    columns: [],
    privileges: [],
  } as MaterializedViewProps);

describe("materialized-view.security-label", () => {
  test("create serializes", async () => {
    const mv = makeMV();
    const change = new CreateSecurityLabelOnMaterializedView({
      materializedView: mv,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.scope).toBe("security_label");
    expect(change.creates).toEqual([
      stableId.securityLabel(mv.stableId, "dummy"),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON MATERIALIZED VIEW public.mv IS 'classified'",
    );
  });

  test("drop serializes to IS NULL", async () => {
    const mv = makeMV();
    const change = new DropSecurityLabelOnMaterializedView({
      materializedView: mv,
      securityLabel: { provider: "dummy", label: "x" },
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON MATERIALIZED VIEW public.mv IS NULL",
    );
  });
});
