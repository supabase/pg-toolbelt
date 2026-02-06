import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  aggregate,
  formatCases,
  pgVersion,
  priv,
  procedure,
  renderChanges,
  rule,
  trigger,
} from "./fixtures.ts";
import { AlterAggregateChangeOwner } from "../../../src/core/objects/aggregate/changes/aggregate.alter.ts";
import { CreateAggregate } from "../../../src/core/objects/aggregate/changes/aggregate.create.ts";
import {
  CreateCommentOnAggregate,
  DropCommentOnAggregate,
} from "../../../src/core/objects/aggregate/changes/aggregate.comment.ts";
import { DropAggregate } from "../../../src/core/objects/aggregate/changes/aggregate.drop.ts";
import {
  GrantAggregatePrivileges,
  RevokeAggregatePrivileges,
  RevokeGrantOptionAggregatePrivileges,
} from "../../../src/core/objects/aggregate/changes/aggregate.privilege.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
} from "../../../src/core/objects/procedure/changes/procedure.alter.ts";
import { CreateProcedure } from "../../../src/core/objects/procedure/changes/procedure.create.ts";
import {
  CreateCommentOnProcedure,
  DropCommentOnProcedure,
} from "../../../src/core/objects/procedure/changes/procedure.comment.ts";
import { DropProcedure } from "../../../src/core/objects/procedure/changes/procedure.drop.ts";
import {
  GrantProcedurePrivileges,
  RevokeProcedurePrivileges,
  RevokeGrantOptionProcedurePrivileges,
} from "../../../src/core/objects/procedure/changes/procedure.privilege.ts";
import { CreateTrigger } from "../../../src/core/objects/trigger/changes/trigger.create.ts";
import {
  CreateCommentOnTrigger,
  DropCommentOnTrigger,
} from "../../../src/core/objects/trigger/changes/trigger.comment.ts";
import { DropTrigger } from "../../../src/core/objects/trigger/changes/trigger.drop.ts";
import { ReplaceTrigger } from "../../../src/core/objects/trigger/changes/trigger.alter.ts";
import { CreateRule } from "../../../src/core/objects/rule/changes/rule.create.ts";
import {
  CreateCommentOnRule,
  DropCommentOnRule,
} from "../../../src/core/objects/rule/changes/rule.comment.ts";
import { DropRule } from "../../../src/core/objects/rule/changes/rule.drop.ts";
import {
  ReplaceRule,
  SetRuleEnabledState,
} from "../../../src/core/objects/rule/changes/rule.alter.ts";

