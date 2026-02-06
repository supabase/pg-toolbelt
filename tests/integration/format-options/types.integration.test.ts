import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  compositeAttribute,
  compositeType,
  domain,
  domainConstraint,
  enumType,
  formatCases,
  pgVersion,
  priv,
  rangeType,
  renderChanges,
} from "./fixtures.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "../../../src/core/objects/domain/changes/domain.alter.ts";
import { CreateDomain } from "../../../src/core/objects/domain/changes/domain.create.ts";
import {
  CreateCommentOnDomain,
  DropCommentOnDomain,
} from "../../../src/core/objects/domain/changes/domain.comment.ts";
import { DropDomain } from "../../../src/core/objects/domain/changes/domain.drop.ts";
import {
  GrantDomainPrivileges,
  RevokeDomainPrivileges,
  RevokeGrantOptionDomainPrivileges,
} from "../../../src/core/objects/domain/changes/domain.privilege.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
} from "../../../src/core/objects/type/enum/changes/enum.alter.ts";
import { CreateEnum } from "../../../src/core/objects/type/enum/changes/enum.create.ts";
import {
  CreateCommentOnEnum,
  DropCommentOnEnum,
} from "../../../src/core/objects/type/enum/changes/enum.comment.ts";
import { DropEnum } from "../../../src/core/objects/type/enum/changes/enum.drop.ts";
import {
  GrantEnumPrivileges,
  RevokeEnumPrivileges,
  RevokeGrantOptionEnumPrivileges,
} from "../../../src/core/objects/type/enum/changes/enum.privilege.ts";
import {
  AlterCompositeTypeAddAttribute,
  AlterCompositeTypeAlterAttributeType,
  AlterCompositeTypeChangeOwner,
  AlterCompositeTypeDropAttribute,
} from "../../../src/core/objects/type/composite-type/changes/composite-type.alter.ts";
import { CreateCompositeType } from "../../../src/core/objects/type/composite-type/changes/composite-type.create.ts";
import {
  CreateCommentOnCompositeType,
  CreateCommentOnCompositeTypeAttribute,
  DropCommentOnCompositeType,
  DropCommentOnCompositeTypeAttribute,
} from "../../../src/core/objects/type/composite-type/changes/composite-type.comment.ts";
import { DropCompositeType } from "../../../src/core/objects/type/composite-type/changes/composite-type.drop.ts";
import {
  GrantCompositeTypePrivileges,
  RevokeCompositeTypePrivileges,
  RevokeGrantOptionCompositeTypePrivileges,
} from "../../../src/core/objects/type/composite-type/changes/composite-type.privilege.ts";
import { AlterRangeChangeOwner } from "../../../src/core/objects/type/range/changes/range.alter.ts";
import { CreateRange } from "../../../src/core/objects/type/range/changes/range.create.ts";
import {
  CreateCommentOnRange,
  DropCommentOnRange,
} from "../../../src/core/objects/type/range/changes/range.comment.ts";
import { DropRange } from "../../../src/core/objects/type/range/changes/range.drop.ts";
import {
  GrantRangePrivileges,
  RevokeRangePrivileges,
  RevokeGrantOptionRangePrivileges,
} from "../../../src/core/objects/type/range/changes/range.privilege.ts";
import { column } from "./fixtures.ts";

