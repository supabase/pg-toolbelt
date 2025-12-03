import { describe, expect, test } from "vitest";
import { View, type ViewProps } from "../view.model.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "./view.alter.ts";

describe.concurrent("view", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<ViewProps, "owner"> = {
        schema: "public",
        name: "test_view",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        comment: null,
        columns: [],
        privileges: [],
      };
      const main = new View({
        ...props,
        owner: "old_owner",
      });
      // branch no longer needed for constructor; we only pass explicit owner

      const change = new AlterViewChangeOwner({
        view: main,
        owner: "new_owner",
      });

      expect(change.serialize()).toBe(
        "ALTER VIEW public.test_view OWNER TO new_owner",
      );
    });
  });

  test("set options", () => {
    const props: Omit<ViewProps, "options"> = {
      schema: "public",
      name: "test_view",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      partition_bound: null,
      owner: "test",
      comment: null,
      columns: [],
      privileges: [],
    };
    const main = new View({ ...props, options: ["security_barrier=true"] });
    // branch no longer needed; we pass explicit options list

    const change = new AlterViewSetOptions({
      view: main,
      options: ["security_barrier=false"],
    });
    expect(change.serialize()).toBe(
      "ALTER VIEW public.test_view SET (security_barrier=false)",
    );
  });

  test("reset options", () => {
    const view = new View({
      schema: "public",
      name: "test_view",
      definition: "SELECT * FROM test_table",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: ["security_barrier=true", "check_option=local"],
      partition_bound: null,
      owner: "test",
      comment: null,
      columns: [],
      privileges: [],
    });

    const change = new AlterViewResetOptions({
      view,
      params: ["check_option"],
    });
    expect(change.serialize()).toBe(
      "ALTER VIEW public.test_view RESET (check_option)",
    );
  });
});