const changes: ChangeCase[] = [
  { label: "aggregate.create", change: new CreateAggregate({ aggregate }) },
  {
    label: "aggregate.alter.owner",
    change: new AlterAggregateChangeOwner({ aggregate, owner: "owner2" }),
  },
  {
    label: "aggregate.comment.create",
    change: new CreateCommentOnAggregate({ aggregate }),
  },
  {
    label: "aggregate.comment.drop",
    change: new DropCommentOnAggregate({ aggregate }),
  },
  {
    label: "aggregate.privilege.grant",
    change: new GrantAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privileges: [priv("EXECUTE")],
      version: pgVersion,
    }),
  },
  {
    label: "aggregate.privilege.revoke",
    change: new RevokeAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privileges: [priv("EXECUTE")],
      version: pgVersion,
    }),
  },
  {
    label: "aggregate.privilege.revoke_grant_option",
    change: new RevokeGrantOptionAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privilegeNames: ["EXECUTE"],
      version: pgVersion,
    }),
  },
  { label: "aggregate.drop", change: new DropAggregate({ aggregate }) },

  { label: "procedure.create (definition)", change: new CreateProcedure({ procedure }) },
  {
    label: "procedure.alter.owner",
    change: new AlterProcedureChangeOwner({ procedure, owner: "owner2" }),
  },
  {
    label: "procedure.alter.security",
    change: new AlterProcedureSetSecurity({ procedure, securityDefiner: true }),
  },
  {
    label: "procedure.alter.config.set",
    change: new AlterProcedureSetConfig({
      procedure,
      action: "set",
      key: "search_path",
      value: "public",
    }),
  },
  {
    label: "procedure.alter.config.reset",
    change: new AlterProcedureSetConfig({
      procedure,
      action: "reset",
      key: "search_path",
    }),
  },
  {
    label: "procedure.alter.config.reset_all",
    change: new AlterProcedureSetConfig({ procedure, action: "reset_all" }),
  },
  {
    label: "procedure.alter.volatility",
    change: new AlterProcedureSetVolatility({ procedure, volatility: "i" }),
  },
  {
    label: "procedure.alter.strictness",
    change: new AlterProcedureSetStrictness({ procedure, isStrict: true }),
  },
  {
    label: "procedure.alter.leakproof",
    change: new AlterProcedureSetLeakproof({ procedure, leakproof: true }),
  },
  {
    label: "procedure.alter.parallel",
    change: new AlterProcedureSetParallel({ procedure, parallelSafety: "s" }),
  },
  {
    label: "procedure.comment.create",
    change: new CreateCommentOnProcedure({ procedure }),
  },
  {
    label: "procedure.comment.drop",
    change: new DropCommentOnProcedure({ procedure }),
  },
  {
    label: "procedure.privilege.grant",
    change: new GrantProcedurePrivileges({
      procedure,
      grantee: "app_user",
      privileges: [priv("EXECUTE")],
      version: pgVersion,
    }),
  },
  {
    label: "procedure.privilege.revoke",
    change: new RevokeProcedurePrivileges({
      procedure,
      grantee: "app_user",
      privileges: [priv("EXECUTE")],
      version: pgVersion,
    }),
  },
  {
    label: "procedure.privilege.revoke_grant_option",
    change: new RevokeGrantOptionProcedurePrivileges({
      procedure,
      grantee: "app_user",
      privilegeNames: ["EXECUTE"],
      version: pgVersion,
    }),
  },
  { label: "procedure.drop", change: new DropProcedure({ procedure }) },

  { label: "trigger.create (definition)", change: new CreateTrigger({ trigger }) },
  { label: "trigger.replace (definition)", change: new ReplaceTrigger({ trigger }) },
  {
    label: "trigger.comment.create",
    change: new CreateCommentOnTrigger({ trigger }),
  },
  { label: "trigger.comment.drop", change: new DropCommentOnTrigger({ trigger }) },
  { label: "trigger.drop", change: new DropTrigger({ trigger }) },

  { label: "rule.create (definition)", change: new CreateRule({ rule }) },
  { label: "rule.replace (definition)", change: new ReplaceRule({ rule }) },
  {
    label: "rule.alter.enabled",
    change: new SetRuleEnabledState({ rule, enabled: "A" }),
  },
  { label: "rule.comment.create", change: new CreateCommentOnRule({ rule }) },
  { label: "rule.comment.drop", change: new DropCommentOnRule({ rule }) },
  { label: "rule.drop", change: new DropRule({ rule }) },
];

