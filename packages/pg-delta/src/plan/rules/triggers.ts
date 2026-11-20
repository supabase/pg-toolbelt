/** Rule definitions for table triggers and event triggers. */
import type { StableId } from "../../core/stable-id.ts";
import { lit, qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import { dependencyConsumes, enabledPhrase, p, str } from "./helpers.ts";

export const triggerRules: Record<string, KindRules> = {
  trigger: {
    weight: 15,
    cascadesToChildren: true,
    rebuildable: true,
    rename: (fact, to) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `ALTER TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)} RENAME TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      const specs: ActionSpec[] = [{ sql: str(p(fact, "def")) }];
      const enabled = p(fact, "enabled");
      if (enabled != null && enabled !== "O") {
        specs.push({
          sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(enabled))} TRIGGER ${qid(id.name)}`,
        });
      }
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      // CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE and needs the
      // TRIGGER privilege, where DROP needs ACCESS EXCLUSIVE and ownership.
      // Constraint triggers and statement-level triggers on a partitioned
      // table keep drop + create: OR REPLACE rejects the first and recurses
      // to partitions only for row-level triggers. A missing marker (a fact
      // from an older snapshot) means unknown, so drop + create. OR REPLACE
      // resets tgenabled to 'O', hence the restore; both specs share
      // `consumes`, so the emission-index tie-break keeps the restore second.
      def: {
        restatesDefinition: true,
        firesUntilAltered: (source) => source.payload["enabled"] !== "D",
        replaceWhen: (from, to, fact) =>
          !str(from).startsWith("CREATE TRIGGER ") ||
          !str(to).startsWith("CREATE TRIGGER ") ||
          fact.payload["_statementOnPartitioned"] !== false,
        alter: (fact, _from, to, view) => {
          const id = fact.id as { schema: string; table: string; name: string };
          const consumes = dependencyConsumes(view, fact.id);
          const specs: ActionSpec[] = [
            {
              sql: str(to).replace(
                /^CREATE TRIGGER /,
                "CREATE OR REPLACE TRIGGER ",
              ),
              consumes,
            },
          ];
          const enabled = p(fact, "enabled");
          if (enabled != null && enabled !== "O") {
            specs.push({
              sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(enabled))} TRIGGER ${qid(id.name)}`,
              consumes,
            });
          }
          return specs;
        },
      },
      enabled: {
        alter: (fact, _from, to, _view, sourceView) => {
          // a def change's OR REPLACE + restore already sets the firing state
          const sourceDef = sourceView.get(fact.id)?.payload["def"];
          if (sourceDef !== undefined && sourceDef !== p(fact, "def")) {
            return [];
          }
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(to))} TRIGGER ${qid(id.name)}`,
          };
        },
      },
    },
  },

  eventTrigger: {
    weight: 17,
    // An event trigger depends on its backing function (pg_depend 'n' edge +
    // the create's `consumes: [fnId]`). A function BODY change now alters in
    // place (CREATE OR REPLACE — see routines.ts), leaving the ET untouched; but
    // a change CREATE OR REPLACE cannot express (return type / language / window-
    // kind) or a REMOVE+ADD of the backing function still DEMOLISHES it. A
    // surviving event trigger on a demolished function must therefore be dropped
    // before the function and recreated after; without `rebuildable` the closure
    // skips it and `DROP FUNCTION` fails with "other objects depend on it"
    // (regression: Supabase's grant_pg_net_access et al. back event triggers).
    // Pinned by plan/rules/routines.test.ts — Alpine cannot drive an ET-function
    // replace through the corpus (its backing fn must stay `() RETURNS
    // event_trigger` plpgsql, none of which can change under CREATE OR REPLACE).
    rebuildable: true,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      // an event-trigger function is always a real function (prokind 'f',
      // returns event_trigger), never a procedure.
      const fnId: StableId = {
        kind: "function",
        schema: str(p(fact, "functionSchema")),
        name: str(p(fact, "functionName")),
        args: [],
      };
      let sql = `CREATE EVENT TRIGGER ${name} ON ${str(p(fact, "event"))}`;
      const tags = (p(fact, "tags") as string[]) ?? [];
      if (tags.length > 0) {
        sql += ` WHEN TAG IN (${tags.map((t) => lit(t)).join(", ")})`;
      }
      sql += ` EXECUTE FUNCTION ${rel(str(p(fact, "functionSchema")), str(p(fact, "functionName")))}()`;
      const specs: ActionSpec[] = [
        {
          sql,
          consumes: [fnId],
        },
      ];
      const enabled = p(fact, "enabled");
      if (enabled != null && enabled !== "O") {
        specs.push({
          sql: `ALTER EVENT TRIGGER ${name} ${enabledPhrase(str(enabled))}`,
        });
      }
      return specs;
    },
    drop: (fact) => ({
      sql: `DROP EVENT TRIGGER ${qid((fact.id as { name: string }).name)}`,
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER EVENT TRIGGER ${qid((fact.id as { name: string }).name)}`,
    attributes: {
      enabled: {
        alter: (fact, _from, to) => ({
          sql: `ALTER EVENT TRIGGER ${qid((fact.id as { name: string }).name)} ${enabledPhrase(str(to))}`,
        }),
      },
      event: "replace",
      tags: "replace",
      functionSchema: "replace",
      functionName: "replace",
    },
  },
};
