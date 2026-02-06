import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  formatCases,
  policy,
  publication,
  renderChanges,
  subscription,
} from "./fixtures.ts";
import { CreateRlsPolicy } from "../../../src/core/objects/rls-policy/changes/rls-policy.create.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "../../../src/core/objects/rls-policy/changes/rls-policy.alter.ts";
import {
  CreateCommentOnRlsPolicy,
  DropCommentOnRlsPolicy,
} from "../../../src/core/objects/rls-policy/changes/rls-policy.comment.ts";
import { DropRlsPolicy } from "../../../src/core/objects/rls-policy/changes/rls-policy.drop.ts";
import { CreatePublication } from "../../../src/core/objects/publication/changes/publication.create.ts";
import {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetList,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "../../../src/core/objects/publication/changes/publication.alter.ts";
import {
  CreateCommentOnPublication,
  DropCommentOnPublication,
} from "../../../src/core/objects/publication/changes/publication.comment.ts";
import { DropPublication } from "../../../src/core/objects/publication/changes/publication.drop.ts";
import { CreateSubscription } from "../../../src/core/objects/subscription/changes/subscription.create.ts";
import {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "../../../src/core/objects/subscription/changes/subscription.alter.ts";
import {
  CreateCommentOnSubscription,
  DropCommentOnSubscription,
} from "../../../src/core/objects/subscription/changes/subscription.comment.ts";
import { DropSubscription } from "../../../src/core/objects/subscription/changes/subscription.drop.ts";

const extraPublicationTables = [
  {
    schema: "public",
    name: "orders",
    columns: ["id", "status"],
    row_filter: "status = 'open'",
  },
];

const changes: ChangeCase[] = [
  { label: "rls.create", change: new CreateRlsPolicy({ policy }) },
  {
    label: "rls.alter.roles",
    change: new AlterRlsPolicySetRoles({ policy, roles: ["role1", "role2"] }),
  },
  {
    label: "rls.alter.using",
    change: new AlterRlsPolicySetUsingExpression({
      policy,
      usingExpression: "true",
    }),
  },
  {
    label: "rls.alter.with_check",
    change: new AlterRlsPolicySetWithCheckExpression({
      policy,
      withCheckExpression: "true",
    }),
  },
  { label: "rls.comment.create", change: new CreateCommentOnRlsPolicy({ policy }) },
  { label: "rls.comment.drop", change: new DropCommentOnRlsPolicy({ policy }) },
  { label: "rls.drop", change: new DropRlsPolicy({ policy }) },

  { label: "publication.create", change: new CreatePublication({ publication }) },
  {
    label: "publication.alter.set_options",
    change: new AlterPublicationSetOptions({
      publication,
      setPublish: true,
      setPublishViaPartitionRoot: true,
    }),
  },
  {
    label: "publication.alter.set_for_all_tables",
    change: new AlterPublicationSetForAllTables({ publication }),
  },
  {
    label: "publication.alter.set_list",
    change: new AlterPublicationSetList({ publication }),
  },
  {
    label: "publication.alter.add_tables",
    change: new AlterPublicationAddTables({
      publication,
      tables: extraPublicationTables,
    }),
  },
  {
    label: "publication.alter.drop_tables",
    change: new AlterPublicationDropTables({
      publication,
      tables: publication.tables,
    }),
  },
  {
    label: "publication.alter.add_schemas",
    change: new AlterPublicationAddSchemas({
      publication,
      schemas: ["analytics", "sales"],
    }),
  },
  {
    label: "publication.alter.drop_schemas",
    change: new AlterPublicationDropSchemas({
      publication,
      schemas: ["analytics"],
    }),
  },
  {
    label: "publication.alter.owner",
    change: new AlterPublicationSetOwner({
      publication,
      owner: "owner2",
    }),
  },
  {
    label: "publication.comment.create",
    change: new CreateCommentOnPublication({ publication }),
  },
  { label: "publication.comment.drop", change: new DropCommentOnPublication({ publication }) },
  { label: "publication.drop", change: new DropPublication({ publication }) },

  { label: "subscription.create", change: new CreateSubscription({ subscription }) },
  {
    label: "subscription.alter.connection",
    change: new AlterSubscriptionSetConnection({ subscription }),
  },
  {
    label: "subscription.alter.publication",
    change: new AlterSubscriptionSetPublication({ subscription }),
  },
  { label: "subscription.alter.enable", change: new AlterSubscriptionEnable({ subscription }) },
  {
    label: "subscription.alter.disable",
    change: new AlterSubscriptionDisable({ subscription }),
  },
  {
    label: "subscription.alter.options",
    change: new AlterSubscriptionSetOptions({
      subscription,
      options: ["binary", "streaming", "synchronous_commit", "origin", "failover"],
    }),
  },
  {
    label: "subscription.alter.owner",
    change: new AlterSubscriptionSetOwner({ subscription, owner: "owner2" }),
  },
  {
    label: "subscription.comment.create",
    change: new CreateCommentOnSubscription({ subscription }),
  },
  {
    label: "subscription.comment.drop",
    change: new DropCommentOnSubscription({ subscription }),
  },
  { label: "subscription.drop", change: new DropSubscription({ subscription }) },
];

describe("format options: rls + publication + subscription", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- rls.create
      CREATE POLICY test_policy_all ON public.test_table AS RESTRICTIVE FOR UPDATE TO role1, role2 USING (expr1) WITH CHECK (expr2)

      -- rls.alter.roles
      ALTER POLICY public.test_policy_all ON public.test_table TO role1, role2

      -- rls.alter.using
      ALTER POLICY public.test_policy_all ON public.test_table USING (true)

      -- rls.alter.with_check
      ALTER POLICY public.test_policy_all ON public.test_table WITH CHECK (true)

      -- rls.comment.create
      COMMENT ON POLICY test_policy_all ON public.test_table IS 'policy comment'

      -- rls.comment.drop
      COMMENT ON POLICY test_policy_all ON public.test_table IS NULL

      -- rls.drop
      DROP POLICY test_policy_all ON public.test_table

      -- publication.create
      CREATE PUBLICATION pub_custom FOR TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics WITH (publish = 'insert, update', publish_via_partition_root = true)

      -- publication.alter.set_options
      ALTER PUBLICATION pub_custom SET (publish = 'insert, update', publish_via_partition_root = true)

      -- publication.alter.set_for_all_tables
      ALTER PUBLICATION pub_custom SET FOR ALL TABLES

      -- publication.alter.set_list
      ALTER PUBLICATION pub_custom SET TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics

      -- publication.alter.add_tables
      ALTER PUBLICATION pub_custom ADD TABLE public.orders (id, status) WHERE (status = 'open')

      -- publication.alter.drop_tables
      ALTER PUBLICATION pub_custom DROP TABLE public.articles, public.authors

      -- publication.alter.add_schemas
      ALTER PUBLICATION pub_custom ADD TABLES IN SCHEMA analytics, TABLES IN SCHEMA sales

      -- publication.alter.drop_schemas
      ALTER PUBLICATION pub_custom DROP TABLES IN SCHEMA analytics

      -- publication.alter.owner
      ALTER PUBLICATION pub_custom OWNER TO owner2

      -- publication.comment.create
      COMMENT ON PUBLICATION pub_custom IS 'publication comment'

      -- publication.comment.drop
      COMMENT ON PUBLICATION pub_custom IS NULL

      -- publication.drop
      DROP PUBLICATION pub_custom

      -- subscription.create
      CREATE SUBSCRIPTION sub_base CONNECTION 'dbname=postgres application_name=sub_base' PUBLICATION pub_a, pub_b WITH (enabled = false, slot_name = 'custom_slot', binary = true, streaming = 'parallel', synchronous_commit = 'local', two_phase = true, disable_on_error = true, password_required = false, run_as_owner = true, origin = 'none', failover = true, create_slot = false, connect = false)

      -- subscription.alter.connection
      ALTER SUBSCRIPTION sub_base CONNECTION 'dbname=postgres application_name=sub_base'

      -- subscription.alter.publication
      ALTER SUBSCRIPTION sub_base SET PUBLICATION pub_a, pub_b WITH (refresh = false)

      -- subscription.alter.enable
      ALTER SUBSCRIPTION sub_base ENABLE

      -- subscription.alter.disable
      ALTER SUBSCRIPTION sub_base DISABLE

      -- subscription.alter.options
      ALTER SUBSCRIPTION sub_base SET (binary = true, streaming = 'parallel', synchronous_commit = 'local', origin = 'none', failover = true)

      -- subscription.alter.owner
      ALTER SUBSCRIPTION sub_base OWNER TO owner2

      -- subscription.comment.create
      COMMENT ON SUBSCRIPTION sub_base IS 'subscription comment'

      -- subscription.comment.drop
      COMMENT ON SUBSCRIPTION sub_base IS NULL

      -- subscription.drop
      DROP SUBSCRIPTION sub_base"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- rls.create
      CREATE POLICY test_policy_all ON public.test_table
      AS RESTRICTIVE
      FOR UPDATE
      TO role1, role2
      USING (expr1)
      WITH CHECK (expr2)

      -- rls.alter.roles
      ALTER POLICY public.test_policy_all ON public.test_table TO role1, role2

      -- rls.alter.using
      ALTER POLICY public.test_policy_all ON public.test_table USING (true)

      -- rls.alter.with_check
      ALTER POLICY public.test_policy_all ON public.test_table WITH CHECK (true)

      -- rls.comment.create
      COMMENT ON POLICY test_policy_all ON public.test_table IS 'policy comment'

      -- rls.comment.drop
      COMMENT ON POLICY test_policy_all ON public.test_table IS NULL

      -- rls.drop
      DROP POLICY test_policy_all ON public.test_table

      -- publication.create
      CREATE PUBLICATION pub_custom
      FOR TABLE public.articles WHERE (id > 1),
        TABLE public.authors (id, name),
        TABLES IN SCHEMA analytics
      WITH (
        publish = 'insert, update',
        publish_via_partition_root = true
      )

      -- publication.alter.set_options
      ALTER PUBLICATION pub_custom SET (publish = 'insert, update', publish_via_partition_root = true)

      -- publication.alter.set_for_all_tables
      ALTER PUBLICATION pub_custom SET FOR ALL TABLES

      -- publication.alter.set_list
      ALTER PUBLICATION pub_custom SET TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics

      -- publication.alter.add_tables
      ALTER PUBLICATION pub_custom ADD TABLE public.orders (id, status) WHERE (status = 'open')

      -- publication.alter.drop_tables
      ALTER PUBLICATION pub_custom DROP TABLE public.articles, public.authors

      -- publication.alter.add_schemas
      ALTER PUBLICATION pub_custom ADD TABLES IN SCHEMA analytics, TABLES IN SCHEMA sales

      -- publication.alter.drop_schemas
      ALTER PUBLICATION pub_custom DROP TABLES IN SCHEMA analytics

      -- publication.alter.owner
      ALTER PUBLICATION pub_custom OWNER TO owner2

      -- publication.comment.create
      COMMENT ON PUBLICATION pub_custom IS 'publication comment'

      -- publication.comment.drop
      COMMENT ON PUBLICATION pub_custom IS NULL

      -- publication.drop
      DROP PUBLICATION pub_custom

      -- subscription.create
      CREATE SUBSCRIPTION sub_base
      CONNECTION 'dbname=postgres application_name=sub_base'
      PUBLICATION pub_a, pub_b
      WITH (
        enabled = false,
        slot_name = 'custom_slot',
        binary = true,
        streaming = 'parallel',
        synchronous_commit = 'local',
        two_phase = true,
        disable_on_error = true,
        password_required = false,
        run_as_owner = true,
        origin = 'none',
        failover = true,
        create_slot = false,
        connect = false
      )

      -- subscription.alter.connection
      ALTER SUBSCRIPTION sub_base CONNECTION 'dbname=postgres application_name=sub_base'

      -- subscription.alter.publication
      ALTER SUBSCRIPTION sub_base SET PUBLICATION pub_a, pub_b WITH (refresh = false)

      -- subscription.alter.enable
      ALTER SUBSCRIPTION sub_base ENABLE

      -- subscription.alter.disable
      ALTER SUBSCRIPTION sub_base DISABLE

      -- subscription.alter.options
      ALTER SUBSCRIPTION sub_base SET (binary = true, streaming = 'parallel', synchronous_commit = 'local', origin = 'none', failover = true)

      -- subscription.alter.owner
      ALTER SUBSCRIPTION sub_base OWNER TO owner2

      -- subscription.comment.create
      COMMENT ON SUBSCRIPTION sub_base IS 'subscription comment'

      -- subscription.comment.drop
      COMMENT ON SUBSCRIPTION sub_base IS NULL

      -- subscription.drop
      DROP SUBSCRIPTION sub_base"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- rls.create
      create policy test_policy_all on public.test_table
      as restrictive
      for update
      to role1, role2
      using (expr1)
      with check (expr2)

      -- rls.alter.roles
      alter policy public.test_policy_all on public.test_table to role1, role2

      -- rls.alter.using
      alter policy public.test_policy_all on public.test_table using (true)

      -- rls.alter.with_check
      alter policy public.test_policy_all on public.test_table with check (true)

      -- rls.comment.create
      comment on policy test_policy_all on public.test_table is 'policy comment'

      -- rls.comment.drop
      comment on policy test_policy_all on public.test_table is null

      -- rls.drop
      drop policy test_policy_all on public.test_table

      -- publication.create
      create publication pub_custom
      for   table public.articles where (id > 1)
          , table public.authors (id, name)
          , tables in schema analytics
      with (
            publish = 'insert, update'
          , publish_via_partition_root = true
      )

      -- publication.alter.set_options
      alter publication pub_custom set (publish = 'insert, update', publish_via_partition_root = true)

      -- publication.alter.set_for_all_tables
      alter publication pub_custom set for all tables

      -- publication.alter.set_list
      alter publication pub_custom set TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics

      -- publication.alter.add_tables
      alter publication pub_custom add TABLE public.orders (id, status) WHERE (status = 'open')

      -- publication.alter.drop_tables
      alter publication pub_custom drop table public.articles, public.authors

      -- publication.alter.add_schemas
      alter publication pub_custom add tables in schema analytics, tables in schema sales

      -- publication.alter.drop_schemas
      alter publication pub_custom drop tables in schema analytics

      -- publication.alter.owner
      alter publication pub_custom owner to owner2

      -- publication.comment.create
      comment on publication pub_custom is 'publication comment'

      -- publication.comment.drop
      comment on publication pub_custom is null

      -- publication.drop
      drop publication pub_custom

      -- subscription.create
      create subscription sub_base
      connection 'dbname=postgres application_name=sub_base'
      publication pub_a, pub_b
      with (
            enabled = false
          , slot_name = 'custom_slot'
          , binary = true
          , streaming = 'parallel'
          , synchronous_commit = 'local'
          , two_phase = true
          , disable_on_error = true
          , password_required = false
          , run_as_owner = true
          , origin = 'none'
          , failover = true
          , create_slot = false
          , connect = false
      )

      -- subscription.alter.connection
      alter subscription sub_base connection 'dbname=postgres application_name=sub_base'

      -- subscription.alter.publication
      alter subscription sub_base set publication pub_a, pub_b with (refresh = false)

      -- subscription.alter.enable
      alter subscription sub_base enable

      -- subscription.alter.disable
      alter subscription sub_base disable

      -- subscription.alter.options
      alter subscription sub_base set (binary = true, streaming = 'parallel', synchronous_commit = 'local', origin = 'none', failover = true)

      -- subscription.alter.owner
      alter subscription sub_base owner to owner2

      -- subscription.comment.create
      comment on subscription sub_base is 'subscription comment'

      -- subscription.comment.drop
      comment on subscription sub_base is null

      -- subscription.drop
      drop subscription sub_base"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- rls.create
      CREATE POLICY test_policy_all ON
        public.test_table
      AS RESTRICTIVE
      FOR UPDATE
      TO role1, role2
      USING (expr1)
      WITH CHECK (expr2)

      -- rls.alter.roles
      ALTER POLICY public.test_policy_all ON
        public.test_table TO role1, role2

      -- rls.alter.using
      ALTER POLICY public.test_policy_all ON
        public.test_table USING (true)

      -- rls.alter.with_check
      ALTER POLICY public.test_policy_all ON
        public.test_table WITH CHECK (true)

      -- rls.comment.create
      COMMENT ON POLICY test_policy_all ON
        public.test_table IS 'policy comment'

      -- rls.comment.drop
      COMMENT ON POLICY test_policy_all ON
        public.test_table IS NULL

      -- rls.drop
      DROP POLICY test_policy_all ON
        public.test_table

      -- publication.create
      CREATE PUBLICATION pub_custom
      FOR TABLE public.articles WHERE (id >
        1),
        TABLE public.authors (id, name),
        TABLES IN SCHEMA analytics
      WITH (
        publish = 'insert, update',
        publish_via_partition_root = true
      )

      -- publication.alter.set_options
      ALTER PUBLICATION pub_custom SET
        (publish = 'insert, update',
        publish_via_partition_root = true)

      -- publication.alter.set_for_all_tables
      ALTER PUBLICATION pub_custom SET FOR ALL
        TABLES

      -- publication.alter.set_list
      ALTER PUBLICATION pub_custom SET TABLE
        public.articles WHERE (id > 1), TABLE
        public.authors (id, name), TABLES IN
        SCHEMA analytics

      -- publication.alter.add_tables
      ALTER PUBLICATION pub_custom ADD TABLE
        public.orders (id, status) WHERE
        (status = 'open')

      -- publication.alter.drop_tables
      ALTER PUBLICATION pub_custom DROP TABLE
        public.articles, public.authors

      -- publication.alter.add_schemas
      ALTER PUBLICATION pub_custom ADD TABLES
        IN SCHEMA analytics, TABLES IN SCHEMA
        sales

      -- publication.alter.drop_schemas
      ALTER PUBLICATION pub_custom DROP TABLES
        IN SCHEMA analytics

      -- publication.alter.owner
      ALTER PUBLICATION pub_custom OWNER TO
        owner2

      -- publication.comment.create
      COMMENT ON PUBLICATION pub_custom IS
        'publication comment'

      -- publication.comment.drop
      COMMENT ON PUBLICATION pub_custom IS
        NULL

      -- publication.drop
      DROP PUBLICATION pub_custom

      -- subscription.create
      CREATE SUBSCRIPTION sub_base
      CONNECTION 'dbname=postgres
        application_name=sub_base'
      PUBLICATION pub_a, pub_b
      WITH (
        enabled = false,
        slot_name = 'custom_slot',
        binary = true,
        streaming = 'parallel',
        synchronous_commit = 'local',
        two_phase = true,
        disable_on_error = true,
        password_required = false,
        run_as_owner = true,
        origin = 'none',
        failover = true,
        create_slot = false,
        connect = false
      )

      -- subscription.alter.connection
      ALTER SUBSCRIPTION sub_base CONNECTION
        'dbname=postgres
        application_name=sub_base'

      -- subscription.alter.publication
      ALTER SUBSCRIPTION sub_base SET
        PUBLICATION pub_a, pub_b WITH (refresh
          = false)

      -- subscription.alter.enable
      ALTER SUBSCRIPTION sub_base ENABLE

      -- subscription.alter.disable
      ALTER SUBSCRIPTION sub_base DISABLE

      -- subscription.alter.options
      ALTER SUBSCRIPTION sub_base SET (binary
        = true, streaming = 'parallel',
        synchronous_commit = 'local', origin =
        'none', failover = true)

      -- subscription.alter.owner
      ALTER SUBSCRIPTION sub_base OWNER TO
        owner2

      -- subscription.comment.create
      COMMENT ON SUBSCRIPTION sub_base IS
        'subscription comment'

      -- subscription.comment.drop
      COMMENT ON SUBSCRIPTION sub_base IS NULL

      -- subscription.drop
      DROP SUBSCRIPTION sub_base"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- rls.create
      CREATE POLICY test_policy_all ON public.test_table
      AS RESTRICTIVE
      FOR UPDATE
      TO role1, role2
      USING (expr1)
      WITH CHECK (expr2)

      -- rls.alter.roles
      ALTER POLICY public.test_policy_all ON public.test_table TO role1, role2

      -- rls.alter.using
      ALTER POLICY public.test_policy_all ON public.test_table USING (true)

      -- rls.alter.with_check
      ALTER POLICY public.test_policy_all ON public.test_table WITH CHECK (true)

      -- rls.comment.create
      COMMENT ON POLICY test_policy_all ON public.test_table IS 'policy comment'

      -- rls.comment.drop
      COMMENT ON POLICY test_policy_all ON public.test_table IS NULL

      -- rls.drop
      DROP POLICY test_policy_all ON public.test_table

      -- publication.create
      CREATE PUBLICATION pub_custom
      FOR TABLE public.articles WHERE (id > 1),
         TABLE public.authors (id, name),
         TABLES IN SCHEMA analytics
      WITH (
         publish = 'insert, update',
         publish_via_partition_root = true
      )

      -- publication.alter.set_options
      ALTER PUBLICATION pub_custom SET (publish = 'insert, update', publish_via_partition_root = true)

      -- publication.alter.set_for_all_tables
      ALTER PUBLICATION pub_custom SET FOR ALL TABLES

      -- publication.alter.set_list
      ALTER PUBLICATION pub_custom SET TABLE public.articles WHERE (id > 1), TABLE public.authors (id, name), TABLES IN SCHEMA analytics

      -- publication.alter.add_tables
      ALTER PUBLICATION pub_custom ADD TABLE public.orders (id, status) WHERE (status = 'open')

      -- publication.alter.drop_tables
      ALTER PUBLICATION pub_custom DROP TABLE public.articles, public.authors

      -- publication.alter.add_schemas
      ALTER PUBLICATION pub_custom ADD TABLES IN SCHEMA analytics, TABLES IN SCHEMA sales

      -- publication.alter.drop_schemas
      ALTER PUBLICATION pub_custom DROP TABLES IN SCHEMA analytics

      -- publication.alter.owner
      ALTER PUBLICATION pub_custom OWNER TO owner2

      -- publication.comment.create
      COMMENT ON PUBLICATION pub_custom IS 'publication comment'

      -- publication.comment.drop
      COMMENT ON PUBLICATION pub_custom IS NULL

      -- publication.drop
      DROP PUBLICATION pub_custom

      -- subscription.create
      CREATE SUBSCRIPTION sub_base
      CONNECTION 'dbname=postgres application_name=sub_base'
      PUBLICATION pub_a, pub_b
      WITH (
         enabled = false,
         slot_name = 'custom_slot',
         binary = true,
         streaming = 'parallel',
         synchronous_commit = 'local',
         two_phase = true,
         disable_on_error = true,
         password_required = false,
         run_as_owner = true,
         origin = 'none',
         failover = true,
         create_slot = false,
         connect = false
      )

      -- subscription.alter.connection
      ALTER SUBSCRIPTION sub_base CONNECTION 'dbname=postgres application_name=sub_base'

      -- subscription.alter.publication
      ALTER SUBSCRIPTION sub_base SET PUBLICATION pub_a, pub_b WITH (refresh = false)

      -- subscription.alter.enable
      ALTER SUBSCRIPTION sub_base ENABLE

      -- subscription.alter.disable
      ALTER SUBSCRIPTION sub_base DISABLE

      -- subscription.alter.options
      ALTER SUBSCRIPTION sub_base SET (binary = true, streaming = 'parallel', synchronous_commit = 'local', origin = 'none', failover = true)

      -- subscription.alter.owner
      ALTER SUBSCRIPTION sub_base OWNER TO owner2

      -- subscription.comment.create
      COMMENT ON SUBSCRIPTION sub_base IS 'subscription comment'

      -- subscription.comment.drop
      COMMENT ON SUBSCRIPTION sub_base IS NULL

      -- subscription.drop
      DROP SUBSCRIPTION sub_base"
    `);
  });
});
