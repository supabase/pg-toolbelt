import debug from "debug";
import type { Pool } from "pg";
import { createPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  type PostgresVersion,
} from "./constants.ts";
import {
  PostgresAlpineContainer,
  type StartedPostgresAlpineContainer,
} from "./postgres-alpine.ts";

const debugContainer = debug("pg-delta:container");

/**
 * Suppress expected shutdown errors from idle pool connections.
 * Error code 57P01 = admin_shutdown (container stopped while connection open)
 */
function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01") {
    // Expected during container shutdown - ignore
    return;
  }
  console.error("Pool error:", err);
}

class ContainerManager {
  private containers: Map<PostgresVersion, StartedPostgresAlpineContainer> =
    new Map();
  private adminPools: Map<PostgresVersion, Pool> = new Map();
  private dbCounter = 0;
  private initializedVersions: Set<PostgresVersion> = new Set();
  private initializationPromises: Map<PostgresVersion, Promise<void>> =
    new Map();

  /**
   * Initialize with a single container for each PostgreSQL version
   */
  async initialize(versions: PostgresVersion[]): Promise<void> {
    // Filter out versions that are already initialized
    const versionsToInitialize = versions.filter(
      (version) => !this.initializedVersions.has(version),
    );

    if (versionsToInitialize.length === 0) {
      return;
    }

    // Start initialization for all versions that need it
    const initializationPromises = versionsToInitialize.map((version) =>
      this._initializeVersion(version),
    );
    await Promise.all(initializationPromises);
  }

  private async _initializeVersion(version: PostgresVersion): Promise<void> {
    // Check if already initialized
    if (this.initializedVersions.has(version)) {
      return;
    }

    // Check if initialization is already in progress for this version
    const existingPromise = this.initializationPromises.get(version);
    if (existingPromise) {
      return existingPromise;
    }

    // Start initialization for this version
    const initPromise = this._doInitializeVersion(version);
    this.initializationPromises.set(version, initPromise);

    try {
      await initPromise;
      this.initializedVersions.add(version);
    } finally {
      // Clean up the promise once done
      this.initializationPromises.delete(version);
    }
  }

