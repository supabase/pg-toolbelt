import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { getContainerRuntimeClient, ImageName, Wait } from "testcontainers";
import { SQL } from "bun";
import type { SqlExecutor } from "./postgres-types";

const POSTGRES_VALIDATION_IMAGE = "postgres:17-alpine";

let containerPromise: Promise<StartedPostgreSqlContainer> | null = null;
let pullImagePromise: Promise<void> | null = null;
let stopHookInstalled = false;

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const randomDatabaseName = (): string =>
  `pgdeclare_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const prewarmPostgresValidationImage = async (): Promise<void> => {
  if (!pullImagePromise) {
    pullImagePromise = (async () => {
      const client = await getContainerRuntimeClient();
      await client.image.pull(ImageName.fromString(POSTGRES_VALIDATION_IMAGE), {
        force: false,
        platform: undefined,
      });
    })();
  }

  try {
    await pullImagePromise;
  } catch (error) {
    pullImagePromise = null;
    throw error;
  }
};

const ensureContainer = async (): Promise<StartedPostgreSqlContainer> => {
  if (!containerPromise) {
    containerPromise = (async () => {
      await prewarmPostgresValidationImage();
      return new PostgreSqlContainer(POSTGRES_VALIDATION_IMAGE)
        .withWaitStrategy(Wait.forHealthCheck())
        .withStartupTimeout(120_000)
        .start();
    })();
  }

  let container: StartedPostgreSqlContainer;
  try {
    container = await containerPromise;
  } catch (error) {
    containerPromise = null;
    throw error;
  }
  if (!stopHookInstalled) {
    stopHookInstalled = true;
    process.once("beforeExit", async () => {
      try {
        await container.stop();
      } catch {
        // Best-effort cleanup only.
      }
    });
  }

  return container;
};

const openAdminClient = async (container: StartedPostgreSqlContainer): Promise<SQL> => {
  const adminClient = new SQL({
    adapter: "postgres",
    hostname: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: "postgres",
  });
  await adminClient.connect();
  return adminClient;
};

const openDatabaseClient = async (
  container: StartedPostgreSqlContainer,
  databaseName: string,
): Promise<SQL> => {
  const dbClient = new SQL({
    adapter: "postgres",
    hostname: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: databaseName,
  });
  await dbClient.connect();
  return dbClient;
};

const closeClientBestEffort = async (client: SQL): Promise<void> => {
  try {
    await client.close({ timeout: 0 });
  } catch {
    // Ignore teardown failures in test support.
  }
};

const executeQuery = async <T>(client: SQL, sql: string): Promise<T> =>
  (await client.unsafe<T>(sql).simple()) as T;

type PostgresValidationDatabaseOptions = {
  initialMigrationSql?: string;
};

const dropDatabaseBestEffort = async (adminClient: SQL, databaseName: string): Promise<void> => {
  const quotedName = quoteIdentifier(databaseName);
  try {
    await executeQuery(adminClient, `drop database if exists ${quotedName} with (force);`);
    return;
  } catch {
    // Fallback for engines that do not support WITH (FORCE).
  }

  try {
    await executeQuery(
      adminClient,
      `select pg_terminate_backend(pid)
       from pg_stat_activity
       where datname = '${databaseName.replaceAll("'", "''")}'
         and pid <> pg_backend_pid();`,
    );
  } catch {
    // Best-effort termination.
  }

  await executeQuery(adminClient, `drop database if exists ${quotedName};`);
};

const cleanupLogicalReplicationBestEffort = async (dbClient: SQL): Promise<void> => {
  try {
    const rows = await executeQuery<Array<{ subname: string }>>(
      dbClient,
      "select subname from pg_subscription;",
    );
    for (const row of rows) {
      const subscriptionName = quoteIdentifier(row.subname);
      try {
        await executeQuery(
          dbClient,
          `drop subscription if exists ${subscriptionName} with (force);`,
        );
      } catch {
        try {
          await executeQuery(dbClient, `drop subscription if exists ${subscriptionName};`);
        } catch {
          // Continue best-effort cleanup for remaining subscriptions.
        }
      }
    }
  } catch {
    // Cleanup is best-effort; dropping database may still succeed.
  }
};

export const withPostgresValidationDatabase = async <T>(
  callback: (db: SqlExecutor) => Promise<T>,
  options: PostgresValidationDatabaseOptions = {},
): Promise<T> => {
  const container = await ensureContainer();
  const databaseName = randomDatabaseName();
  const quotedDatabaseName = quoteIdentifier(databaseName);

  const adminClient = await openAdminClient(container);
  try {
    await executeQuery(adminClient, `create database ${quotedDatabaseName};`);
  } finally {
    await closeClientBestEffort(adminClient);
  }

  const dbClient = await openDatabaseClient(container, databaseName);

  try {
    if (options.initialMigrationSql?.trim()) {
      await executeQuery(dbClient, options.initialMigrationSql);
    }

    return await callback({
      query: async (sql: string): Promise<unknown> => executeQuery(dbClient, sql),
    });
  } finally {
    await cleanupLogicalReplicationBestEffort(dbClient);
    await closeClientBestEffort(dbClient);

    const cleanupAdminClient = await openAdminClient(container);
    try {
      try {
        await dropDatabaseBestEffort(cleanupAdminClient, databaseName);
      } catch {
        // Database teardown is best-effort in test support code.
      }
    } finally {
      await closeClientBestEffort(cleanupAdminClient);
    }
  }
};
