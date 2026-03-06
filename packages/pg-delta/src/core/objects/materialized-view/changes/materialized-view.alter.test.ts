import { describe, expect, test } from "bun:test";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "../materialized-view.model.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "./materialized-view.alter.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe.concurrent("materialized-view", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: Omit<MaterializedViewProps, "owner"> = {
        schema: "public",
        name: "test_mv",
        definition: "SELECT * FROM test_table",
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
        comment: null,
        columns: [],
        privileges: [],
      };
      const materializedView = new MaterializedView({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterMaterializedViewChangeOwner({
        materializedView,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER MATERIALIZED VIEW public.test_mv OWNER TO new_owner",
      );
    });

    test("set storage params", async () => {
      const props: Omit<MaterializedViewProps, "options"> = {
        schema: "public",
        name: "test_mv",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: true,
        replica_identity: "d",
        is_partition: false,
        partition_bound: null,
        owner: "test",
        comment: null,
        columns: [],
        privileges: [],
      };
      const materializedView = new MaterializedView({
        ...props,
        options: [],
      });

      const change = new AlterMaterializedViewSetStorageParams({
        materializedView,
        paramsToSet: ["fillfactor=90"],
        keysToReset: [],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90)",
      );
    });

    test("reset and set storage params", async () => {
      const props: Omit<MaterializedViewProps, "options"> = {
        schema: "public",
        name: "test_mv",
        definition: "SELECT * FROM test_table",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: true,
        replica_identity: "d",
        is_partition: false,
        partition_bound: null,
        owner: "test",
        comment: null,
        columns: [],
        privileges: [],
      };
      const materializedView = new MaterializedView({
        ...props,
        options: ["fillfactor=70", "autovacuum_enabled=false"],
      });

      const change = new AlterMaterializedViewSetStorageParams({
        materializedView,
        paramsToSet: ["fillfactor=90", "user_catalog_table=true"],
        keysToReset: ["autovacuum_enabled"],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        [
          "ALTER MATERIALIZED VIEW public.test_mv RESET (autovacuum_enabled)",
          "ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90, user_catalog_table=true)",
        ].join(";\n"),
      );
    });
  });
});