const changes: ChangeCase[] = [
  { label: "domain.create", change: new CreateDomain({ domain }) },
  {
    label: "domain.alter.owner",
    change: new AlterDomainChangeOwner({ domain, owner: "owner2" }),
  },
  {
    label: "domain.alter.set_default",
    change: new AlterDomainSetDefault({ domain, defaultValue: "'new'" }),
  },
  { label: "domain.alter.drop_default", change: new AlterDomainDropDefault({ domain }) },
  { label: "domain.alter.set_not_null", change: new AlterDomainSetNotNull({ domain }) },
  { label: "domain.alter.drop_not_null", change: new AlterDomainDropNotNull({ domain }) },
  {
    label: "domain.alter.add_constraint",
    change: new AlterDomainAddConstraint({ domain, constraint: domainConstraint }),
  },
  {
    label: "domain.alter.drop_constraint",
    change: new AlterDomainDropConstraint({ domain, constraint: domainConstraint }),
  },
  {
    label: "domain.alter.validate_constraint",
    change: new AlterDomainValidateConstraint({ domain, constraint: domainConstraint }),
  },
  { label: "domain.comment.create", change: new CreateCommentOnDomain({ domain }) },
  { label: "domain.comment.drop", change: new DropCommentOnDomain({ domain }) },
  {
    label: "domain.privilege.grant",
    change: new GrantDomainPrivileges({
      domain,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "domain.privilege.revoke",
    change: new RevokeDomainPrivileges({
      domain,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "domain.privilege.revoke_grant_option",
    change: new RevokeGrantOptionDomainPrivileges({
      domain,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "domain.drop", change: new DropDomain({ domain }) },

  { label: "type.enum.create", change: new CreateEnum({ enum: enumType }) },
  {
    label: "type.enum.alter.owner",
    change: new AlterEnumChangeOwner({ enum: enumType, owner: "owner2" }),
  },
  {
    label: "type.enum.alter.add_value",
    change: new AlterEnumAddValue({
      enum: enumType,
      newValue: "value4",
      position: { before: "value3" },
    }),
  },
  { label: "type.enum.comment.create", change: new CreateCommentOnEnum({ enum: enumType }) },
  { label: "type.enum.comment.drop", change: new DropCommentOnEnum({ enum: enumType }) },
  {
    label: "type.enum.privilege.grant",
    change: new GrantEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.enum.privilege.revoke",
    change: new RevokeEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.enum.privilege.revoke_grant_option",
    change: new RevokeGrantOptionEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "type.enum.drop", change: new DropEnum({ enum: enumType }) },

  { label: "type.composite.create", change: new CreateCompositeType({ compositeType }) },
  {
    label: "type.composite.alter.owner",
    change: new AlterCompositeTypeChangeOwner({ compositeType, owner: "owner2" }),
  },
  {
    label: "type.composite.alter.add_attribute",
    change: new AlterCompositeTypeAddAttribute({
      compositeType,
      attribute: compositeAttribute,
    }),
  },
  {
    label: "type.composite.alter.drop_attribute",
    change: new AlterCompositeTypeDropAttribute({
      compositeType,
      attribute: compositeType.columns[0],
    }),
  },
  {
    label: "type.composite.alter.attribute_type",
    change: new AlterCompositeTypeAlterAttributeType({
      compositeType,
      attribute: column({
        name: "name",
        data_type_str: "varchar(100)",
        collation: '"en_US"',
      }),
    }),
  },
  {
    label: "type.composite.comment.create",
    change: new CreateCommentOnCompositeType({ compositeType }),
  },
  {
    label: "type.composite.comment.drop",
    change: new DropCommentOnCompositeType({ compositeType }),
  },
  {
    label: "type.composite.comment.attribute.create",
    change: new CreateCommentOnCompositeTypeAttribute({
      compositeType,
      attribute: compositeType.columns[0],
    }),
  },
  {
    label: "type.composite.comment.attribute.drop",
    change: new DropCommentOnCompositeTypeAttribute({
      compositeType,
      attribute: compositeType.columns[0],
    }),
  },
  {
    label: "type.composite.privilege.grant",
    change: new GrantCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.composite.privilege.revoke",
    change: new RevokeCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.composite.privilege.revoke_grant_option",
    change: new RevokeGrantOptionCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "type.composite.drop", change: new DropCompositeType({ compositeType }) },

  { label: "type.range.create", change: new CreateRange({ range: rangeType }) },
  {
    label: "type.range.alter.owner",
    change: new AlterRangeChangeOwner({ range: rangeType, owner: "owner2" }),
  },
  { label: "type.range.comment.create", change: new CreateCommentOnRange({ range: rangeType }) },
  { label: "type.range.comment.drop", change: new DropCommentOnRange({ range: rangeType }) },
  {
    label: "type.range.privilege.grant",
    change: new GrantRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.range.privilege.revoke",
    change: new RevokeRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "type.range.privilege.revoke_grant_option",
    change: new RevokeGrantOptionRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "type.range.drop", change: new DropRange({ range: rangeType }) },
];

describe("format options: types", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- domain.create
      CREATE DOMAIN public.test_domain_all AS custom.text[][] COLLATE mycoll DEFAULT 'hello' NOT NULL CHECK (VALUE <> '')

      -- domain.alter.owner
      ALTER DOMAIN public.test_domain_all OWNER TO owner2

      -- domain.alter.set_default
      ALTER DOMAIN public.test_domain_all SET DEFAULT 'new'

      -- domain.alter.drop_default
      ALTER DOMAIN public.test_domain_all DROP DEFAULT

      -- domain.alter.set_not_null
      ALTER DOMAIN public.test_domain_all SET NOT NULL

      -- domain.alter.drop_not_null
      ALTER DOMAIN public.test_domain_all DROP NOT NULL

      -- domain.alter.add_constraint
      ALTER DOMAIN public.test_domain_all ADD CONSTRAINT domain_chk CHECK (VALUE <> '')

      -- domain.alter.drop_constraint
      ALTER DOMAIN public.test_domain_all DROP CONSTRAINT domain_chk

      -- domain.alter.validate_constraint
      ALTER DOMAIN public.test_domain_all VALIDATE CONSTRAINT domain_chk

      -- domain.comment.create
      COMMENT ON DOMAIN public.test_domain_all IS 'domain comment'

      -- domain.comment.drop
      COMMENT ON DOMAIN public.test_domain_all IS NULL

      -- domain.privilege.grant
      GRANT ALL ON DOMAIN public.test_domain_all TO app_user

      -- domain.privilege.revoke
      REVOKE ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.drop
      DROP DOMAIN public.test_domain_all

      -- type.enum.create
      CREATE TYPE public.test_enum AS ENUM ('value1', 'value2', 'value3')

      -- type.enum.alter.owner
      ALTER TYPE public.test_enum OWNER TO owner2

      -- type.enum.alter.add_value
      ALTER TYPE public.test_enum ADD VALUE 'value4' BEFORE 'value3'

      -- type.enum.comment.create
      COMMENT ON TYPE public.test_enum IS 'enum comment'

      -- type.enum.comment.drop
      COMMENT ON TYPE public.test_enum IS NULL

      -- type.enum.privilege.grant
      GRANT ALL ON TYPE public.test_enum TO app_user

      -- type.enum.privilege.revoke
      REVOKE ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.drop
      DROP TYPE public.test_enum

      -- type.composite.create
      CREATE TYPE public.test_type AS (id integer, name text COLLATE "en_US")

      -- type.composite.alter.owner
      ALTER TYPE public.test_type OWNER TO owner2

      -- type.composite.alter.add_attribute
      ALTER TYPE public.test_type ADD ATTRIBUTE new_attr text

      -- type.composite.alter.drop_attribute
      ALTER TYPE public.test_type DROP ATTRIBUTE id

      -- type.composite.alter.attribute_type
      ALTER TYPE public.test_type ALTER ATTRIBUTE name TYPE varchar(100) COLLATE "en_US"

      -- type.composite.comment.create
      COMMENT ON TYPE public.test_type IS 'composite comment'

      -- type.composite.comment.drop
      COMMENT ON TYPE public.test_type IS NULL

      -- type.composite.comment.attribute.create
      COMMENT ON COLUMN public.test_type.id IS 'attr comment'

      -- type.composite.comment.attribute.drop
      COMMENT ON COLUMN public.test_type.id IS NULL

      -- type.composite.privilege.grant
      GRANT ALL ON TYPE public.test_type TO app_user

      -- type.composite.privilege.revoke
      REVOKE ALL ON TYPE public.test_type FROM app_user

      -- type.composite.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_type FROM app_user

      -- type.composite.drop
      DROP TYPE public.test_type

      -- type.range.create
      CREATE TYPE public.daterange_custom AS RANGE (SUBTYPE date, SUBTYPE_OPCLASS public.date_ops, COLLATION "en_US", CANONICAL public.canon_fn, SUBTYPE_DIFF public.diff_fn)

      -- type.range.alter.owner
      ALTER TYPE public.daterange_custom OWNER TO owner2

      -- type.range.comment.create
      COMMENT ON TYPE public.daterange_custom IS 'range comment'

      -- type.range.comment.drop
      COMMENT ON TYPE public.daterange_custom IS NULL

      -- type.range.privilege.grant
      GRANT ALL ON TYPE public.daterange_custom TO app_user

      -- type.range.privilege.revoke
      REVOKE ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.drop
      DROP TYPE public.daterange_custom"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- domain.create
      CREATE DOMAIN public.test_domain_all AS custom.text[][]
      COLLATE mycoll
      DEFAULT 'hello'
      NOT NULL
      CHECK (VALUE <> '')

      -- domain.alter.owner
      ALTER DOMAIN public.test_domain_all OWNER TO owner2

      -- domain.alter.set_default
      ALTER DOMAIN public.test_domain_all SET DEFAULT 'new'

      -- domain.alter.drop_default
      ALTER DOMAIN public.test_domain_all DROP DEFAULT

      -- domain.alter.set_not_null
      ALTER DOMAIN public.test_domain_all SET NOT NULL

      -- domain.alter.drop_not_null
      ALTER DOMAIN public.test_domain_all DROP NOT NULL

      -- domain.alter.add_constraint
      ALTER DOMAIN public.test_domain_all ADD CONSTRAINT domain_chk CHECK (VALUE <> '')

      -- domain.alter.drop_constraint
      ALTER DOMAIN public.test_domain_all DROP CONSTRAINT domain_chk

      -- domain.alter.validate_constraint
      ALTER DOMAIN public.test_domain_all VALIDATE CONSTRAINT domain_chk

      -- domain.comment.create
      COMMENT ON DOMAIN public.test_domain_all IS 'domain comment'

      -- domain.comment.drop
      COMMENT ON DOMAIN public.test_domain_all IS NULL

      -- domain.privilege.grant
      GRANT ALL ON DOMAIN public.test_domain_all TO app_user

      -- domain.privilege.revoke
      REVOKE ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.drop
      DROP DOMAIN public.test_domain_all

      -- type.enum.create
      CREATE TYPE public.test_enum AS ENUM (
        'value1',
        'value2',
        'value3'
      )

      -- type.enum.alter.owner
      ALTER TYPE public.test_enum OWNER TO owner2

      -- type.enum.alter.add_value
      ALTER TYPE public.test_enum ADD VALUE 'value4' BEFORE 'value3'

      -- type.enum.comment.create
      COMMENT ON TYPE public.test_enum IS 'enum comment'

      -- type.enum.comment.drop
      COMMENT ON TYPE public.test_enum IS NULL

      -- type.enum.privilege.grant
      GRANT ALL ON TYPE public.test_enum TO app_user

      -- type.enum.privilege.revoke
      REVOKE ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.drop
      DROP TYPE public.test_enum

      -- type.composite.create
      CREATE TYPE public.test_type AS (
        id   integer,
        name text    COLLATE "en_US"
      )

      -- type.composite.alter.owner
      ALTER TYPE public.test_type OWNER TO owner2

      -- type.composite.alter.add_attribute
      ALTER TYPE public.test_type ADD ATTRIBUTE new_attr text

      -- type.composite.alter.drop_attribute
      ALTER TYPE public.test_type DROP ATTRIBUTE id

      -- type.composite.alter.attribute_type
      ALTER TYPE public.test_type ALTER ATTRIBUTE name TYPE varchar(100) COLLATE "en_US"

      -- type.composite.comment.create
      COMMENT ON TYPE public.test_type IS 'composite comment'

      -- type.composite.comment.drop
      COMMENT ON TYPE public.test_type IS NULL

      -- type.composite.comment.attribute.create
      COMMENT ON COLUMN public.test_type.id IS 'attr comment'

      -- type.composite.comment.attribute.drop
      COMMENT ON COLUMN public.test_type.id IS NULL

      -- type.composite.privilege.grant
      GRANT ALL ON TYPE public.test_type TO app_user

      -- type.composite.privilege.revoke
      REVOKE ALL ON TYPE public.test_type FROM app_user

      -- type.composite.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_type FROM app_user

      -- type.composite.drop
      DROP TYPE public.test_type

      -- type.range.create
      CREATE TYPE public.daterange_custom AS RANGE (
        SUBTYPE         = date,
        SUBTYPE_OPCLASS = public.date_ops,
        COLLATION       = "en_US",
        CANONICAL       = public.canon_fn,
        SUBTYPE_DIFF    = public.diff_fn
      )

      -- type.range.alter.owner
      ALTER TYPE public.daterange_custom OWNER TO owner2

      -- type.range.comment.create
      COMMENT ON TYPE public.daterange_custom IS 'range comment'

      -- type.range.comment.drop
      COMMENT ON TYPE public.daterange_custom IS NULL

      -- type.range.privilege.grant
      GRANT ALL ON TYPE public.daterange_custom TO app_user

      -- type.range.privilege.revoke
      REVOKE ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.drop
      DROP TYPE public.daterange_custom"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- domain.create
      create domain public.test_domain_all as custom.text[][]
      collate mycoll
      default 'hello'
      not null
      check (VALUE <> '')

      -- domain.alter.owner
      alter domain public.test_domain_all owner to owner2

      -- domain.alter.set_default
      alter domain public.test_domain_all set default 'new'

      -- domain.alter.drop_default
      alter domain public.test_domain_all drop default

      -- domain.alter.set_not_null
      alter domain public.test_domain_all set not null

      -- domain.alter.drop_not_null
      alter domain public.test_domain_all drop not null

      -- domain.alter.add_constraint
      alter domain public.test_domain_all add constraint domain_chk CHECK (VALUE <> '')

      -- domain.alter.drop_constraint
      alter domain public.test_domain_all drop constraint domain_chk

      -- domain.alter.validate_constraint
      alter domain public.test_domain_all validate constraint domain_chk

      -- domain.comment.create
      comment on domain public.test_domain_all is 'domain comment'

      -- domain.comment.drop
      comment on domain public.test_domain_all is null

      -- domain.privilege.grant
      grant all on domain public.test_domain_all to app_user

      -- domain.privilege.revoke
      revoke all on domain public.test_domain_all from app_user

      -- domain.privilege.revoke_grant_option
      revoke grant option for all on domain public.test_domain_all from app_user

      -- domain.drop
      drop domain public.test_domain_all

      -- type.enum.create
      create type public.test_enum as enum (
            'value1'
          , 'value2'
          , 'value3'
      )

      -- type.enum.alter.owner
      alter type public.test_enum owner to owner2

      -- type.enum.alter.add_value
      alter type public.test_enum add value 'value4' before 'value3'

      -- type.enum.comment.create
      comment on type public.test_enum is 'enum comment'

      -- type.enum.comment.drop
      comment on type public.test_enum is null

      -- type.enum.privilege.grant
      grant all on type public.test_enum to app_user

      -- type.enum.privilege.revoke
      revoke all on type public.test_enum from app_user

      -- type.enum.privilege.revoke_grant_option
      revoke grant option for all on type public.test_enum from app_user

      -- type.enum.drop
      drop type public.test_enum

      -- type.composite.create
      create type public.test_type as (
            id   integer
          , name text    collate "en_US"
      )

      -- type.composite.alter.owner
      alter type public.test_type owner to owner2

      -- type.composite.alter.add_attribute
      alter type public.test_type add attribute new_attr text

      -- type.composite.alter.drop_attribute
      alter type public.test_type drop attribute id

      -- type.composite.alter.attribute_type
      alter type public.test_type alter attribute name type varchar(100) collate "en_US"

      -- type.composite.comment.create
      comment on type public.test_type is 'composite comment'

      -- type.composite.comment.drop
      comment on type public.test_type is null

      -- type.composite.comment.attribute.create
      comment on column public.test_type.id is 'attr comment'

      -- type.composite.comment.attribute.drop
      comment on column public.test_type.id is null

      -- type.composite.privilege.grant
      grant all on type public.test_type to app_user

      -- type.composite.privilege.revoke
      revoke all on type public.test_type from app_user

      -- type.composite.privilege.revoke_grant_option
      revoke grant option for all on type public.test_type from app_user

      -- type.composite.drop
      drop type public.test_type

      -- type.range.create
      create type public.daterange_custom as range (
            subtype         = date
          , subtype_opclass = public.date_ops
          , collation       = "en_US"
          , canonical       = public.canon_fn
          , subtype_diff    = public.diff_fn
      )

      -- type.range.alter.owner
      alter type public.daterange_custom owner to owner2

      -- type.range.comment.create
      comment on type public.daterange_custom is 'range comment'

      -- type.range.comment.drop
      comment on type public.daterange_custom is null

      -- type.range.privilege.grant
      grant all on type public.daterange_custom to app_user

      -- type.range.privilege.revoke
      revoke all on type public.daterange_custom from app_user

      -- type.range.privilege.revoke_grant_option
      revoke grant option for all on type public.daterange_custom from app_user

      -- type.range.drop
      drop type public.daterange_custom"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- domain.create
      CREATE DOMAIN public.test_domain_all AS
        custom.text[][]
      COLLATE mycoll
      DEFAULT 'hello'
      NOT NULL
      CHECK (VALUE <> '')

      -- domain.alter.owner
      ALTER DOMAIN public.test_domain_all
        OWNER TO owner2

      -- domain.alter.set_default
      ALTER DOMAIN public.test_domain_all SET
        DEFAULT 'new'

      -- domain.alter.drop_default
      ALTER DOMAIN public.test_domain_all DROP
        DEFAULT

      -- domain.alter.set_not_null
      ALTER DOMAIN public.test_domain_all SET
        NOT NULL

      -- domain.alter.drop_not_null
      ALTER DOMAIN public.test_domain_all DROP
        NOT NULL

      -- domain.alter.add_constraint
      ALTER DOMAIN public.test_domain_all ADD
        CONSTRAINT domain_chk CHECK (VALUE <>
        '')

      -- domain.alter.drop_constraint
      ALTER DOMAIN public.test_domain_all DROP
        CONSTRAINT domain_chk

      -- domain.alter.validate_constraint
      ALTER DOMAIN public.test_domain_all
        VALIDATE CONSTRAINT domain_chk

      -- domain.comment.create
      COMMENT ON DOMAIN public.test_domain_all
        IS 'domain comment'

      -- domain.comment.drop
      COMMENT ON DOMAIN public.test_domain_all
        IS NULL

      -- domain.privilege.grant
      GRANT ALL ON DOMAIN
        public.test_domain_all TO app_user

      -- domain.privilege.revoke
      REVOKE ALL ON DOMAIN
        public.test_domain_all FROM app_user

      -- domain.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON DOMAIN
        public.test_domain_all FROM app_user

      -- domain.drop
      DROP DOMAIN public.test_domain_all

      -- type.enum.create
      CREATE TYPE public.test_enum AS ENUM (
        'value1',
        'value2',
        'value3'
      )

      -- type.enum.alter.owner
      ALTER TYPE public.test_enum OWNER TO
        owner2

      -- type.enum.alter.add_value
      ALTER TYPE public.test_enum ADD VALUE
        'value4' BEFORE 'value3'

      -- type.enum.comment.create
      COMMENT ON TYPE public.test_enum IS
        'enum comment'

      -- type.enum.comment.drop
      COMMENT ON TYPE public.test_enum IS NULL

      -- type.enum.privilege.grant
      GRANT ALL ON TYPE public.test_enum TO
        app_user

      -- type.enum.privilege.revoke
      REVOKE ALL ON TYPE public.test_enum FROM
        app_user

      -- type.enum.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE
        public.test_enum FROM app_user

      -- type.enum.drop
      DROP TYPE public.test_enum

      -- type.composite.create
      CREATE TYPE public.test_type AS (
        id   integer,
        name text    COLLATE "en_US"
      )

      -- type.composite.alter.owner
      ALTER TYPE public.test_type OWNER TO
        owner2

      -- type.composite.alter.add_attribute
      ALTER TYPE public.test_type ADD
        ATTRIBUTE new_attr text

      -- type.composite.alter.drop_attribute
      ALTER TYPE public.test_type DROP
        ATTRIBUTE id

      -- type.composite.alter.attribute_type
      ALTER TYPE public.test_type ALTER
        ATTRIBUTE name TYPE varchar(100)
        COLLATE "en_US"

      -- type.composite.comment.create
      COMMENT ON TYPE public.test_type IS
        'composite comment'

      -- type.composite.comment.drop
      COMMENT ON TYPE public.test_type IS NULL

      -- type.composite.comment.attribute.create
      COMMENT ON COLUMN public.test_type.id IS
        'attr comment'

      -- type.composite.comment.attribute.drop
      COMMENT ON COLUMN public.test_type.id IS
        NULL

      -- type.composite.privilege.grant
      GRANT ALL ON TYPE public.test_type TO
        app_user

      -- type.composite.privilege.revoke
      REVOKE ALL ON TYPE public.test_type FROM
        app_user

      -- type.composite.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE
        public.test_type FROM app_user

      -- type.composite.drop
      DROP TYPE public.test_type

      -- type.range.create
      CREATE TYPE public.daterange_custom AS
        RANGE (
        SUBTYPE         = date,
        SUBTYPE_OPCLASS = public.date_ops,
        COLLATION       = "en_US",
        CANONICAL       = public.canon_fn,
        SUBTYPE_DIFF    = public.diff_fn
      )

      -- type.range.alter.owner
      ALTER TYPE public.daterange_custom OWNER
        TO owner2

      -- type.range.comment.create
      COMMENT ON TYPE public.daterange_custom
        IS 'range comment'

      -- type.range.comment.drop
      COMMENT ON TYPE public.daterange_custom
        IS NULL

      -- type.range.privilege.grant
      GRANT ALL ON TYPE
        public.daterange_custom TO app_user

      -- type.range.privilege.revoke
      REVOKE ALL ON TYPE
        public.daterange_custom FROM app_user

      -- type.range.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE
        public.daterange_custom FROM app_user

      -- type.range.drop
      DROP TYPE public.daterange_custom"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- domain.create
      CREATE DOMAIN public.test_domain_all AS custom.text[][]
      COLLATE mycoll
      DEFAULT 'hello'
      NOT NULL
      CHECK (VALUE <> '')

      -- domain.alter.owner
      ALTER DOMAIN public.test_domain_all OWNER TO owner2

      -- domain.alter.set_default
      ALTER DOMAIN public.test_domain_all SET DEFAULT 'new'

      -- domain.alter.drop_default
      ALTER DOMAIN public.test_domain_all DROP DEFAULT

      -- domain.alter.set_not_null
      ALTER DOMAIN public.test_domain_all SET NOT NULL

      -- domain.alter.drop_not_null
      ALTER DOMAIN public.test_domain_all DROP NOT NULL

      -- domain.alter.add_constraint
      ALTER DOMAIN public.test_domain_all ADD CONSTRAINT domain_chk CHECK (VALUE <> '')

      -- domain.alter.drop_constraint
      ALTER DOMAIN public.test_domain_all DROP CONSTRAINT domain_chk

      -- domain.alter.validate_constraint
      ALTER DOMAIN public.test_domain_all VALIDATE CONSTRAINT domain_chk

      -- domain.comment.create
      COMMENT ON DOMAIN public.test_domain_all IS 'domain comment'

      -- domain.comment.drop
      COMMENT ON DOMAIN public.test_domain_all IS NULL

      -- domain.privilege.grant
      GRANT ALL ON DOMAIN public.test_domain_all TO app_user

      -- domain.privilege.revoke
      REVOKE ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON DOMAIN public.test_domain_all FROM app_user

      -- domain.drop
      DROP DOMAIN public.test_domain_all

      -- type.enum.create
      CREATE TYPE public.test_enum AS ENUM (
         'value1',
         'value2',
         'value3'
      )

      -- type.enum.alter.owner
      ALTER TYPE public.test_enum OWNER TO owner2

      -- type.enum.alter.add_value
      ALTER TYPE public.test_enum ADD VALUE 'value4' BEFORE 'value3'

      -- type.enum.comment.create
      COMMENT ON TYPE public.test_enum IS 'enum comment'

      -- type.enum.comment.drop
      COMMENT ON TYPE public.test_enum IS NULL

      -- type.enum.privilege.grant
      GRANT ALL ON TYPE public.test_enum TO app_user

      -- type.enum.privilege.revoke
      REVOKE ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_enum FROM app_user

      -- type.enum.drop
      DROP TYPE public.test_enum

      -- type.composite.create
      CREATE TYPE public.test_type AS (
         id integer,
         name text COLLATE "en_US"
      )

      -- type.composite.alter.owner
      ALTER TYPE public.test_type OWNER TO owner2

      -- type.composite.alter.add_attribute
      ALTER TYPE public.test_type ADD ATTRIBUTE new_attr text

      -- type.composite.alter.drop_attribute
      ALTER TYPE public.test_type DROP ATTRIBUTE id

      -- type.composite.alter.attribute_type
      ALTER TYPE public.test_type ALTER ATTRIBUTE name TYPE varchar(100) COLLATE "en_US"

      -- type.composite.comment.create
      COMMENT ON TYPE public.test_type IS 'composite comment'

      -- type.composite.comment.drop
      COMMENT ON TYPE public.test_type IS NULL

      -- type.composite.comment.attribute.create
      COMMENT ON COLUMN public.test_type.id IS 'attr comment'

      -- type.composite.comment.attribute.drop
      COMMENT ON COLUMN public.test_type.id IS NULL

      -- type.composite.privilege.grant
      GRANT ALL ON TYPE public.test_type TO app_user

      -- type.composite.privilege.revoke
      REVOKE ALL ON TYPE public.test_type FROM app_user

      -- type.composite.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_type FROM app_user

      -- type.composite.drop
      DROP TYPE public.test_type

      -- type.range.create
      CREATE TYPE public.daterange_custom AS RANGE (
         SUBTYPE date,
         SUBTYPE_OPCLASS public.date_ops,
         COLLATION "en_US",
         CANONICAL public.canon_fn,
         SUBTYPE_DIFF public.diff_fn
      )

      -- type.range.alter.owner
      ALTER TYPE public.daterange_custom OWNER TO owner2

      -- type.range.comment.create
      COMMENT ON TYPE public.daterange_custom IS 'range comment'

      -- type.range.comment.drop
      COMMENT ON TYPE public.daterange_custom IS NULL

      -- type.range.privilege.grant
      GRANT ALL ON TYPE public.daterange_custom TO app_user

      -- type.range.privilege.revoke
      REVOKE ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.daterange_custom FROM app_user

      -- type.range.drop
      DROP TYPE public.daterange_custom"
    `);
  });
});
