import { buildApplication, buildRouteMap } from "@stricli/core";
import { applyCommand } from "./commands/apply.ts";
import { declarativeApplyCommand } from "./commands/declarative-apply.ts";
import { declarativeExportCommand } from "./commands/declarative-export.ts";
import { planCommand } from "./commands/plan.ts";
import { syncCommand } from "./commands/sync.ts";

const declarativeRouteMap = buildRouteMap({
  routes: {
    apply: declarativeApplyCommand,
    export: declarativeExportCommand,
  },
  docs: {
    brief: "Declarative schema management",
    fullDescription: `
Manage declarative SQL schemas.

Commands:
  apply  - Apply a declarative SQL schema to a database
  export - Export a declarative schema from a database diff
    `.trim(),
  },
});

const root = buildRouteMap({
  routes: {
    plan: planCommand,
    apply: applyCommand,
    sync: syncCommand,
    declarative: declarativeRouteMap,
  },
  defaultCommand: "sync",
  docs: {
    brief: "PostgreSQL migrations made easy",
    fullDescription: `
pgdelta generates migration scripts by comparing two PostgreSQL databases.

Commands:
  plan        - Compute schema diff and preview changes
  apply       - Apply a plan's migration script to a database
  sync        - Plan and apply changes in one go
  declarative - Declarative schema (apply | export)
    `.trim(),
  },
});

export const app = buildApplication(root, {
  name: "pgdelta",
});
