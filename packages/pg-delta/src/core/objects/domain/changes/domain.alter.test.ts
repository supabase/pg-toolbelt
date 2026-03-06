import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Domain, type DomainProps } from "../domain.model.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "./domain.alter.ts";

describe.concurrent("domain", () => {
  describe("alter", () => {
    test("set default", async () => {
      const props: Omit<DomainProps, "default_value"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        owner: "test",
        comment: null,
        constraints: [],
        privileges: [],
      };
      const domain = new Domain({
        ...props,
        default_value: null,
      });

      const change = new AlterDomainSetDefault({
        domain,
        defaultValue: "42",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain SET DEFAULT 42",
      );
    });

    test("drop default", async () => {
      const props: Omit<DomainProps, "default_value"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain({
        ...props,
        default_value: "42",
      });

      const change = new AlterDomainDropDefault({
        domain,
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP DEFAULT",
      );
    });

    test("set not null", async () => {
      const props: Omit<DomainProps, "not_null"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain({
        ...props,
        not_null: false,
      });

      const change = new AlterDomainSetNotNull({
        domain,
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain SET NOT NULL",
      );
    });

    test("drop not null", async () => {
      const props: Omit<DomainProps, "not_null"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain({
        ...props,
        not_null: true,
      });

      const change = new AlterDomainDropNotNull({
        domain,
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP NOT NULL",
      );
    });

    test("change owner", async () => {
      const props: Omit<DomainProps, "owner"> = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterDomainChangeOwner({
        domain,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain OWNER TO new_owner",
      );
    });

    test("add constraint", async () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain(props);

      const change = new AlterDomainAddConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain ADD CONSTRAINT test_check CHECK (VALUE > 0)",
      );
    });

    test("add constraint not valid", async () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain(props);

      const change = new AlterDomainAddConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: false,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain ADD CONSTRAINT test_check CHECK (VALUE > 0) NOT VALID",
      );
    });

    test("drop constraint", async () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain(props);

      const change = new AlterDomainDropConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain DROP CONSTRAINT test_check",
      );
    });

    test("validate constraint", async () => {
      const props: DomainProps = {
        schema: "public",
        name: "test_domain",
        base_type: "integer",
        base_type_schema: "pg_catalog",
        not_null: false,
        type_modifier: null,
        array_dimensions: null,
        collation: null,
        default_bin: null,
        default_value: null,
        owner: "test",
        comment: null,
        constraints: [],

        privileges: [],
      };
      const domain = new Domain(props);

      const change = new AlterDomainValidateConstraint({
        domain,
        constraint: {
          name: "test_check",
          validated: true,
          is_local: true,
          no_inherit: false,
          check_expression: "VALUE > 0",
        },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER DOMAIN public.test_domain VALIDATE CONSTRAINT test_check",
      );
    });
  });
});
