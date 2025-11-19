import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { type DbConnection, isPgliteConnection } from "./adapter.ts";
import { createMigrationFromDiff, diff, postgresConfig } from "./main.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error(
      "Usage: pg-diff diff <main> <branch> [-O sql] | pg-diff migrate <main> <branch>"
    );
    process.exit(1);
  }

  const command = args[0];
  let outputSql = false;
  let mainArg: string;
  let branchArg: string;

  if (command === "diff") {
    if (args[1] === "-O" && args[2] === "sql") {
      outputSql = true;
      mainArg = args[3];
      branchArg = args[4];
    } else {
      mainArg = args[1];
      branchArg = args[2];
    }
  } else if (command === "migrate") {
    mainArg = args[1];
    branchArg = args[2];
  } else {
    console.error("Invalid command. Use 'diff' or 'migrate'.");
    process.exit(1);
  }

  // Parse connections
  const mainConn = parseConnection(mainArg);
  const branchConn = parseConnection(branchArg);

  // Run diff
  const changes = await diff(mainConn, branchConn);

  if (command === "diff") {
    if (outputSql) {
      const ctx = { mainCatalog: null as any, branchCatalog: null as any }; // Simplified, as diff doesn't return catalogs
      const sql = createMigrationFromDiff(changes, ctx);
      console.log(sql);
    } else {
      console.log(JSON.stringify(changes, null, 2));
    }
  } else if (command === "migrate") {
    const ctx = { mainCatalog: null as any, branchCatalog: null as any };
    const sql = createMigrationFromDiff(changes, ctx);
    await executeSql(mainConn, sql);
    console.log("Migration completed.");
  }
}

function parseConnection(arg: string): DbConnection {
  try {
    new URL(arg);
    return arg; // PostgreSQL connection string
  } catch {
    return new PGlite(arg);
  }
}

async function executeSql(conn: DbConnection, sql: string) {
  if (isPgliteConnection(conn)) {
    // const adapter = createPgliteAdapter(conn);
    await conn.exec(sql);
  } else {
    const pgSql = postgres(conn, postgresConfig);
    await pgSql.unsafe(sql);
    await pgSql.end();
  }
}

await main()
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    process.exit(0);
  });
