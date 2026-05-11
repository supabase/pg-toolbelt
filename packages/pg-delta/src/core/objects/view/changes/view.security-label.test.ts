import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { View, type ViewProps } from "../view.model.ts";
import {
  CreateSecurityLabelOnView,
  DropSecurityLabelOnView,
} from "./view.security-label.ts";

const makeView = (): View =>
  new View({
    schema: "public",
    name: "v",
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
  } as ViewProps);

describe("view.security-label", () => {
  test("create serializes and tracks dependencies", async () => {
    const view = makeView();
    const change = new CreateSecurityLabelOnView({
      view,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.scope).toBe("security_label");
    expect(change.creates).toEqual([
      stableId.securityLabel(view.stableId, "dummy"),
    ]);
    expect(change.requires).toEqual([view.stableId]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON VIEW public.v IS 'classified'",
    );
  });

  test("drop serializes to IS NULL", async () => {
    const view = makeView();
    const change = new DropSecurityLabelOnView({
      view,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.drops).toEqual([
      stableId.securityLabel(view.stableId, "dummy"),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON VIEW public.v IS NULL",
    );
  });
});