  private async _doInitializeVersion(version: PostgresVersion): Promise<void> {
    const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

    try {
      debugContainer(
        "[ContainerManager] Starting container for PostgreSQL %d...",
        version,
      );
      const container = await new PostgresAlpineContainer(image).start();
      this.containers.set(version, container);

      // Create an admin pool for database management (CREATE/DROP DATABASE).
      // Uses pg Pool instead of container.exec() because testcontainers exec()
      // hangs under Bun.
      const adminPool = createPool(container.getConnectionUri(), {
        max: 2,
        onError: suppressShutdownError,
      });
      this.adminPools.set(version, adminPool);

      debugContainer(
        "[ContainerManager] Successfully started container for PostgreSQL %d",
        version,
      );
    } catch (error) {
      console.error(
        `Failed to start container for PostgreSQL ${version}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Ensure the manager is initialized with the given versions
   */
  private async ensureInitialized(versions: PostgresVersion[]): Promise<void> {
    const versionsToInitialize = versions.filter(
      (version) => !this.initializedVersions.has(version),
    );
    if (versionsToInitialize.length > 0) {
      await this.initialize(versionsToInitialize);
    }
  }

  /**
   * Get a database pair (main, branch) for testing from the container
   */
  async getDatabasePair(version: PostgresVersion): Promise<{
    main: Pool;
    branch: Pool;
    cleanup: () => Promise<void>;
  }> {
    debugContainer(
      "[ContainerManager] Getting database pair for PostgreSQL %d",
      version,
    );
    await this.ensureInitialized([version]);

    const container = this.containers.get(version);
    if (!container) {
      throw new Error(`No container available for PostgreSQL ${version}`);
    }

    const adminPool = this.adminPools.get(version);
    if (!adminPool) {
      throw new Error(`No admin pool available for PostgreSQL ${version}`);
    }

    // Generate unique database names
    const dbNameMain = `test_db_${this.dbCounter++}_${Date.now()}_main`;
    const dbNameBranch = `test_db_${this.dbCounter++}_${Date.now()}_branch`;

    // Create both databases via pg Pool (not container.exec which hangs in Bun)
    await Promise.all([
      adminPool.query(
        `CREATE DATABASE "${dbNameMain}" OWNER "${container.getUsername()}"`,
      ),
      adminPool.query(
        `CREATE DATABASE "${dbNameBranch}" OWNER "${container.getUsername()}"`,
      ),
    ]);

    // Create SQL connections to both databases on the same container
    // Use onError to suppress expected shutdown errors from idle connections
    const poolMain = createPool(
      container.getConnectionUriForDatabase(dbNameMain),
      { max: 5, onError: suppressShutdownError },
    );
    const poolBranch = createPool(
      container.getConnectionUriForDatabase(dbNameBranch),
      { max: 5, onError: suppressShutdownError },
    );

    const cleanup = async () => {
      try {
        // Close connections
        await Promise.all([poolMain.end(), poolBranch.end()]);

        // Drop subscriptions then databases via pg Pool
        for (const dbName of [dbNameMain, dbNameBranch]) {
          try {
            // Connect to the database to drop subscriptions
            const dbPool = createPool(
              container.getConnectionUriForDatabase(dbName),
              { max: 1, onError: suppressShutdownError },
            );
            try {
              const subsResult = await dbPool.query(
                "SELECT quote_ident(subname) as subname FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())",
              );
              for (const row of subsResult.rows) {
                await dbPool.query(
                  `ALTER SUBSCRIPTION ${row.subname} SET (slot_name = NONE)`,
                );
                await dbPool.query(`DROP SUBSCRIPTION ${row.subname}`);
              }
            } catch {
              // Best-effort subscription cleanup
            } finally {
              await dbPool.end();
            }
          } catch {
            // Best-effort subscription cleanup
          }
          // Drop the database
          await adminPool.query(
            `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
          );
        }
      } catch (error) {
        console.error("Error during database cleanup:", error);
      }
    };

    return { main: poolMain, branch: poolBranch, cleanup };
  }

  /**
   * Get isolated containers (creates new containers for the test)
   */
  async getIsolatedContainers(version: PostgresVersion): Promise<{
    main: Pool;
    branch: Pool;
    cleanup: () => Promise<void>;
  }> {
    const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[version]}`;

    const [containerMain, containerBranch] = await Promise.all([
      new PostgresAlpineContainer(image).start(),
      new PostgresAlpineContainer(image).start(),
    ]);

    const poolMain = createPool(containerMain.getConnectionUri(), {
      max: 5,
      onError: suppressShutdownError,
    });
    const poolBranch = createPool(containerBranch.getConnectionUri(), {
      max: 5,
      onError: suppressShutdownError,
    });

    const cleanup = async () => {
      try {
        await Promise.all([poolMain.end(), poolBranch.end()]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      } catch (error) {
        console.error("Error during isolated container cleanup:", error);
      }
    };

    return { main: poolMain, branch: poolBranch, cleanup };
  }

  /**
   * Cleanup all containers
   */
  async cleanup(): Promise<void> {
    // Close admin pools first
    await Promise.all(this.adminPools.values().map((pool) => pool.end()));
    this.adminPools.clear();
    await Promise.all(
      this.containers.values().map((container) => container.stop()),
    );
    this.containers.clear();
    this.initializedVersions.clear();
    this.initializationPromises.clear();
  }
}

// Global container manager instance - using globalThis to ensure singleton across modules
declare global {
  var __containerManager: ContainerManager | undefined;
}

export const containerManager =
  globalThis.__containerManager ||
  // biome-ignore lint/suspicious/noAssignInExpressions: this is a singleton
  (globalThis.__containerManager = new ContainerManager());
