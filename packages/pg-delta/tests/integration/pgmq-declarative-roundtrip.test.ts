import { describe, expect, test } from "bun:test";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { supabase as supabaseIntegration } from "../../src/core/integrations/supabase.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import type { PostgresVersion } from "../constants.ts";
import { withDbSupabaseIsolated } from "../utils.ts";

const pgVersion: PostgresVersion = 15;

describe(`pgmq declarative roundtrip (pg${pgVersion})`, () => {
  test(
    "exported schema reapplies cleanly with supabase integration",
    withDbSupabaseIsolated(pgVersion, async (db) => {
      await db.branch.query(`
          CREATE EXTENSION pgmq;

          select from pgmq.create('my_queue');
          select * from pgmq.send('my_queue', '{"hello": "world"}');

          CREATE FUNCTION public.pgmq_delete (
            queue_name text,
            message_id bigint
          )
            RETURNS boolean
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path TO 'pgmq'
            AS $function$
          DECLARE
              result boolean;
          BEGIN
              -- Add debug logging
              RAISE NOTICE 'pgmq_delete called with queue_name=%, message_id=% (type: %)', 
                  queue_name, message_id, pg_typeof(message_id);
              
              -- Validate input parameters
              IF queue_name IS NULL OR queue_name = '' THEN
                  RAISE EXCEPTION 'queue_name cannot be null or empty';
              END IF;
              
              IF message_id IS NULL THEN
                  RAISE EXCEPTION 'message_id cannot be null';
              END IF;
              
              IF message_id <= 0 THEN
                  RAISE EXCEPTION 'message_id must be a positive integer, got: %', message_id;
              END IF;
              
              -- Call the actual pgmq.delete function
              RAISE NOTICE 'Calling pgmq.delete with queue_name=%, msg_id=%', queue_name, message_id;
              SELECT pgmq.delete(queue_name, message_id) INTO result;
              RAISE NOTICE 'pgmq.delete returned: %', result;
              
              RETURN result;
          END;
          $function$;

          CREATE FUNCTION public.pgmq_read (
            queue_name    text,
            sleep_seconds integer DEFAULT 0,
            n             integer DEFAULT 1
          )
            RETURNS SETOF pgmq.message_record
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path TO 'pgmq'
            AS $function$
          BEGIN
              -- Validate input parameters
              IF queue_name IS NULL OR queue_name = '' THEN
                  RAISE EXCEPTION 'queue_name cannot be null or empty';
              END IF;
              
              IF sleep_seconds IS NULL OR sleep_seconds < 0 THEN
                  RAISE EXCEPTION 'sleep_seconds must be non-negative, got: %', sleep_seconds;
              END IF;
              
              IF n IS NULL OR n <= 0 THEN
                  RAISE EXCEPTION 'n must be a positive integer, got: %', n;
              END IF;
              
              RETURN QUERY
              SELECT * FROM pgmq.read(queue_name, sleep_seconds, n);
          END;
          $function$;

          CREATE FUNCTION public.pgmq_set_vt (
            queue_name text,
            message_id bigint,
            vt         integer
          )
            RETURNS boolean
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path TO 'pgmq'
            AS $function$
          BEGIN
              RETURN pgmq.set_vt(queue_name, message_id, vt);
          END;
          $function$;
        `);

      if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
        throw new Error("supabase integration missing filter or serialize");
      }

      const compiledFilter = compileFilterDSL(supabaseIntegration.filter);
      const compiledSerialize = compileSerializeDSL(
        supabaseIntegration.serialize,
      );

      const planResult = await createPlan(db.main, db.branch, {
        filter: supabaseIntegration.filter,
        serialize: supabaseIntegration.serialize,
        skipDefaultPrivilegeSubtraction: true,
      });

      if (!planResult) {
        throw new Error(
          "createPlan returned null -- no changes detected between baseline and branch",
        );
      }

      const output = exportDeclarativeSchema(planResult, {
        integration: { serialize: compiledSerialize },
      });

      const applyResult = await applyDeclarativeSchema({
        content: output.files.map((file) => ({
          filePath: file.path,
          sql: file.sql,
        })),
        pool: db.main,
        disableCheckFunctionBodies: true,
        validateFunctionBodies: false,
      });

      if (applyResult.apply.status !== "success") {
        throw new Error(
          `Declarative apply failed (${applyResult.apply.status})`,
          { cause: applyResult },
        );
      }

      const mainCatalog = await extractCatalog(db.main);
      const branchCatalog = await extractCatalog(db.branch);
      const allChanges = diffCatalogs(mainCatalog, branchCatalog);
      const remainingChanges = allChanges.filter(compiledFilter);

      if (remainingChanges.length > 0) {
        const sorted = sortChanges(
          { mainCatalog, branchCatalog },
          remainingChanges,
        );
        const remainingSql = sorted
          .map((change) => change.serialize())
          .join(";\n");
        console.error(
          `[pgmq-declarative-roundtrip] ${remainingChanges.length} remaining change(s) after roundtrip:\n${remainingSql}`,
        );
      }

      expect(remainingChanges).toHaveLength(0);
    }),
    2 * 60 * 1000,
  );
});
