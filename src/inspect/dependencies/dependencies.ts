import type { Sql } from "postgres";
import { identifyFunction } from "../objects/functions.ts";
import { identifyTable } from "../objects/tables.ts";
import type { InspectionMap } from "../types.ts";
import type {
  InspectedDependency,
  SelectableDependenciesMap,
} from "./types.ts";
import { filterInspectionByPrefix, identifyDependency } from "./utils.ts";

export async function inspectDependencies(
  sql: Sql,
): Promise<SelectableDependenciesMap> {
  const dependencies = await sql<InspectedDependency[]>`
with things1 as (
  select
    oid as objid,
    pronamespace as namespace,
    proname as name,
    pg_get_function_identity_arguments(oid) as identity_arguments,
    'f' as kind
  from pg_proc
  union
  select
    oid,
    relnamespace as namespace,
    relname as name,
    null as identity_arguments,
    relkind as kind
  from pg_class
  where oid not in (
    select ftrelid from pg_foreign_table
  )
),
extension_objids as (
  select
      objid as extension_objid
  from
      pg_depend d
  WHERE
      d.refclassid = 'pg_extension'::regclass
    union
    select
        t.typrelid as extension_objid
    from
        pg_depend d
        join pg_type t on t.oid = d.objid
    where
        d.refclassid = 'pg_extension'::regclass
),
things as (
    select
      objid,
      kind,
      n.nspname as schema,
      name,
      identity_arguments
    from things1 t
    inner join pg_namespace n
      on t.namespace = n.oid
    left outer join extension_objids
      on t.objid = extension_objids.extension_objid
    where
      kind in ('r', 'v', 'm', 'c', 'f') and
      n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
      and n.nspname not like 'pg\_temp\_%' and n.nspname not like 'pg\_toast\_temp\_%'
      and extension_objids.extension_objid is null
),
combined as (
  select distinct
    t.schema,
    t.name,
    t.identity_arguments,
    t.kind,
    things_dependent_on.schema as schema_dependent_on,
    things_dependent_on.name as name_dependent_on,
    things_dependent_on.identity_arguments as identity_arguments_dependent_on,
    things_dependent_on.kind as kind_dependent_on
  FROM
      pg_depend d
      inner join things things_dependent_on
        on d.refobjid = things_dependent_on.objid
      inner join pg_rewrite rw
        on d.objid = rw.oid
        and things_dependent_on.objid != rw.ev_class
      inner join things t
        on rw.ev_class = t.objid
  where
    d.deptype in ('n')
    and
    rw.rulename = '_RETURN'
)
select
  *
from combined
order by
schema, name, identity_arguments, kind_dependent_on,
schema_dependent_on, name_dependent_on, identity_arguments_dependent_on
  `;

  // Assuming dependencies is an array of dependency objects
  // and identifyDependency is a function that builds the identity string

  const selectableDependencieMap: SelectableDependenciesMap = {};
  for (const d of dependencies) {
    const key = identifyDependency(
      d.kind,
      d.schema,
      d.name,
      d.identity_arguments,
    );
    const depOn = identifyDependency(
      d.kind_dependent_on,
      d.schema_dependent_on,
      d.name_dependent_on,
      d.identity_arguments_dependent_on,
    );
    if (!selectableDependencieMap[key]) {
      selectableDependencieMap[key] = { dependent_on: [] };
    }
    selectableDependencieMap[key].dependent_on.push(depOn);
  }
  return selectableDependencieMap;
}

export async function buildDependencies(sql: Sql, inspection: InspectionMap) {
  // First deal with selectable dependencies encoded in pg_depend and pg_rewrite
  const dependencies = await inspectDependencies(sql);
  for (const dependency of dependencies) {
    const identity = identifyDependency(
      dependency.kind,
      dependency.schema,
      dependency.name,
      dependency.identity_arguments,
    );
    const identityDependentOn = identifyDependency(
      dependency.kind_dependent_on,
      dependency.schema_dependent_on,
      dependency.name_dependent_on,
      dependency.identity_arguments_dependent_on,
    );
    const object = inspection[identity];
    const objectDependentOn = inspection[identityDependentOn];

    if (object && objectDependentOn) {
      object.dependent_on.push(identityDependentOn);
      objectDependentOn.dependents.push(identity);
    }
  }

  // Then process partitioned and inherited tables dependencies
  for (const [tableKey, table] of filterInspectionByPrefix(
    inspection,
    "table",
  )) {
    if (table.parent_schema && table.parent_name) {
      const parentKey = `table:${identifyTable({
        schema: table.parent_schema,
        name: table.parent_name,
      })}` as const;
      const parent = inspection[parentKey];
      if (parent) {
        if (!table.dependent_on.includes(parentKey)) {
          table.dependent_on.push(parentKey);
        }
        if (!parent.dependents.includes(tableKey)) {
          parent.dependents.push(tableKey);
        }
      }
    }
  }

  // Then process trigger dependencies
  for (const [triggerKey, trigger] of filterInspectionByPrefix(
    inspection,
    "trigger",
  )) {
    // Table dependency
    if (trigger.table_schema && trigger.table_name) {
      const tableKey =
        `table:${trigger.table_schema}.${trigger.table_name}` as const;
      const table = inspection[tableKey];
      if (table) {
        if (!trigger.dependent_on.includes(tableKey)) {
          trigger.dependent_on.push(tableKey);
        }
        if (!table.dependents.includes(triggerKey)) {
          table.dependents.push(triggerKey);
        }
      }
    }
    // Function dependency
    if (trigger.function_schema && trigger.function_name) {
      const functionKey = `function:${identifyFunction({
        schema: trigger.function_schema,
        name: trigger.function_name,
        argument_names: null,
        argument_types: null,
      })}` as const;
      const function_ = inspection[functionKey];
      if (function_) {
        if (!trigger.dependent_on.includes(functionKey)) {
          trigger.dependent_on.push(functionKey);
        }
        if (!function_.dependents.includes(triggerKey)) {
          function_.dependents.push(triggerKey);
        }
      }
    }
  }
}
