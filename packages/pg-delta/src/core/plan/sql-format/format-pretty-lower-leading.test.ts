import { describe, expect, test } from "bun:test";
import { renderScript } from "./fixtures.ts";

describe("sql formatting snapshots", () => {
  test("format-pretty-lower-leading", () => {
    const output = [
      "-- format: { keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indent: 4 }",
      renderScript({
        keywordCase: "lower",
        commaStyle: "leading",
        alignColumns: true,
        indent: 4,
      }),
    ]
      .filter(Boolean)
      .join("\n");
    expect(output).toMatchInlineSnapshot(`
      "-- format: { keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indent: 4 }
      -- schema.create
      create schema application_schema_with_very_long_name_for_wrapping_tests authorization admin;

      -- schema.drop
      drop schema application_schema_with_very_long_name_for_wrapping_tests;

      -- schema.alter.change_owner
      alter schema application_schema_with_very_long_name_for_wrapping_tests owner to new_admin;

      -- schema.comment
      comment on schema application_schema_with_very_long_name_for_wrapping_tests is
          'application schema';

      -- schema.drop_comment
      comment on schema application_schema_with_very_long_name_for_wrapping_tests is null;

      -- schema.grant
      grant all on schema application_schema_with_very_long_name_for_wrapping_tests to app_user
          with grant option;

      -- schema.revoke
      revoke create on schema application_schema_with_very_long_name_for_wrapping_tests from app_user;

      -- schema.revoke_grant_option
      revoke grant option for usage
          on schema application_schema_with_very_long_name_for_wrapping_tests from app_user;

      -- extension.create
      create extension pgcrypto with schema extensions;

      -- extension.drop
      drop extension pgcrypto;

      -- extension.alter.update_version
      alter extension pgcrypto update to '1.4';

      -- extension.alter.set_schema
      alter extension pgcrypto set schema public;

      -- extension.comment
      comment on extension pgcrypto is 'cryptographic functions';

      -- extension.drop_comment
      comment on extension pgcrypto is null;

      -- domain.create
      create domain public.test_domain_all as custom.text[][]
          collate mycoll
          default 'hello'
          not null
          check (VALUE <> '');

      -- domain.drop
      drop domain public.test_domain_all;

      -- domain.alter.set_default
      alter domain public.test_domain_all
          set default 'world';

      -- domain.alter.drop_default
      alter domain public.test_domain_all
          drop default;

      -- domain.alter.set_not_null
      alter domain public.test_domain_all
          set not null;

      -- domain.alter.drop_not_null
      alter domain public.test_domain_all
          drop not null;

      -- domain.alter.change_owner
      alter domain public.test_domain_all
          owner to new_owner;

      -- domain.alter.add_constraint
      alter domain public.test_domain_all
          add constraint domain_len_chk check (char_length(VALUE) <= 255) not valid;

      -- domain.alter.drop_constraint
      alter domain public.test_domain_all
          drop constraint domain_chk;

      -- domain.alter.validate_constraint
      alter domain public.test_domain_all
          validate constraint domain_len_chk;

      -- domain.comment
      comment on domain public.test_domain_all is 'domain comment';

      -- domain.drop_comment
      comment on domain public.test_domain_all is null;

      -- domain.grant
      grant all on domain public.test_domain_all to app_user;

      -- domain.revoke
      revoke all on domain public.test_domain_all from app_user;

      -- domain.revoke_grant_option
      revoke grant option for all on domain public.test_domain_all from app_user;

      -- type.enum.create
      create type public.test_enum as enum (
            'value1'
          , 'value2'
          , 'value3'
      );

      -- type.enum.drop
      drop type public.test_enum;

      -- type.enum.alter.change_owner
      alter type public.test_enum owner to new_owner;

      -- type.enum.alter.add_value
      alter type public.test_enum add VALUE 'value4' after 'value2';

      -- type.enum.comment
      comment on type public.test_enum is 'enum comment';

      -- type.enum.drop_comment
      comment on type public.test_enum is null;

      -- type.enum.grant
      grant all on type public.test_enum to app_user;

      -- type.enum.revoke
      revoke all on type public.test_enum from app_user;

      -- type.enum.revoke_grant_option
      revoke grant option for all on type public.test_enum from app_user;

      -- type.composite.create
      create type public.test_type as (
            id   integer
          , name text    collate "en_US"
      );

      -- type.composite.drop
      drop type public.test_type;

      -- type.composite.alter.change_owner
      alter type public.test_type owner to new_owner;

      -- type.composite.alter.add_attribute
      alter type public.test_type add attribute age integer;

      -- type.composite.alter.drop_attribute
      alter type public.test_type drop attribute name;

      -- type.composite.alter.alter_attr_type
      alter type public.test_type alter attribute name type varchar(255) collate "C";

      -- type.composite.comment
      comment on type public.test_type is 'composite comment';

      -- type.composite.drop_comment
      comment on type public.test_type is null;

      -- type.composite.attr_comment
      comment on column public.test_type.id is 'attr comment';

      -- type.composite.drop_attr_comment
      comment on column public.test_type.id is null;

      -- type.composite.grant
      grant all on type public.test_type to app_user;

      -- type.composite.revoke
      revoke all on type public.test_type from app_user;

      -- type.composite.revoke_grant_option
      revoke grant option for all on type public.test_type from app_user;

      -- type.range.create
      create type public.daterange_custom as range (
            SUBTYPE         = date
          , SUBTYPE_OPCLASS = public.date_ops
          , collation       = "en_US"
          , CANONICAL       = public.canon_fn
          , SUBTYPE_DIFF    = public.diff_fn
      );

      -- type.range.drop
      drop type public.daterange_custom;

      -- type.range.alter.change_owner
      alter type public.daterange_custom owner to new_owner;

      -- type.range.comment
      comment on type public.daterange_custom is 'range comment';

      -- type.range.drop_comment
      comment on type public.daterange_custom is null;

      -- type.range.grant
      grant all on type public.daterange_custom to app_user;

      -- type.range.revoke
      revoke all on type public.daterange_custom from app_user;

      -- type.range.revoke_grant_option
      revoke grant option for all on type public.daterange_custom from app_user;

      -- collation.create
      create collation public.test (
            LOCALE        = 'en_US'
          , LC_COLLATE    = 'en_US'
          , LC_CTYPE      = 'en_US'
          , PROVIDER      = icu
          , DETERMINISTIC = false
          , RULES         = '& A < a <<< à'
          , version       = '1.0'
      );

      -- collation.drop
      drop collation public.test;

      -- collation.alter.change_owner
      alter collation public.test owner to new_owner;

      -- collation.alter.refresh_version
      alter collation public.test refresh version;

      -- collation.comment
      comment on collation public.test is 'collation comment';

      -- collation.drop_comment
      comment on collation public.test is null;

      -- table.create
      create table public.table_with_very_long_name_for_formatting_and_wrapping_test (
            id         bigint      generated always as identity not null
          , status     text        collate "en_US" default 'pending'
          , created_at timestamptz default now()
          , ref_id     bigint
          , computed   bigint      generated always as (id * 2) stored
      ) with (fillfactor=70, autovacuum_enabled=false);

      -- table.drop
      drop table public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- table.alter.add_column
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          add column email text collate "en_US" default 'user@example.com' not null;

      -- table.alter.drop_column
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          drop column computed;

      -- table.alter.column_type
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          alter column status type character varying(255) collate "C";

      -- table.alter.column_set_default
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          alter column status set default 'active';

      -- table.alter.column_drop_default
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          alter column status drop default;

      -- table.alter.column_set_not_null
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          alter column status set not null;

      -- table.alter.column_drop_not_null
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          alter column status drop not null;

      -- table.alter.add_constraint
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          add constraint uq_t_fmt_status unique (status);

      -- table.alter.add_fk_constraint
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          add constraint fk_t_fmt_ref foreign key (ref_id) references public.other_table(id) match full
              on update set null on delete cascade deferrable initially deferred;

      -- table.alter.drop_constraint
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          drop constraint uq_t_fmt_status;

      -- table.alter.validate_constraint
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          validate constraint chk_t_fmt_status;

      -- table.alter.change_owner
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          owner to new_owner;

      -- table.alter.set_logged
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          set logged;

      -- table.alter.set_unlogged
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          set unlogged;

      -- table.alter.enable_rls
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          enable row level security;

      -- table.alter.disable_rls
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          disable row level security;

      -- table.alter.force_rls
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          force row level security;

      -- table.alter.no_force_rls
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          no force row level security;

      -- table.alter.set_storage_params
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          set (fillfactor=80, autovacuum_enabled=true);

      -- table.alter.reset_storage_params
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          reset (fillfactor, autovacuum_enabled);

      -- table.alter.replica_identity
      alter table public.table_with_very_long_name_for_formatting_and_wrapping_test
          replica identity full;

      -- table.alter.attach_partition
      alter table public.events
          attach partition public.events_2024 for values from ('2024-01-01') to ('2025-01-01');

      -- table.alter.detach_partition
      alter table public.events
          detach partition public.events_2024;

      -- table.comment
      comment on table public.table_with_very_long_name_for_formatting_and_wrapping_test is
          'table comment';

      -- table.drop_comment
      comment on table public.table_with_very_long_name_for_formatting_and_wrapping_test is null;

      -- table.column_comment
      comment on column public.table_with_very_long_name_for_formatting_and_wrapping_test.id is
          'id column';

      -- table.drop_column_comment
      comment on column public.table_with_very_long_name_for_formatting_and_wrapping_test.id is null;

      -- table.constraint_comment
      comment on constraint pk_t_fmt
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is
          'primary key';

      -- table.drop_constraint_comment
      comment on constraint chk_t_fmt_status
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is null;

      -- table.grant
      grant insert,
          select on public.table_with_very_long_name_for_formatting_and_wrapping_test to app_reader;

      -- table.revoke
      revoke delete,
          update on public.table_with_very_long_name_for_formatting_and_wrapping_test from app_reader;

      -- table.revoke_grant_option
      revoke grant option for insert,
          select on public.table_with_very_long_name_for_formatting_and_wrapping_test from app_reader;

      -- publication.create
      create publication pub_custom for table
          public.articles_with_a_very_long_name_very_very_long_name_that_will_go_above_the_wrapping_limit
          (
            id
          , title
      ) where (published = true),
          table public.comments_a_little_smaller_name_than_the_previous_one, tables in schema analytics;

      -- publication.drop
      drop publication pub_custom;

      -- publication.alter.set_options
      alter publication pub_custom
          set (publish = 'insert, update, delete, truncate', publish_via_partition_root = false);

      -- publication.alter.set_all_tables
      alter publication pub_custom set for all tables;

      -- publication.alter.set_list
      alter publication pub_custom
          set table
          public.articles_with_a_very_long_name_very_very_long_name_that_will_go_above_the_wrapping_limit
          (id, title) where (published = true),
          table public.comments_a_little_smaller_name_than_the_previous_one, tables in schema analytics;

      -- publication.alter.add_tables
      alter publication pub_custom
          add table public.new_table_with_very_long_name_for_formatting_and_wrapping_test;

      -- publication.alter.drop_tables
      alter publication pub_custom drop table public.comments_a_little_smaller_name_than_the_previous_one;

      -- publication.alter.add_schemas
      alter publication pub_custom add tables in schema staging;

      -- publication.alter.drop_schemas
      alter publication pub_custom drop tables in schema analytics;

      -- publication.alter.set_owner
      alter publication pub_custom owner to new_owner;

      -- publication.comment
      comment on publication pub_custom is 'publication comment';

      -- publication.drop_comment
      comment on publication pub_custom is null;

      -- view.create
      create view public.test_view with (security_barrier=true, check_option=local) AS SELECT *
      FROM test_table;

      -- view.drop
      drop view public.test_view;

      -- view.alter.change_owner
      alter view public.test_view owner to new_owner;

      -- view.alter.set_options
      alter view public.test_view set (security_barrier=true, check_option=cascaded);

      -- view.alter.reset_options
      alter view public.test_view reset (security_barrier);

      -- view.comment
      comment on view public.test_view is 'view comment';

      -- view.drop_comment
      comment on view public.test_view is null;

      -- view.grant
      grant select on public.test_view to app_reader with grant option;

      -- view.revoke
      revoke select on public.test_view from app_reader;

      -- view.revoke_grant_option
      revoke grant option for select on public.test_view from app_reader;

      -- rule.create
      create rule test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;

      -- rule.drop
      drop rule test_rule on public.test_table;

      -- rule.replace
      create or replace rule test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;

      -- rule.alter.set_enabled
      alter table public.test_table
          disable rule test_rule;

      -- rule.comment
      comment on rule test_rule on public.test_table is 'rule comment';

      -- rule.drop_comment
      comment on rule test_rule on public.test_table is null;

      -- procedure.create
      create procedure public.test_procedure()
          language plpgsql
          AS $$ begin null; end; $$;

      -- procedure.drop
      drop procedure public.test_procedure();

      -- function.create
      create function public.calculate_metrics_for_analytics_dashboard_with_extended_name (
            "p_schema_name_for_analytics" text
          , "p_table_name_for_metrics"    text
          , "p_limit_count_default"       integer default 100
      )
          returns table (
                total   bigint
              , average numeric
          )
          language plpgsql
          stable
          security definer
          parallel safe
          cost 100
          rows 10
          strict
          set search_path to 'pg_catalog', 'public'
          AS $function$ BEGIN RETURN QUERY SELECT count(*)::bigint, avg(value)::numeric FROM generate_series(1, p_limit_count_default); END; $function$;

      -- function.drop
      drop function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(in
          "p_schema_name_for_analytics" text,
          in "p_table_name_for_metrics" text, in "p_limit_count_default" integer);

      -- function.alter.change_owner
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name owner to
          new_admin;

      -- function.alter.set_security
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name security invoker;

      -- function.alter.set_config
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name
          set work_mem to '256MB';

      -- function.alter.set_volatility
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name immutable;

      -- function.alter.set_strictness
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name called
          on null input;

      -- function.alter.set_leakproof
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name leakproof;

      -- function.alter.set_parallel
      alter function public.calculate_metrics_for_analytics_dashboard_with_extended_name parallel
          restricted;

      -- function.comment
      comment on function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(text,text,integer) is
          'Calculate metrics for a given table';

      -- function.drop_comment
      comment on function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(text,text,integer) is null;

      -- function.grant
      grant all on function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) to
          app_user with grant option;

      -- function.revoke
      revoke all on function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) from
          app_user;

      -- function.revoke_grant_option
      revoke grant option for all on function
          public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) from
          app_user;

      -- sequence.create
      create sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq;

      -- sequence.drop
      drop sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq;

      -- sequence.alter.set_owned_by
      alter sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq owned by
          public.table_with_very_long_name_for_formatting_and_wrapping_test.id;

      -- sequence.alter.set_options
      alter sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq increment by
          10 minvalue 1 maxvalue 1000000 cache 5 cycle;

      -- sequence.comment
      comment on sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq is
          'sequence for table_with_very_long_name_for_formatting_and_wrapping_test.id';

      -- sequence.drop_comment
      comment on sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq is null;

      -- sequence.grant
      grant select,
          usage
          on sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq to app_user;

      -- sequence.revoke
      revoke usage
          on sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq from
          app_user;

      -- sequence.revoke_grant_option
      revoke grant option for usage
          on sequence public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq from
          app_user;

      -- policy.create
      create policy allow_select_own on public.table_with_very_long_name_for_formatting_and_wrapping_test
          for select
          to authenticated
          using (auth.uid() = user_id);

      -- policy.create_restrictive
      create policy restrict_delete on public.table_with_very_long_name_for_formatting_and_wrapping_test
          as restrictive
          for delete
          to authenticated, service_role
          using (auth.uid() = owner_id)
          with check (status <> 'locked');

      -- policy.drop
      drop policy allow_select_own on public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- policy.alter.set_roles
      alter policy public.allow_select_own
          on public.table_with_very_long_name_for_formatting_and_wrapping_test to authenticated, anon;

      -- policy.alter.set_using
      alter policy public.allow_select_own
          on public.table_with_very_long_name_for_formatting_and_wrapping_test
          using (auth.uid() = user_id AND status = 'active');

      -- policy.alter.set_with_check
      alter policy public.allow_select_own
          on public.table_with_very_long_name_for_formatting_and_wrapping_test with
          check (auth.uid() = user_id);

      -- policy.comment
      comment on policy allow_select_own
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is
          'rls policy comment';

      -- policy.drop_comment
      comment on policy allow_select_own
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is null;

      -- index.create
      create unique index idx_t_fmt_status
          on public.table_with_very_long_name_for_formatting_and_wrapping_test (status)
          with (fillfactor='90')
          where (status <> 'archived'::text);

      -- index.create_gin
      create index idx_t_fmt_search on public.table_with_very_long_name_for_formatting_and_wrapping_test
          using gin (to_tsvector('english'::regconfig, status));

      -- index.drop
      drop index public.idx_t_fmt_status;

      -- index.alter.set_storage_params
      alter index public.idx_t_fmt_status reset (deduplicate_items);

      alter index public.idx_t_fmt_status set (fillfactor=80);

      -- index.alter.set_statistics
      alter index public.idx_t_fmt_status alter column 1 set statistics 500;

      -- index.comment
      comment on index public.idx_t_fmt_status is 'index comment';

      -- index.drop_comment
      comment on index public.idx_t_fmt_status is null;

      -- trigger.create
      create trigger trg_audit after insert or update
          on public.table_with_very_long_name_for_formatting_and_wrapping_test
          referencing OLD table as old_rows NEW table as new_rows for each row when (
            (NEW.status IS DISTINCT FROM OLD.status)
      ) execute function public.audit_trigger_fn('arg1', 'arg2');

      -- trigger.drop
      drop trigger trg_audit on public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- trigger.replace
      create or replace trigger trg_audit after insert or update
          on public.table_with_very_long_name_for_formatting_and_wrapping_test
          referencing OLD table as old_rows NEW table as new_rows for each row when (
            (NEW.status IS DISTINCT FROM OLD.status)
      ) execute function public.audit_trigger_fn('arg1', 'arg2');

      -- trigger.comment
      comment on trigger trg_audit
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is
          'trigger comment';

      -- trigger.drop_comment
      comment on trigger trg_audit
          on public.table_with_very_long_name_for_formatting_and_wrapping_test is null;

      -- matview.create
      create materialized view analytics.daily_stats
          with (fillfactor=70)
          AS SELECT date_trunc('day', created_at) AS day, count(*) AS total
      FROM public.events
      GROUP BY 1 WITH DATA;

      -- matview.drop
      drop materialized view analytics.daily_stats;

      -- matview.alter.change_owner
      alter materialized view analytics.daily_stats
          owner to new_owner;

      -- matview.alter.set_storage
      alter materialized view analytics.daily_stats
          reset (autovacuum_enabled);

      alter materialized view analytics.daily_stats
          set (fillfactor=80);

      -- matview.comment
      comment on materialized view analytics.daily_stats is 'daily aggregation';

      -- matview.drop_comment
      comment on materialized view analytics.daily_stats is null;

      -- matview.column_comment
      comment on column analytics.daily_stats.day is 'day bucket';

      -- matview.drop_column_comment
      comment on column analytics.daily_stats.day is null;

      -- matview.grant
      grant select on analytics.daily_stats to app_reader;

      -- matview.revoke
      revoke select on analytics.daily_stats from app_reader;

      -- matview.revoke_grant_option
      revoke grant option for select on analytics.daily_stats from app_reader;

      -- aggregate.create
      create aggregate public.array_cat_agg(anycompatiblearray) (
            SFUNC       = array_cat
          , STYPE       = anycompatiblearray
          , COMBINEFUNC = array_cat
          , INITCOND    = '{}'
          , parallel safe
          , strict
      );

      -- aggregate.drop
      drop aggregate public.array_cat_agg(anycompatiblearray);

      -- aggregate.alter.change_owner
      alter aggregate public.array_cat_agg(anycompatiblearray) owner to new_owner;

      -- aggregate.comment
      comment on aggregate public.array_cat_agg(anycompatiblearray) is 'concatenate arrays aggregate';

      -- aggregate.drop_comment
      comment on aggregate public.array_cat_agg(anycompatiblearray) is null;

      -- aggregate.grant
      grant all on function public.array_cat_agg(anycompatiblearray) to app_user;

      -- aggregate.revoke
      revoke all on function public.array_cat_agg(anycompatiblearray) from app_user;

      -- aggregate.revoke_grant_option
      revoke grant option for all on function public.array_cat_agg(anycompatiblearray) from app_user;

      -- event_trigger.create
      create event trigger prevent_drop
          on sql_drop
          when tag in ('DROP TABLE', 'DROP SCHEMA')
          execute function public.prevent_drop_fn();

      -- event_trigger.drop
      drop event trigger prevent_drop;

      -- event_trigger.alter.change_owner
      alter event trigger prevent_drop
          owner to new_owner;

      -- event_trigger.alter.set_enabled
      alter event trigger prevent_drop
          disable;

      -- event_trigger.comment
      comment on event trigger prevent_drop is 'prevent accidental drops';

      -- event_trigger.drop_comment
      comment on event trigger prevent_drop is null;

      -- language.create
      create trusted language plv8
          handler plv8_call_handler
          inline plv8_inline_handler
          validator plv8_call_validator;

      -- language.drop
      drop language plv8;

      -- language.alter.change_owner
      alter language plv8 owner to new_owner;

      -- language.comment
      comment on language plv8 is 'PL/V8 trusted procedural language';

      -- language.drop_comment
      comment on language plv8 is null;

      -- language.grant
      grant all on language plv8 to app_user with grant option;

      -- language.revoke
      revoke all on language plv8 from app_user;

      -- language.revoke_grant_option
      revoke grant option for all on language plv8 from app_user;

      -- role.create
      create role app_user with login connection limit 100;

      -- role.drop
      drop role app_user;

      -- role.alter.set_options
      alter role app_user with nosuperuser createdb;

      -- role.alter.set_config
      alter role app_user set statement_timeout to '60000';

      -- role.comment
      comment on role app_user is 'application user role';

      -- role.drop_comment
      comment on role app_user is null;

      -- role.grant_membership
      grant app_user to dev_user with admin option;

      -- role.revoke_membership
      revoke app_user from dev_user;

      -- role.revoke_membership_options
      revoke admin option for app_user from dev_user;

      -- role.grant_default_privileges
      alter default privileges for role app_user in schema public grant select on tables to app_reader;

      -- role.revoke_default_privileges
      alter default privileges for role app_user in schema public revoke select on tables from app_reader;

      -- subscription.create
      create subscription sub_replica
          connection 'host=primary.db port=5432 dbname=mydb'
          publication pub_custom
          with (
                slot_name          = 'sub_replica_slot'
              , binary             = true
              , streaming          = 'parallel'
              , synchronous_commit = 'remote_apply'
              , disable_on_error   = true
              , failover           = true
          );

      -- subscription.drop
      drop subscription sub_replica;

      -- subscription.alter.set_connection
      alter subscription sub_replica
          connection 'host=primary.db port=5432 dbname=mydb';

      -- subscription.alter.set_publication
      alter subscription sub_replica
          set publication pub_custom;

      -- subscription.alter.enable
      alter subscription sub_replica
          enable;

      -- subscription.alter.disable
      alter subscription sub_replica
          disable;

      -- subscription.alter.set_options
      alter subscription sub_replica
          set (
                binary             = true
              , streaming          = 'parallel'
              , synchronous_commit = 'remote_apply'
          );

      -- subscription.alter.set_owner
      alter subscription sub_replica
          owner to new_owner;

      -- subscription.comment
      comment on subscription sub_replica is 'replication subscription';

      -- subscription.drop_comment
      comment on subscription sub_replica is null;

      -- fdw.create
      create foreign data wrapper postgres_fdw
          handler postgres_fdw_handler
          validator postgres_fdw_validator
          options (debug 'true');

      -- fdw.drop
      drop foreign data wrapper postgres_fdw;

      -- fdw.alter.change_owner
      alter foreign data wrapper postgres_fdw
          owner to new_owner;

      -- fdw.alter.set_options
      alter foreign data wrapper postgres_fdw
          options (
                SET debug 'false'
              , ADD use_remote_estimate ''
          );

      -- fdw.comment
      comment on foreign data wrapper postgres_fdw is 'PostgreSQL foreign data wrapper';

      -- fdw.drop_comment
      comment on foreign data wrapper postgres_fdw is null;

      -- fdw.grant
      grant all on foreign data wrapper postgres_fdw to app_user;

      -- fdw.revoke
      revoke all on foreign data wrapper postgres_fdw from app_user;

      -- fdw.revoke_grant_option
      revoke grant option for all on foreign data wrapper postgres_fdw from app_user;

      -- foreign_table.create
      create foreign table public.remote_users (
            id    integer
          , email text
      ) server remote_server options (schema_name 'public', table_name 'users');

      -- foreign_table.drop
      drop foreign table public.remote_users;

      -- foreign_table.alter.change_owner
      alter foreign table public.remote_users
          owner to new_owner;

      -- foreign_table.alter.add_column
      alter foreign table public.remote_users
          add column name text not null default 'unknown';

      -- foreign_table.alter.drop_column
      alter foreign table public.remote_users
          drop column email;

      -- foreign_table.alter.column_type
      alter foreign table public.remote_users
          alter column id type bigint;

      -- foreign_table.alter.column_set_default
      alter foreign table public.remote_users
          alter column email set default 'nobody@example.com';

      -- foreign_table.alter.column_drop_default
      alter foreign table public.remote_users
          alter column email drop default;

      -- foreign_table.alter.column_set_not_null
      alter foreign table public.remote_users
          alter column email set not null;

      -- foreign_table.alter.column_drop_not_null
      alter foreign table public.remote_users
          alter column email drop not null;

      -- foreign_table.alter.set_options
      alter foreign table public.remote_users
          options (SET fetch_size '1000');

      -- foreign_table.comment
      comment on foreign table public.remote_users is 'remote users table';

      -- foreign_table.drop_comment
      comment on foreign table public.remote_users is null;

      -- foreign_table.grant
      grant select on foreign table public.remote_users to app_reader;

      -- foreign_table.revoke
      revoke select on foreign table public.remote_users from app_reader;

      -- foreign_table.revoke_grant_option
      revoke grant option for select on foreign table public.remote_users from app_reader;

      -- server.create
      create server remote_server
          type 'postgresql'
          version '16.0'
          foreign data wrapper postgres_fdw
          options (
                host 'remote.host'
              , port '5432'
              , dbname 'remote_db'
          );

      -- server.drop
      drop server remote_server;

      -- server.alter.change_owner
      alter server remote_server
          owner to new_owner;

      -- server.alter.set_version
      alter server remote_server
          version '17.0';

      -- server.alter.set_options
      alter server remote_server
          options (
                SET host 'new.host'
              , DROP port
          );

      -- server.comment
      comment on server remote_server is 'remote PostgreSQL server';

      -- server.drop_comment
      comment on server remote_server is null;

      -- server.grant
      grant all on server remote_server to app_user;

      -- server.revoke
      revoke all on server remote_server from app_user;

      -- server.revoke_grant_option
      revoke grant option for all on server remote_server from app_user;

      -- user_mapping.create
      create user mapping for app_user server remote_server
          options (user 'remote_app', password 'secret123');

      -- user_mapping.drop
      drop user mapping for app_user server remote_server;

      -- user_mapping.alter.set_options
      alter user mapping for app_user server remote_server options (SET password 'new_secret');"
    `);
  });
});
