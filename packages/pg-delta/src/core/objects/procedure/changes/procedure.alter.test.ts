import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Procedure, type ProcedureProps } from "../procedure.model.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
} from "./procedure.alter.ts";

describe.concurrent("procedure", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: Omit<ProcedureProps, "owner"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterProcedureChangeOwner({
        procedure,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() OWNER TO new_owner",
      );
    });

    test("change owner (function)", async () => {
      const props: Omit<ProcedureProps, "owner"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql AS $$SELECT 1$$",
        config: null,
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterProcedureChangeOwner({
        procedure,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() OWNER TO new_owner",
      );
    });

    test("change owner with argument types (overloaded function)", async () => {
      const procedure = new Procedure({
        schema: "public",
        name: "my_func",
        kind: "f",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 2,
        argument_default_count: 0,
        argument_names: ["a", "b"],
        argument_types: ["integer", "text"],
        all_argument_types: ["integer", "text"],
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: null,
        definition: "CREATE FUNCTION public.my_func(integer, text) ...",
        config: null,
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
        owner: "old_owner",
      });
      const change = new AlterProcedureChangeOwner({
        procedure,
        owner: "postgres",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.my_func(integer, text) OWNER TO postgres",
      );
    });

    test("set security definer", async () => {
      const props: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...props, security_definer: false });
      const change = new AlterProcedureSetSecurity({
        procedure,
        securityDefiner: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() SECURITY DEFINER",
      );
    });

    test("unset security definer (invoker)", async () => {
      const props: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...props, security_definer: true });
      const change = new AlterProcedureSetSecurity({
        procedure,
        securityDefiner: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() SECURITY INVOKER",
      );
    });

    test("set and reset config", async () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql AS $$SELECT 1$$",
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({
        ...base,
        config: ["search_path=public"],
      });
      const change1 = new AlterProcedureSetConfig({
        procedure,
        action: "reset",
        key: "search_path",
      });
      const change2 = new AlterProcedureSetConfig({
        procedure,
        action: "set",
        key: "search_path",
        value: "pg_temp",
      });
      const change3 = new AlterProcedureSetConfig({
        procedure,
        action: "set",
        key: "work_mem",
        value: "64MB",
      });
      await assertValidSql(change1.serialize());
      expect(change1.serialize()).toBe(
        "ALTER FUNCTION public.test_function() RESET search_path",
      );
      await assertValidSql(change2.serialize());
      expect(change2.serialize()).toBe(
        "ALTER FUNCTION public.test_function() SET search_path TO pg_temp",
      );
      await assertValidSql(change3.serialize());
      expect(change3.serialize()).toBe(
        "ALTER FUNCTION public.test_function() SET work_mem TO '64MB'",
      );
    });

    test("set config from null (function)", async () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql AS $$SELECT 1$$",
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, config: null });
      const change = new AlterProcedureSetConfig({
        procedure,
        action: "set",
        key: "search_path",
        value: "public",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() SET search_path TO public",
      );
    });

    test("set volatility", async () => {
      const base: Omit<ProcedureProps, "volatility"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, volatility: "v" });
      const change = new AlterProcedureSetVolatility({
        procedure,
        volatility: "i",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() IMMUTABLE",
      );
    });

    test("set strictness", async () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, is_strict: false });
      const change = new AlterProcedureSetStrictness({
        procedure,
        isStrict: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() STRICT",
      );
    });

    test("unset strictness (called on null input)", async () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, is_strict: true });
      const change = new AlterProcedureSetStrictness({
        procedure,
        isStrict: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() CALLED ON NULL INPUT",
      );
    });

    test("set leakproof", async () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, leakproof: false });
      const change = new AlterProcedureSetLeakproof({
        procedure,
        leakproof: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() LEAKPROOF",
      );
    });

    test("unset leakproof", async () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, leakproof: true });
      const change = new AlterProcedureSetLeakproof({
        procedure,
        leakproof: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() NOT LEAKPROOF",
      );
    });

    test("set parallel safety", async () => {
      const base: Omit<ProcedureProps, "parallel_safety"> = {
        schema: "public",
        name: "test_function",
        kind: "f",
        return_type: "int4",
        return_type_schema: "pg_catalog",
        language: "sql",
        security_definer: false,
        volatility: "v",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: null,
        binary_path: null,
        sql_body: "SELECT 1",
        definition:
          "CREATE OR REPLACE FUNCTION public.test_function() RETURNS int4 LANGUAGE sql IMMUTABLE AS $$SELECT 1$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, parallel_safety: "u" });
      const change = new AlterProcedureSetParallel({
        procedure,
        parallelSafety: "r",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER FUNCTION public.test_function() PARALLEL RESTRICTED",
      );
    });

    // PROCEDURE variants
    test("procedure: set security definer", async () => {
      const base: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, security_definer: false });
      const change = new AlterProcedureSetSecurity({
        procedure,
        securityDefiner: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() SECURITY DEFINER",
      );
    });

    test("procedure: unset security definer (invoker)", async () => {
      const base: Omit<ProcedureProps, "security_definer"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, security_definer: true });
      const change = new AlterProcedureSetSecurity({
        procedure,
        securityDefiner: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() SECURITY INVOKER",
      );
    });

    test("procedure: set and reset config", async () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const main = new Procedure({ ...base, config: ["search_path=public"] });
      const change1 = new AlterProcedureSetConfig({
        procedure: main,
        action: "reset",
        key: "search_path",
      });
      const change2 = new AlterProcedureSetConfig({
        procedure: main,
        action: "set",
        key: "search_path",
        value: "pg_temp",
      });
      const change3 = new AlterProcedureSetConfig({
        procedure: main,
        action: "set",
        key: "work_mem",
        value: "64MB",
      });
      await assertValidSql(change1.serialize());
      expect(change1.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() RESET search_path",
      );
      await assertValidSql(change2.serialize());
      expect(change2.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() SET search_path TO pg_temp",
      );
      await assertValidSql(change3.serialize());
      expect(change3.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() SET work_mem TO '64MB'",
      );
    });

    test("procedure: reset all config (to null)", async () => {
      const base: Omit<ProcedureProps, "config"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const main = new Procedure({
        ...base,
        config: ["search_path=public", "work_mem=64MB"],
      });
      const change1 = new AlterProcedureSetConfig({
        procedure: main,
        action: "reset",
        key: "search_path",
      });
      const change2 = new AlterProcedureSetConfig({
        procedure: main,
        action: "reset",
        key: "work_mem",
      });
      await assertValidSql(change1.serialize());
      expect(change1.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() RESET search_path",
      );
      await assertValidSql(change2.serialize());
      expect(change2.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() RESET work_mem",
      );
    });

    test("procedure: set volatility", async () => {
      const base: Omit<ProcedureProps, "volatility"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        parallel_safety: "u",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, volatility: "v" });
      const change = new AlterProcedureSetVolatility({
        procedure,
        volatility: "s",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() STABLE",
      );
    });

    test("procedure: set strictness", async () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, is_strict: false });
      const change = new AlterProcedureSetStrictness({
        procedure,
        isStrict: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() STRICT",
      );
    });

    test("procedure: unset strictness (called on null input)", async () => {
      const base: Omit<ProcedureProps, "is_strict"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, is_strict: true });
      const change = new AlterProcedureSetStrictness({
        procedure,
        isStrict: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() CALLED ON NULL INPUT",
      );
    });

    test("procedure: set leakproof", async () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, leakproof: false });
      const change = new AlterProcedureSetLeakproof({
        procedure,
        leakproof: true,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() LEAKPROOF",
      );
    });

    test("procedure: unset leakproof", async () => {
      const base: Omit<ProcedureProps, "leakproof"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        parallel_safety: "u",
        is_strict: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, leakproof: true });
      const change = new AlterProcedureSetLeakproof({
        procedure,
        leakproof: false,
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() NOT LEAKPROOF",
      );
    });

    test("procedure: set parallel safety", async () => {
      const base: Omit<ProcedureProps, "parallel_safety"> = {
        schema: "public",
        name: "test_procedure",
        kind: "p",
        return_type: "void",
        return_type_schema: "pg_catalog",
        language: "plpgsql",
        security_definer: false,
        volatility: "v",
        is_strict: false,
        leakproof: false,
        returns_set: false,
        argument_count: 0,
        argument_default_count: 0,
        argument_names: null,
        argument_types: null,
        all_argument_types: null,
        argument_modes: null,
        argument_defaults: null,
        source_code: "BEGIN RETURN; END;",
        binary_path: null,
        sql_body: null,
        definition:
          "CREATE OR REPLACE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$BEGIN RETURN; END;$$",
        config: null,
        owner: "test",
        execution_cost: 0,
        result_rows: 0,
        comment: null,
        privileges: [],
      };
      const procedure = new Procedure({ ...base, parallel_safety: "u" });
      const change = new AlterProcedureSetParallel({
        procedure,
        parallelSafety: "s",
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER PROCEDURE public.test_procedure() PARALLEL SAFE",
      );
    });
  });
});
