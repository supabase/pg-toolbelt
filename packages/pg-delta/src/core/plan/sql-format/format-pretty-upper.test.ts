import { describe, expect, test } from "bun:test";
import { renderScript } from "./fixtures.ts";

describe("sql formatting snapshots", () => {
  test("format-pretty-upper", () => {
    const output = [
      "-- format: { keywordCase: 'upper' }",
      renderScript({ keywordCase: "upper" }),
    ]
      .filter(Boolean)
      .join("\n");
    expect(output).toMatchInlineSnapshot(`
      "-- format: { keywordCase: 'upper' }
      -- schema.create
      CREATE SCHEMA application_schema_with_very_long_name_for_wrapping_tests AUTHORIZATION admin;

      -- schema.drop
      DROP SCHEMA application_schema_with_very_long_name_for_wrapping_tests;

      -- schema.alter.change_owner
      ALTER SCHEMA application_schema_with_very_long_name_for_wrapping_tests OWNER TO new_admin;

      -- schema.comment
      COMMENT ON SCHEMA application_schema_with_very_long_name_for_wrapping_tests IS
        'application schema';

      -- schema.drop_comment
      COMMENT ON SCHEMA application_schema_with_very_long_name_for_wrapping_tests IS NULL;

      -- schema.grant
      GRANT ALL ON SCHEMA application_schema_with_very_long_name_for_wrapping_tests TO app_user
        WITH GRANT OPTION;

      -- schema.revoke
      REVOKE CREATE ON SCHEMA application_schema_with_very_long_name_for_wrapping_tests FROM app_user;

      -- schema.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE
        ON SCHEMA application_schema_with_very_long_name_for_wrapping_tests FROM app_user;

      -- extension.create
      CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

      -- extension.drop
      DROP EXTENSION pgcrypto;

      -- extension.alter.update_version
      ALTER EXTENSION pgcrypto UPDATE TO '1.4';

      -- extension.alter.set_schema
      ALTER EXTENSION pgcrypto SET SCHEMA public;

      -- extension.comment
      COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

      -- extension.drop_comment
      COMMENT ON EXTENSION pgcrypto IS NULL;

      -- domain.create
      CREATE DOMAIN public.test_domain_all AS custom.text[][]
        COLLATE mycoll
        DEFAULT 'hello'
        NOT NULL
        CHECK (VALUE <> '');

      -- domain.drop
      DROP DOMAIN public.test_domain_all;

      -- domain.alter.set_default
      ALTER DOMAIN public.test_domain_all
        SET DEFAULT 'world';

      -- domain.alter.drop_default
      ALTER DOMAIN public.test_domain_all
        DROP DEFAULT;

      -- domain.alter.set_not_null
      ALTER DOMAIN public.test_domain_all
        SET NOT NULL;

      -- domain.alter.drop_not_null
      ALTER DOMAIN public.test_domain_all
        DROP NOT NULL;

      -- domain.alter.change_owner
      ALTER DOMAIN public.test_domain_all
        OWNER TO new_owner;

      -- domain.alter.add_constraint
      ALTER DOMAIN public.test_domain_all
        ADD CONSTRAINT domain_len_chk CHECK (char_length(VALUE) <= 255) NOT VALID;

      -- domain.alter.drop_constraint
      ALTER DOMAIN public.test_domain_all
        DROP CONSTRAINT domain_chk;

      -- domain.alter.validate_constraint
      ALTER DOMAIN public.test_domain_all
        VALIDATE CONSTRAINT domain_len_chk;

      -- domain.comment
      COMMENT ON DOMAIN public.test_domain_all IS 'domain comment';

      -- domain.drop_comment
      COMMENT ON DOMAIN public.test_domain_all IS NULL;

      -- domain.grant
      GRANT ALL ON DOMAIN public.test_domain_all TO app_user;

      -- domain.revoke
      REVOKE ALL ON DOMAIN public.test_domain_all FROM app_user;

      -- domain.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON DOMAIN public.test_domain_all FROM app_user;

      -- type.enum.create
      CREATE TYPE public.test_enum AS ENUM (
        'value1',
        'value2',
        'value3'
      );

      -- type.enum.drop
      DROP TYPE public.test_enum;

      -- type.enum.alter.change_owner
      ALTER TYPE public.test_enum OWNER TO new_owner;

      -- type.enum.alter.add_value
      ALTER TYPE public.test_enum ADD VALUE 'value4' AFTER 'value2';

      -- type.enum.comment
      COMMENT ON TYPE public.test_enum IS 'enum comment';

      -- type.enum.drop_comment
      COMMENT ON TYPE public.test_enum IS NULL;

      -- type.enum.grant
      GRANT ALL ON TYPE public.test_enum TO app_user;

      -- type.enum.revoke
      REVOKE ALL ON TYPE public.test_enum FROM app_user;

      -- type.enum.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_enum FROM app_user;

      -- type.composite.create
      CREATE TYPE public.test_type AS (
        id   integer,
        name text    COLLATE "en_US"
      );

      -- type.composite.drop
      DROP TYPE public.test_type;

      -- type.composite.alter.change_owner
      ALTER TYPE public.test_type OWNER TO new_owner;

      -- type.composite.alter.add_attribute
      ALTER TYPE public.test_type ADD ATTRIBUTE age integer;

      -- type.composite.alter.drop_attribute
      ALTER TYPE public.test_type DROP ATTRIBUTE name;

      -- type.composite.alter.alter_attr_type
      ALTER TYPE public.test_type ALTER ATTRIBUTE name TYPE varchar(255) COLLATE "C";

      -- type.composite.comment
      COMMENT ON TYPE public.test_type IS 'composite comment';

      -- type.composite.drop_comment
      COMMENT ON TYPE public.test_type IS NULL;

      -- type.composite.attr_comment
      COMMENT ON COLUMN public.test_type.id IS 'attr comment';

      -- type.composite.drop_attr_comment
      COMMENT ON COLUMN public.test_type.id IS NULL;

      -- type.composite.grant
      GRANT ALL ON TYPE public.test_type TO app_user;

      -- type.composite.revoke
      REVOKE ALL ON TYPE public.test_type FROM app_user;

      -- type.composite.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.test_type FROM app_user;

      -- type.range.create
      CREATE TYPE public.daterange_custom AS RANGE (
        SUBTYPE         = date,
        SUBTYPE_OPCLASS = public.date_ops,
        COLLATION       = "en_US",
        CANONICAL       = public.canon_fn,
        SUBTYPE_DIFF    = public.diff_fn
      );

      -- type.range.drop
      DROP TYPE public.daterange_custom;

      -- type.range.alter.change_owner
      ALTER TYPE public.daterange_custom OWNER TO new_owner;

      -- type.range.comment
      COMMENT ON TYPE public.daterange_custom IS 'range comment';

      -- type.range.drop_comment
      COMMENT ON TYPE public.daterange_custom IS NULL;

      -- type.range.grant
      GRANT ALL ON TYPE public.daterange_custom TO app_user;

      -- type.range.revoke
      REVOKE ALL ON TYPE public.daterange_custom FROM app_user;

      -- type.range.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON TYPE public.daterange_custom FROM app_user;

      -- collation.create
      CREATE COLLATION public.test (
        LOCALE        = 'en_US',
        LC_COLLATE    = 'en_US',
        LC_CTYPE      = 'en_US',
        PROVIDER      = icu,
        DETERMINISTIC = false,
        RULES         = '& A < a <<< à',
        VERSION       = '1.0'
      );

      -- collation.drop
      DROP COLLATION public.test;

      -- collation.alter.change_owner
      ALTER COLLATION public.test OWNER TO new_owner;

      -- collation.alter.refresh_version
      ALTER COLLATION public.test REFRESH VERSION;

      -- collation.comment
      COMMENT ON COLLATION public.test IS 'collation comment';

      -- collation.drop_comment
      COMMENT ON COLLATION public.test IS NULL;

      -- table.create
      CREATE TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test (
        id         bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
        status     text        COLLATE "en_US" DEFAULT 'pending',
        created_at timestamptz DEFAULT now(),
        ref_id     bigint,
        computed   bigint      GENERATED ALWAYS AS (id * 2) STORED
      ) WITH (fillfactor=70, autovacuum_enabled=false);

      -- table.drop
      DROP TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- table.alter.add_column
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ADD COLUMN email text COLLATE "en_US" DEFAULT 'user@example.com' NOT NULL;

      -- table.alter.drop_column
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        DROP COLUMN computed;

      -- table.alter.column_type
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ALTER COLUMN status TYPE character varying(255) COLLATE "C";

      -- table.alter.column_set_default
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ALTER COLUMN status SET DEFAULT 'active';

      -- table.alter.column_drop_default
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ALTER COLUMN status DROP DEFAULT;

      -- table.alter.column_set_not_null
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ALTER COLUMN status SET NOT NULL;

      -- table.alter.column_drop_not_null
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ALTER COLUMN status DROP NOT NULL;

      -- table.alter.add_constraint
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ADD CONSTRAINT uq_t_fmt_status UNIQUE (status);

      -- table.alter.add_fk_constraint
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ADD CONSTRAINT fk_t_fmt_ref FOREIGN KEY (ref_id) REFERENCES public.other_table(id) MATCH FULL
          ON UPDATE SET NULL ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

      -- table.alter.drop_constraint
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        DROP CONSTRAINT uq_t_fmt_status;

      -- table.alter.validate_constraint
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        VALIDATE CONSTRAINT chk_t_fmt_status;

      -- table.alter.change_owner
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        OWNER TO new_owner;

      -- table.alter.set_logged
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        SET LOGGED;

      -- table.alter.set_unlogged
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        SET UNLOGGED;

      -- table.alter.enable_rls
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        ENABLE ROW LEVEL SECURITY;

      -- table.alter.disable_rls
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        DISABLE ROW LEVEL SECURITY;

      -- table.alter.force_rls
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        FORCE ROW LEVEL SECURITY;

      -- table.alter.no_force_rls
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        NO FORCE ROW LEVEL SECURITY;

      -- table.alter.set_storage_params
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        SET (fillfactor=80, autovacuum_enabled=true);

      -- table.alter.reset_storage_params
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        RESET (fillfactor, autovacuum_enabled);

      -- table.alter.replica_identity
      ALTER TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test
        REPLICA IDENTITY FULL;

      -- table.alter.attach_partition
      ALTER TABLE public.events
        ATTACH PARTITION public.events_2024 FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

      -- table.alter.detach_partition
      ALTER TABLE public.events
        DETACH PARTITION public.events_2024;

      -- table.comment
      COMMENT ON TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test IS
        'table comment';

      -- table.drop_comment
      COMMENT ON TABLE public.table_with_very_long_name_for_formatting_and_wrapping_test IS NULL;

      -- table.column_comment
      COMMENT ON COLUMN public.table_with_very_long_name_for_formatting_and_wrapping_test.id IS
        'id column';

      -- table.drop_column_comment
      COMMENT ON COLUMN public.table_with_very_long_name_for_formatting_and_wrapping_test.id IS NULL;

      -- table.constraint_comment
      COMMENT ON CONSTRAINT pk_t_fmt
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS 'primary key';

      -- table.drop_constraint_comment
      COMMENT ON CONSTRAINT chk_t_fmt_status
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS NULL;

      -- table.grant
      GRANT INSERT,
        SELECT ON public.table_with_very_long_name_for_formatting_and_wrapping_test TO app_reader;

      -- table.revoke
      REVOKE DELETE,
        UPDATE ON public.table_with_very_long_name_for_formatting_and_wrapping_test FROM app_reader;

      -- table.revoke_grant_option
      REVOKE GRANT OPTION FOR INSERT,
        SELECT ON public.table_with_very_long_name_for_formatting_and_wrapping_test FROM app_reader;

      -- publication.create
      CREATE PUBLICATION pub_custom FOR TABLE
        public.articles_with_a_very_long_name_very_very_long_name_that_will_go_above_the_wrapping_limit (
        id,
        title
      ) WHERE (published = true),
        TABLE public.comments_a_little_smaller_name_than_the_previous_one, TABLES IN SCHEMA analytics;

      -- publication.drop
      DROP PUBLICATION pub_custom;

      -- publication.alter.set_options
      ALTER PUBLICATION pub_custom
        SET (publish = 'insert, update, delete, truncate', publish_via_partition_root = false);

      -- publication.alter.set_all_tables
      ALTER PUBLICATION pub_custom SET FOR ALL TABLES;

      -- publication.alter.set_list
      ALTER PUBLICATION pub_custom
        SET TABLE
        public.articles_with_a_very_long_name_very_very_long_name_that_will_go_above_the_wrapping_limit
        (id, title) WHERE (published = true),
        TABLE public.comments_a_little_smaller_name_than_the_previous_one, TABLES IN SCHEMA analytics;

      -- publication.alter.add_tables
      ALTER PUBLICATION pub_custom
        ADD TABLE public.new_table_with_very_long_name_for_formatting_and_wrapping_test;

      -- publication.alter.drop_tables
      ALTER PUBLICATION pub_custom DROP TABLE public.comments_a_little_smaller_name_than_the_previous_one;

      -- publication.alter.add_schemas
      ALTER PUBLICATION pub_custom ADD TABLES IN SCHEMA staging;

      -- publication.alter.drop_schemas
      ALTER PUBLICATION pub_custom DROP TABLES IN SCHEMA analytics;

      -- publication.alter.set_owner
      ALTER PUBLICATION pub_custom OWNER TO new_owner;

      -- publication.comment
      COMMENT ON PUBLICATION pub_custom IS 'publication comment';

      -- publication.drop_comment
      COMMENT ON PUBLICATION pub_custom IS NULL;

      -- view.create
      CREATE VIEW public.test_view WITH (security_barrier=true, check_option=local) AS SELECT *
      FROM test_table;

      -- view.drop
      DROP VIEW public.test_view;

      -- view.alter.change_owner
      ALTER VIEW public.test_view OWNER TO new_owner;

      -- view.alter.set_options
      ALTER VIEW public.test_view SET (security_barrier=true, check_option=cascaded);

      -- view.alter.reset_options
      ALTER VIEW public.test_view RESET (security_barrier);

      -- view.comment
      COMMENT ON VIEW public.test_view IS 'view comment';

      -- view.drop_comment
      COMMENT ON VIEW public.test_view IS NULL;

      -- view.grant
      GRANT SELECT ON public.test_view TO app_reader WITH GRANT OPTION;

      -- view.revoke
      REVOKE SELECT ON public.test_view FROM app_reader;

      -- view.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON public.test_view FROM app_reader;

      -- rule.create
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;

      -- rule.drop
      DROP RULE test_rule ON public.test_table;

      -- rule.replace
      CREATE OR REPLACE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING;

      -- rule.alter.set_enabled
      ALTER TABLE public.test_table
        DISABLE RULE test_rule;

      -- rule.comment
      COMMENT ON RULE test_rule ON public.test_table IS 'rule comment';

      -- rule.drop_comment
      COMMENT ON RULE test_rule ON public.test_table IS NULL;

      -- procedure.create
      CREATE PROCEDURE public.test_procedure()
        LANGUAGE plpgsql
        AS $$ begin null; end; $$;

      -- procedure.drop
      DROP PROCEDURE public.test_procedure();

      -- function.create
      CREATE FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name (
        "p_schema_name_for_analytics" text,
        "p_table_name_for_metrics"    text,
        "p_limit_count_default"       integer DEFAULT 100
      )
        RETURNS TABLE (
          total   bigint,
          average numeric
        )
        LANGUAGE plpgsql
        STABLE
        SECURITY DEFINER
        PARALLEL SAFE
        COST 100
        ROWS 10
        STRICT
        SET search_path TO 'pg_catalog', 'public'
        AS $function$ BEGIN RETURN QUERY SELECT count(*)::bigint, avg(value)::numeric FROM generate_series(1, p_limit_count_default); END; $function$;

      -- function.drop
      DROP FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(IN
        "p_schema_name_for_analytics" text,
        IN "p_table_name_for_metrics" text, IN "p_limit_count_default" integer);

      -- function.alter.change_owner
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name OWNER TO
        new_admin;

      -- function.alter.set_security
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name SECURITY INVOKER;

      -- function.alter.set_config
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name
        SET work_mem TO '256MB';

      -- function.alter.set_volatility
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name IMMUTABLE;

      -- function.alter.set_strictness
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name CALLED
        ON NULL INPUT;

      -- function.alter.set_leakproof
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name LEAKPROOF;

      -- function.alter.set_parallel
      ALTER FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name PARALLEL
        RESTRICTED;

      -- function.comment
      COMMENT ON FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(text,text,integer) IS
        'Calculate metrics for a given table';

      -- function.drop_comment
      COMMENT ON FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(text,text,integer) IS NULL;

      -- function.grant
      GRANT ALL ON FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) TO
        app_user WITH GRANT OPTION;

      -- function.revoke
      REVOKE ALL ON FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) FROM
        app_user;

      -- function.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION
        public.calculate_metrics_for_analytics_dashboard_with_extended_name(text, text, integer) FROM
        app_user;

      -- sequence.create
      CREATE SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq;

      -- sequence.drop
      DROP SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq;

      -- sequence.alter.set_owned_by
      ALTER SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq OWNED BY
        public.table_with_very_long_name_for_formatting_and_wrapping_test.id;

      -- sequence.alter.set_options
      ALTER SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq INCREMENT BY
        10 MINVALUE 1 MAXVALUE 1000000 CACHE 5 CYCLE;

      -- sequence.comment
      COMMENT ON SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq IS
        'sequence for table_with_very_long_name_for_formatting_and_wrapping_test.id';

      -- sequence.drop_comment
      COMMENT ON SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq IS NULL;

      -- sequence.grant
      GRANT SELECT,
        USAGE
        ON SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq TO app_user;

      -- sequence.revoke
      REVOKE USAGE
        ON SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq FROM app_user;

      -- sequence.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE
        ON SEQUENCE public.table_with_very_long_name_for_formatting_and_wrapping_test_id_seq FROM app_user;

      -- policy.create
      CREATE POLICY allow_select_own ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        FOR SELECT
        TO authenticated
        USING (auth.uid() = user_id);

      -- policy.create_restrictive
      CREATE POLICY restrict_delete ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        AS RESTRICTIVE
        FOR DELETE
        TO authenticated, service_role
        USING (auth.uid() = owner_id)
        WITH CHECK (status <> 'locked');

      -- policy.drop
      DROP POLICY allow_select_own ON public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- policy.alter.set_roles
      ALTER POLICY public.allow_select_own
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test TO authenticated, anon;

      -- policy.alter.set_using
      ALTER POLICY public.allow_select_own
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        USING (auth.uid() = user_id AND status = 'active');

      -- policy.alter.set_with_check
      ALTER POLICY public.allow_select_own
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test WITH
        CHECK (auth.uid() = user_id);

      -- policy.comment
      COMMENT ON POLICY allow_select_own
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS 'rls policy comment';

      -- policy.drop_comment
      COMMENT ON POLICY allow_select_own
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS NULL;

      -- index.create
      CREATE UNIQUE INDEX idx_t_fmt_status
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test (status)
        WITH (fillfactor='90')
        WHERE (status <> 'archived'::text);

      -- index.create_gin
      CREATE INDEX idx_t_fmt_search ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        USING gin (to_tsvector('english'::regconfig, status));

      -- index.drop
      DROP INDEX public.idx_t_fmt_status;

      -- index.alter.set_storage_params
      ALTER INDEX public.idx_t_fmt_status RESET (deduplicate_items);

      ALTER INDEX public.idx_t_fmt_status SET (fillfactor=80);

      -- index.alter.set_statistics
      ALTER INDEX public.idx_t_fmt_status ALTER COLUMN 1 SET STATISTICS 500;

      -- index.comment
      COMMENT ON INDEX public.idx_t_fmt_status IS 'index comment';

      -- index.drop_comment
      COMMENT ON INDEX public.idx_t_fmt_status IS NULL;

      -- trigger.create
      CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH ROW WHEN (
        (NEW.status IS DISTINCT FROM OLD.status)
      ) EXECUTE FUNCTION public.audit_trigger_fn('arg1', 'arg2');

      -- trigger.drop
      DROP TRIGGER trg_audit ON public.table_with_very_long_name_for_formatting_and_wrapping_test;

      -- trigger.replace
      CREATE OR REPLACE TRIGGER trg_audit AFTER INSERT OR UPDATE
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test
        REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH ROW WHEN (
        (NEW.status IS DISTINCT FROM OLD.status)
      ) EXECUTE FUNCTION public.audit_trigger_fn('arg1', 'arg2');

      -- trigger.comment
      COMMENT ON TRIGGER trg_audit
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS 'trigger comment';

      -- trigger.drop_comment
      COMMENT ON TRIGGER trg_audit
        ON public.table_with_very_long_name_for_formatting_and_wrapping_test IS NULL;

      -- matview.create
      CREATE MATERIALIZED VIEW analytics.daily_stats
        WITH (fillfactor=70)
        AS SELECT date_trunc('day', created_at) AS day, count(*) AS total
      FROM public.events
      GROUP BY 1 WITH DATA;

      -- matview.drop
      DROP MATERIALIZED VIEW analytics.daily_stats;

      -- matview.alter.change_owner
      ALTER MATERIALIZED VIEW analytics.daily_stats
        OWNER TO new_owner;

      -- matview.alter.set_storage
      ALTER MATERIALIZED VIEW analytics.daily_stats
        RESET (autovacuum_enabled);

      ALTER MATERIALIZED VIEW analytics.daily_stats
        SET (fillfactor=80);

      -- matview.comment
      COMMENT ON MATERIALIZED VIEW analytics.daily_stats IS 'daily aggregation';

      -- matview.drop_comment
      COMMENT ON MATERIALIZED VIEW analytics.daily_stats IS NULL;

      -- matview.column_comment
      COMMENT ON COLUMN analytics.daily_stats.day IS 'day bucket';

      -- matview.drop_column_comment
      COMMENT ON COLUMN analytics.daily_stats.day IS NULL;

      -- matview.grant
      GRANT SELECT ON analytics.daily_stats TO app_reader;

      -- matview.revoke
      REVOKE SELECT ON analytics.daily_stats FROM app_reader;

      -- matview.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON analytics.daily_stats FROM app_reader;

      -- aggregate.create
      CREATE AGGREGATE public.array_cat_agg(anycompatiblearray) (
        SFUNC       = array_cat,
        STYPE       = anycompatiblearray,
        COMBINEFUNC = array_cat,
        INITCOND    = '{}',
        PARALLEL SAFE,
        STRICT
      );

      -- aggregate.drop
      DROP AGGREGATE public.array_cat_agg(anycompatiblearray);

      -- aggregate.alter.change_owner
      ALTER AGGREGATE public.array_cat_agg(anycompatiblearray) OWNER TO new_owner;

      -- aggregate.comment
      COMMENT ON AGGREGATE public.array_cat_agg(anycompatiblearray) IS 'concatenate arrays aggregate';

      -- aggregate.drop_comment
      COMMENT ON AGGREGATE public.array_cat_agg(anycompatiblearray) IS NULL;

      -- aggregate.grant
      GRANT ALL ON FUNCTION public.array_cat_agg(anycompatiblearray) TO app_user;

      -- aggregate.revoke
      REVOKE ALL ON FUNCTION public.array_cat_agg(anycompatiblearray) FROM app_user;

      -- aggregate.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION public.array_cat_agg(anycompatiblearray) FROM app_user;

      -- event_trigger.create
      CREATE EVENT TRIGGER prevent_drop
        ON sql_drop
        WHEN TAG IN ('DROP TABLE', 'DROP SCHEMA')
        EXECUTE FUNCTION public.prevent_drop_fn();

      -- event_trigger.drop
      DROP EVENT TRIGGER prevent_drop;

      -- event_trigger.alter.change_owner
      ALTER EVENT TRIGGER prevent_drop
        OWNER TO new_owner;

      -- event_trigger.alter.set_enabled
      ALTER EVENT TRIGGER prevent_drop
        DISABLE;

      -- event_trigger.comment
      COMMENT ON EVENT TRIGGER prevent_drop IS 'prevent accidental drops';

      -- event_trigger.drop_comment
      COMMENT ON EVENT TRIGGER prevent_drop IS NULL;

      -- language.create
      CREATE TRUSTED LANGUAGE plv8
        HANDLER plv8_call_handler
        INLINE plv8_inline_handler
        VALIDATOR plv8_call_validator;

      -- language.drop
      DROP LANGUAGE plv8;

      -- language.alter.change_owner
      ALTER LANGUAGE plv8 OWNER TO new_owner;

      -- language.comment
      COMMENT ON LANGUAGE plv8 IS 'PL/V8 trusted procedural language';

      -- language.drop_comment
      COMMENT ON LANGUAGE plv8 IS NULL;

      -- language.grant
      GRANT ALL ON LANGUAGE plv8 TO app_user WITH GRANT OPTION;

      -- language.revoke
      REVOKE ALL ON LANGUAGE plv8 FROM app_user;

      -- language.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON LANGUAGE plv8 FROM app_user;

      -- role.create
      CREATE ROLE app_user WITH LOGIN CONNECTION LIMIT 100;

      -- role.drop
      DROP ROLE app_user;

      -- role.alter.set_options
      ALTER ROLE app_user WITH NOSUPERUSER CREATEDB;

      -- role.alter.set_config
      ALTER ROLE app_user SET statement_timeout TO '60000';

      -- role.comment
      COMMENT ON ROLE app_user IS 'application user role';

      -- role.drop_comment
      COMMENT ON ROLE app_user IS NULL;

      -- role.grant_membership
      GRANT app_user TO dev_user WITH ADMIN OPTION;

      -- role.revoke_membership
      REVOKE app_user FROM dev_user;

      -- role.revoke_membership_options
      REVOKE ADMIN OPTION FOR app_user FROM dev_user;

      -- role.grant_default_privileges
      ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public GRANT SELECT ON TABLES TO app_reader;

      -- role.revoke_default_privileges
      ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public REVOKE SELECT ON TABLES FROM app_reader;

      -- subscription.create
      CREATE SUBSCRIPTION sub_replica
        CONNECTION 'host=primary.db port=5432 dbname=mydb'
        PUBLICATION pub_custom
        WITH (
          slot_name          = 'sub_replica_slot',
          binary             = true,
          streaming          = 'parallel',
          synchronous_commit = 'remote_apply',
          disable_on_error   = true,
          failover           = true
        );

      -- subscription.drop
      DROP SUBSCRIPTION sub_replica;

      -- subscription.alter.set_connection
      ALTER SUBSCRIPTION sub_replica
        CONNECTION 'host=primary.db port=5432 dbname=mydb';

      -- subscription.alter.set_publication
      ALTER SUBSCRIPTION sub_replica
        SET PUBLICATION pub_custom;

      -- subscription.alter.enable
      ALTER SUBSCRIPTION sub_replica
        ENABLE;

      -- subscription.alter.disable
      ALTER SUBSCRIPTION sub_replica
        DISABLE;

      -- subscription.alter.set_options
      ALTER SUBSCRIPTION sub_replica
        SET (
          binary             = true,
          streaming          = 'parallel',
          synchronous_commit = 'remote_apply'
        );

      -- subscription.alter.set_owner
      ALTER SUBSCRIPTION sub_replica
        OWNER TO new_owner;

      -- subscription.comment
      COMMENT ON SUBSCRIPTION sub_replica IS 'replication subscription';

      -- subscription.drop_comment
      COMMENT ON SUBSCRIPTION sub_replica IS NULL;

      -- fdw.create
      CREATE FOREIGN DATA WRAPPER postgres_fdw
        HANDLER postgres_fdw_handler
        VALIDATOR postgres_fdw_validator
        OPTIONS (debug 'true');

      -- fdw.drop
      DROP FOREIGN DATA WRAPPER postgres_fdw;

      -- fdw.alter.change_owner
      ALTER FOREIGN DATA WRAPPER postgres_fdw
        OWNER TO new_owner;

      -- fdw.alter.set_options
      ALTER FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (
          SET debug 'false',
          ADD use_remote_estimate ''
        );

      -- fdw.comment
      COMMENT ON FOREIGN DATA WRAPPER postgres_fdw IS 'PostgreSQL foreign data wrapper';

      -- fdw.drop_comment
      COMMENT ON FOREIGN DATA WRAPPER postgres_fdw IS NULL;

      -- fdw.grant
      GRANT ALL ON FOREIGN DATA WRAPPER postgres_fdw TO app_user;

      -- fdw.revoke
      REVOKE ALL ON FOREIGN DATA WRAPPER postgres_fdw FROM app_user;

      -- fdw.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FOREIGN DATA WRAPPER postgres_fdw FROM app_user;

      -- foreign_table.create
      CREATE FOREIGN TABLE public.remote_users (
        id    integer,
        email text
      ) SERVER remote_server OPTIONS (schema_name 'public', table_name 'users');

      -- foreign_table.drop
      DROP FOREIGN TABLE public.remote_users;

      -- foreign_table.alter.change_owner
      ALTER FOREIGN TABLE public.remote_users
        OWNER TO new_owner;

      -- foreign_table.alter.add_column
      ALTER FOREIGN TABLE public.remote_users
        ADD COLUMN name text NOT NULL DEFAULT 'unknown';

      -- foreign_table.alter.drop_column
      ALTER FOREIGN TABLE public.remote_users
        DROP COLUMN email;

      -- foreign_table.alter.column_type
      ALTER FOREIGN TABLE public.remote_users
        ALTER COLUMN id TYPE bigint;

      -- foreign_table.alter.column_set_default
      ALTER FOREIGN TABLE public.remote_users
        ALTER COLUMN email SET DEFAULT 'nobody@example.com';

      -- foreign_table.alter.column_drop_default
      ALTER FOREIGN TABLE public.remote_users
        ALTER COLUMN email DROP DEFAULT;

      -- foreign_table.alter.column_set_not_null
      ALTER FOREIGN TABLE public.remote_users
        ALTER COLUMN email SET NOT NULL;

      -- foreign_table.alter.column_drop_not_null
      ALTER FOREIGN TABLE public.remote_users
        ALTER COLUMN email DROP NOT NULL;

      -- foreign_table.alter.set_options
      ALTER FOREIGN TABLE public.remote_users
        OPTIONS (SET fetch_size '1000');

      -- foreign_table.comment
      COMMENT ON FOREIGN TABLE public.remote_users IS 'remote users table';

      -- foreign_table.drop_comment
      COMMENT ON FOREIGN TABLE public.remote_users IS NULL;

      -- foreign_table.grant
      GRANT SELECT ON FOREIGN TABLE public.remote_users TO app_reader;

      -- foreign_table.revoke
      REVOKE SELECT ON FOREIGN TABLE public.remote_users FROM app_reader;

      -- foreign_table.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON FOREIGN TABLE public.remote_users FROM app_reader;

      -- server.create
      CREATE SERVER remote_server
        TYPE 'postgresql'
        VERSION '16.0'
        FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (
          host 'remote.host',
          port '5432',
          dbname 'remote_db'
        );

      -- server.drop
      DROP SERVER remote_server;

      -- server.alter.change_owner
      ALTER SERVER remote_server
        OWNER TO new_owner;

      -- server.alter.set_version
      ALTER SERVER remote_server
        VERSION '17.0';

      -- server.alter.set_options
      ALTER SERVER remote_server
        OPTIONS (
          SET host 'new.host',
          DROP port
        );

      -- server.comment
      COMMENT ON SERVER remote_server IS 'remote PostgreSQL server';

      -- server.drop_comment
      COMMENT ON SERVER remote_server IS NULL;

      -- server.grant
      GRANT ALL ON SERVER remote_server TO app_user;

      -- server.revoke
      REVOKE ALL ON SERVER remote_server FROM app_user;

      -- server.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON SERVER remote_server FROM app_user;

      -- user_mapping.create
      CREATE USER MAPPING FOR app_user SERVER remote_server
        OPTIONS (user 'remote_app', password 'secret123');

      -- user_mapping.drop
      DROP USER MAPPING FOR app_user SERVER remote_server;

      -- user_mapping.alter.set_options
      ALTER USER MAPPING FOR app_user SERVER remote_server OPTIONS (SET password 'new_secret');"
    `);
  });
});