describe("format options: procedure + trigger + rule + aggregate", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- aggregate.create
      CREATE AGGREGATE public.agg_sum(integer) (SFUNC = pg_catalog.int4pl, STYPE = integer)

      -- aggregate.alter.owner
      ALTER AGGREGATE public.agg_sum(integer) OWNER TO owner2

      -- aggregate.comment.create
      COMMENT ON AGGREGATE public.agg_sum(integer) IS 'aggregate comment'

      -- aggregate.comment.drop
      COMMENT ON AGGREGATE public.agg_sum(integer) IS NULL

      -- aggregate.privilege.grant
      GRANT ALL ON FUNCTION public.agg_sum(integer) TO app_user

      -- aggregate.privilege.revoke
      REVOKE ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.drop
      DROP AGGREGATE public.agg_sum(integer)

      -- procedure.create (definition)
      CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$

      -- procedure.alter.owner
      ALTER PROCEDURE public.test_procedure OWNER TO owner2

      -- procedure.alter.security
      ALTER PROCEDURE public.test_procedure SECURITY DEFINER

      -- procedure.alter.config.set
      ALTER PROCEDURE public.test_procedure SET search_path TO public

      -- procedure.alter.config.reset
      ALTER PROCEDURE public.test_procedure RESET search_path

      -- procedure.alter.config.reset_all
      ALTER PROCEDURE public.test_procedure RESET ALL

      -- procedure.alter.volatility
      ALTER PROCEDURE public.test_procedure IMMUTABLE

      -- procedure.alter.strictness
      ALTER PROCEDURE public.test_procedure STRICT

      -- procedure.alter.leakproof
      ALTER PROCEDURE public.test_procedure LEAKPROOF

      -- procedure.alter.parallel
      ALTER PROCEDURE public.test_procedure PARALLEL SAFE

      -- procedure.comment.create
      COMMENT ON PROCEDURE public.test_procedure() IS 'procedure comment'

      -- procedure.comment.drop
      COMMENT ON PROCEDURE public.test_procedure() IS NULL

      -- procedure.privilege.grant
      GRANT ALL ON PROCEDURE public.test_procedure() TO app_user

      -- procedure.privilege.revoke
      REVOKE ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.drop
      DROP PROCEDURE public.test_procedure()

      -- trigger.create (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.replace (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.comment.create
      COMMENT ON TRIGGER test_trigger ON public.test_table IS 'trigger comment'

      -- trigger.comment.drop
      COMMENT ON TRIGGER test_trigger ON public.test_table IS NULL

      -- trigger.drop
      DROP TRIGGER test_trigger ON public.test_table

      -- rule.create (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.replace (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.alter.enabled
      ALTER TABLE public.test_table ENABLE ALWAYS RULE test_rule

      -- rule.comment.create
      COMMENT ON RULE test_rule ON public.test_table IS 'rule comment'

      -- rule.comment.drop
      COMMENT ON RULE test_rule ON public.test_table IS NULL

      -- rule.drop
      DROP RULE test_rule ON public.test_table"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- aggregate.create
      CREATE AGGREGATE public.agg_sum(integer) (
        SFUNC = pg_catalog.int4pl,
        STYPE = integer
      )

      -- aggregate.alter.owner
      ALTER AGGREGATE public.agg_sum(integer) OWNER TO owner2

      -- aggregate.comment.create
      COMMENT ON AGGREGATE public.agg_sum(integer) IS 'aggregate comment'

      -- aggregate.comment.drop
      COMMENT ON AGGREGATE public.agg_sum(integer) IS NULL

      -- aggregate.privilege.grant
      GRANT ALL ON FUNCTION public.agg_sum(integer) TO app_user

      -- aggregate.privilege.revoke
      REVOKE ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.drop
      DROP AGGREGATE public.agg_sum(integer)

      -- procedure.create (definition)
      CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$

      -- procedure.alter.owner
      ALTER PROCEDURE public.test_procedure OWNER TO owner2

      -- procedure.alter.security
      ALTER PROCEDURE public.test_procedure SECURITY DEFINER

      -- procedure.alter.config.set
      ALTER PROCEDURE public.test_procedure SET search_path TO public

      -- procedure.alter.config.reset
      ALTER PROCEDURE public.test_procedure RESET search_path

      -- procedure.alter.config.reset_all
      ALTER PROCEDURE public.test_procedure RESET ALL

      -- procedure.alter.volatility
      ALTER PROCEDURE public.test_procedure IMMUTABLE

      -- procedure.alter.strictness
      ALTER PROCEDURE public.test_procedure STRICT

      -- procedure.alter.leakproof
      ALTER PROCEDURE public.test_procedure LEAKPROOF

      -- procedure.alter.parallel
      ALTER PROCEDURE public.test_procedure PARALLEL SAFE

      -- procedure.comment.create
      COMMENT ON PROCEDURE public.test_procedure() IS 'procedure comment'

      -- procedure.comment.drop
      COMMENT ON PROCEDURE public.test_procedure() IS NULL

      -- procedure.privilege.grant
      GRANT ALL ON PROCEDURE public.test_procedure() TO app_user

      -- procedure.privilege.revoke
      REVOKE ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.drop
      DROP PROCEDURE public.test_procedure()

      -- trigger.create (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.replace (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.comment.create
      COMMENT ON TRIGGER test_trigger ON public.test_table IS 'trigger comment'

      -- trigger.comment.drop
      COMMENT ON TRIGGER test_trigger ON public.test_table IS NULL

      -- trigger.drop
      DROP TRIGGER test_trigger ON public.test_table

      -- rule.create (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.replace (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.alter.enabled
      ALTER TABLE public.test_table ENABLE ALWAYS RULE test_rule

      -- rule.comment.create
      COMMENT ON RULE test_rule ON public.test_table IS 'rule comment'

      -- rule.comment.drop
      COMMENT ON RULE test_rule ON public.test_table IS NULL

      -- rule.drop
      DROP RULE test_rule ON public.test_table"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- aggregate.create
      create aggregate public.agg_sum(integer) (
            sfunc = pg_catalog.int4pl
          , stype = integer
      )

      -- aggregate.alter.owner
      alter aggregate public.agg_sum(integer) owner to owner2

      -- aggregate.comment.create
      comment on aggregate public.agg_sum(integer) is 'aggregate comment'

      -- aggregate.comment.drop
      comment on aggregate public.agg_sum(integer) is null

      -- aggregate.privilege.grant
      grant all on function public.agg_sum(integer) to app_user

      -- aggregate.privilege.revoke
      revoke all on function public.agg_sum(integer) from app_user

      -- aggregate.privilege.revoke_grant_option
      revoke grant option for all on function public.agg_sum(integer) from app_user

      -- aggregate.drop
      drop aggregate public.agg_sum(integer)

      -- procedure.create (definition)
      CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$

      -- procedure.alter.owner
      alter procedure public.test_procedure owner to owner2

      -- procedure.alter.security
      alter procedure public.test_procedure security definer

      -- procedure.alter.config.set
      alter procedure public.test_procedure set search_path to public

      -- procedure.alter.config.reset
      alter procedure public.test_procedure reset search_path

      -- procedure.alter.config.reset_all
      alter procedure public.test_procedure reset all

      -- procedure.alter.volatility
      alter procedure public.test_procedure immutable

      -- procedure.alter.strictness
      alter procedure public.test_procedure strict

      -- procedure.alter.leakproof
      alter procedure public.test_procedure leakproof

      -- procedure.alter.parallel
      alter procedure public.test_procedure parallel safe

      -- procedure.comment.create
      comment on procedure public.test_procedure() is 'procedure comment'

      -- procedure.comment.drop
      comment on procedure public.test_procedure() is null

      -- procedure.privilege.grant
      grant all on procedure public.test_procedure() to app_user

      -- procedure.privilege.revoke
      revoke all on procedure public.test_procedure() from app_user

      -- procedure.privilege.revoke_grant_option
      revoke grant option for all on procedure public.test_procedure() from app_user

      -- procedure.drop
      drop procedure public.test_procedure()

      -- trigger.create (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.replace (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.comment.create
      comment on trigger test_trigger on public.test_table is 'trigger comment'

      -- trigger.comment.drop
      comment on trigger test_trigger on public.test_table is null

      -- trigger.drop
      drop trigger test_trigger on public.test_table

      -- rule.create (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.replace (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.alter.enabled
      alter table public.test_table enable always rule test_rule

      -- rule.comment.create
      comment on rule test_rule on public.test_table is 'rule comment'

      -- rule.comment.drop
      comment on rule test_rule on public.test_table is null

      -- rule.drop
      drop rule test_rule on public.test_table"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- aggregate.create
      CREATE AGGREGATE public.agg_sum(integer)
        (
        SFUNC = pg_catalog.int4pl,
        STYPE = integer
      )

      -- aggregate.alter.owner
      ALTER AGGREGATE public.agg_sum(integer)
        OWNER TO owner2

      -- aggregate.comment.create
      COMMENT ON AGGREGATE
        public.agg_sum(integer) IS 'aggregate
        comment'

      -- aggregate.comment.drop
      COMMENT ON AGGREGATE
        public.agg_sum(integer) IS NULL

      -- aggregate.privilege.grant
      GRANT ALL ON FUNCTION
        public.agg_sum(integer) TO app_user

      -- aggregate.privilege.revoke
      REVOKE ALL ON FUNCTION
        public.agg_sum(integer) FROM app_user

      -- aggregate.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION
        public.agg_sum(integer) FROM app_user

      -- aggregate.drop
      DROP AGGREGATE public.agg_sum(integer)

      -- procedure.create (definition)
      CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$

      -- procedure.alter.owner
      ALTER PROCEDURE public.test_procedure
        OWNER TO owner2

      -- procedure.alter.security
      ALTER PROCEDURE public.test_procedure
        SECURITY DEFINER

      -- procedure.alter.config.set
      ALTER PROCEDURE public.test_procedure
        SET search_path TO public

      -- procedure.alter.config.reset
      ALTER PROCEDURE public.test_procedure
        RESET search_path

      -- procedure.alter.config.reset_all
      ALTER PROCEDURE public.test_procedure
        RESET ALL

      -- procedure.alter.volatility
      ALTER PROCEDURE public.test_procedure
        IMMUTABLE

      -- procedure.alter.strictness
      ALTER PROCEDURE public.test_procedure
        STRICT

      -- procedure.alter.leakproof
      ALTER PROCEDURE public.test_procedure
        LEAKPROOF

      -- procedure.alter.parallel
      ALTER PROCEDURE public.test_procedure
        PARALLEL SAFE

      -- procedure.comment.create
      COMMENT ON PROCEDURE
        public.test_procedure() IS 'procedure
        comment'

      -- procedure.comment.drop
      COMMENT ON PROCEDURE
        public.test_procedure() IS NULL

      -- procedure.privilege.grant
      GRANT ALL ON PROCEDURE
        public.test_procedure() TO app_user

      -- procedure.privilege.revoke
      REVOKE ALL ON PROCEDURE
        public.test_procedure() FROM app_user

      -- procedure.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON PROCEDURE
        public.test_procedure() FROM app_user

      -- procedure.drop
      DROP PROCEDURE public.test_procedure()

      -- trigger.create (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.replace (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.comment.create
      COMMENT ON TRIGGER test_trigger ON
        public.test_table IS 'trigger comment'

      -- trigger.comment.drop
      COMMENT ON TRIGGER test_trigger ON
        public.test_table IS NULL

      -- trigger.drop
      DROP TRIGGER test_trigger ON
        public.test_table

      -- rule.create (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.replace (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.alter.enabled
      ALTER TABLE public.test_table ENABLE
        ALWAYS RULE test_rule

      -- rule.comment.create
      COMMENT ON RULE test_rule ON
        public.test_table IS 'rule comment'

      -- rule.comment.drop
      COMMENT ON RULE test_rule ON
        public.test_table IS NULL

      -- rule.drop
      DROP RULE test_rule ON public.test_table"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- aggregate.create
      CREATE AGGREGATE public.agg_sum(integer) (
         SFUNC = pg_catalog.int4pl,
         STYPE = integer
      )

      -- aggregate.alter.owner
      ALTER AGGREGATE public.agg_sum(integer) OWNER TO owner2

      -- aggregate.comment.create
      COMMENT ON AGGREGATE public.agg_sum(integer) IS 'aggregate comment'

      -- aggregate.comment.drop
      COMMENT ON AGGREGATE public.agg_sum(integer) IS NULL

      -- aggregate.privilege.grant
      GRANT ALL ON FUNCTION public.agg_sum(integer) TO app_user

      -- aggregate.privilege.revoke
      REVOKE ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FUNCTION public.agg_sum(integer) FROM app_user

      -- aggregate.drop
      DROP AGGREGATE public.agg_sum(integer)

      -- procedure.create (definition)
      CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$

      -- procedure.alter.owner
      ALTER PROCEDURE public.test_procedure OWNER TO owner2

      -- procedure.alter.security
      ALTER PROCEDURE public.test_procedure SECURITY DEFINER

      -- procedure.alter.config.set
      ALTER PROCEDURE public.test_procedure SET search_path TO public

      -- procedure.alter.config.reset
      ALTER PROCEDURE public.test_procedure RESET search_path

      -- procedure.alter.config.reset_all
      ALTER PROCEDURE public.test_procedure RESET ALL

      -- procedure.alter.volatility
      ALTER PROCEDURE public.test_procedure IMMUTABLE

      -- procedure.alter.strictness
      ALTER PROCEDURE public.test_procedure STRICT

      -- procedure.alter.leakproof
      ALTER PROCEDURE public.test_procedure LEAKPROOF

      -- procedure.alter.parallel
      ALTER PROCEDURE public.test_procedure PARALLEL SAFE

      -- procedure.comment.create
      COMMENT ON PROCEDURE public.test_procedure() IS 'procedure comment'

      -- procedure.comment.drop
      COMMENT ON PROCEDURE public.test_procedure() IS NULL

      -- procedure.privilege.grant
      GRANT ALL ON PROCEDURE public.test_procedure() TO app_user

      -- procedure.privilege.revoke
      REVOKE ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON PROCEDURE public.test_procedure() FROM app_user

      -- procedure.drop
      DROP PROCEDURE public.test_procedure()

      -- trigger.create (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.replace (definition)
      CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()

      -- trigger.comment.create
      COMMENT ON TRIGGER test_trigger ON public.test_table IS 'trigger comment'

      -- trigger.comment.drop
      COMMENT ON TRIGGER test_trigger ON public.test_table IS NULL

      -- trigger.drop
      DROP TRIGGER test_trigger ON public.test_table

      -- rule.create (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.replace (definition)
      CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING

      -- rule.alter.enabled
      ALTER TABLE public.test_table ENABLE ALWAYS RULE test_rule

      -- rule.comment.create
      COMMENT ON RULE test_rule ON public.test_table IS 'rule comment'

      -- rule.comment.drop
      COMMENT ON RULE test_rule ON public.test_table IS NULL

      -- rule.drop
      DROP RULE test_rule ON public.test_table"
    `);
  });
});
