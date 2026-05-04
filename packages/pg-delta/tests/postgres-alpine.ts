import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbstractStartedContainer,
  GenericContainer,
  getContainerRuntimeClient,
  ImageName,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { ALPINE_TAG_FOR_PG_MAJOR } from "./alpine-tags.ts";
import type { PostgresVersion } from "./constants.ts";

const POSTGRES_PORT = 5432;

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const DUMMY_SECLABEL_IMAGE_PREFIX = "pg-delta-test";

/**
 * Internal counter incremented every time `buildPostgresTestImage` actually
 * invokes `GenericContainer.fromDockerfile(...)` (i.e. when no prebuilt
 * image is found locally). Exposed only so tests can verify the
 * short-circuit path.
 */
let buildInvocations = 0;

/** @internal */
export function getBuildInvocationCount(): number {
  return buildInvocations;
}

/**
 * Build (or reuse) a Postgres image that has the `dummy_seclabel` test
 * contrib module pre-installed, so integration tests can exercise
 * `SECURITY LABEL` end-to-end. Tagged locally as `pg-delta-test:<major>`.
 *
 * Skips the docker build entirely when the tag already exists in the
 * local daemon — CI prebuilds these images once per PG version (see
 * `pg-delta-build-test-images` in `.github/workflows/tests.yml`) and
 * pulls + retags them in each integration shard, so this short-circuit
 * is what saves shards from paying the rebuild cost.
 */
export async function buildPostgresTestImage(
  version: PostgresVersion,
): Promise<string> {
  const imageTag = `${DUMMY_SECLABEL_IMAGE_PREFIX}:${version}`;

  const containerRuntimeClient = await getContainerRuntimeClient();
  const alreadyPresent = await containerRuntimeClient.image.exists(
    ImageName.fromString(imageTag),
  );
  if (alreadyPresent) {
    return imageTag;
  }

  buildInvocations += 1;
  await GenericContainer.fromDockerfile(TESTS_DIR, "dummy-seclabel.Dockerfile")
    .withBuildArgs({
      PG_MAJOR: String(version),
      PG_BRANCH: `REL_${version}_STABLE`,
      ALPINE_TAG: ALPINE_TAG_FOR_PG_MAJOR[version],
    })
    .withCache(true)
    .build(imageTag, { deleteOnExit: false });
  return imageTag;
}

export class PostgresAlpineContainer extends GenericContainer {
  private database = "postgres";
  private username = "postgres";
  private password = "postgres";

  constructor(image: string) {
    super(image);
    this.withLabels({ "pg-toolbelt.package": "pg-delta" });
    this.withExposedPorts(POSTGRES_PORT);
    this.withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U postgres -h localhost"],
      interval: 1_000,
      timeout: 5_000,
      retries: 10,
    });
    this.withWaitStrategy(Wait.forHealthCheck());
    this.withStartupTimeout(120_000);
    this.withTmpFs({
      // PostgreSQL 18 stores data under /var/lib/postgresql/<major>/docker instead of /data
      "/var/lib/postgresql": "rw,noexec,nosuid,size=256m",
    });

    // Always enable logical replication so subscription tests work. Preload
    // `dummy_seclabel` only on our custom `pg-delta-test:*` image (which has
    // the module installed — see dummy-seclabel.Dockerfile); stock postgres
    // images would fail to start with `shared_preload_libraries=dummy_seclabel`.
    const command = ["postgres", "-c", "wal_level=logical"];
    if (image.startsWith(`${DUMMY_SECLABEL_IMAGE_PREFIX}:`)) {
      command.push("-c", "shared_preload_libraries=dummy_seclabel");
    }
    this.withCommand(command);
  }

  public override async start(): Promise<StartedPostgresAlpineContainer> {
    this.withEnvironment({
      POSTGRES_DB: this.database,
      POSTGRES_USER: this.username,
      POSTGRES_PASSWORD: this.password,
    });

    return new StartedPostgresAlpineContainer(
      await super.start(),
      this.database,
      this.username,
      this.password,
    );
  }
}

export class StartedPostgresAlpineContainer extends AbstractStartedContainer {
  private readonly database: string;
  private readonly username: string;
  private readonly password: string;

  constructor(
    startedTestContainer: StartedTestContainer,
    database: string,
    username: string,
    password: string,
  ) {
    super(startedTestContainer);
    this.database = database;
    this.username = username;
    this.password = password;
  }

  public getPort(): number {
    return super.getMappedPort(POSTGRES_PORT);
  }

  public getDatabase(): string {
    return this.database;
  }

  public getUsername(): string {
    return this.username;
  }

  public getPassword(): string {
    return this.password;
  }

  /**
   * @returns A connection URI in the form of `postgres[ql]://[username[:password]@][host[:port],]/database`
   */
  public getConnectionUri(): string {
    const url = new URL("", "postgres://");
    url.hostname = this.getHost();
    url.port = this.getPort().toString();
    url.pathname = this.getDatabase();
    url.username = this.getUsername();
    url.password = this.getPassword();
    return url.toString();
  }

  /**
   * Get connection URI for a specific database
   */
  public getConnectionUriForDatabase(dbName: string): string {
    const url = new URL("", "postgres://");
    url.hostname = this.getHost();
    url.port = this.getPort().toString();
    url.pathname = dbName;
    url.username = this.getUsername();
    url.password = this.getPassword();
    return url.toString();
  }

  /**
   * Creates a new database for testing
   */
  public async createDatabase(dbName: string): Promise<void> {
    await this.execCommandsSQL([
      `CREATE DATABASE "${dbName}" OWNER "${this.getUsername()}"`,
    ]);
  }

  /**
   * Drops a database
   */
  public async dropDatabase(dbName: string): Promise<void> {
    const listResult = await this.exec([
      "psql",
      "-At",
      "-U",
      this.getUsername(),
      "-d",
      dbName,
      "-c",
      "SELECT quote_ident(subname) FROM pg_catalog.pg_subscription WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database());",
    ]);
    if (listResult.exitCode !== 0) {
      throw new Error(
        `Command failed with exit code ${listResult.exitCode}: ${listResult.output}`,
      );
    }
    const subscriptionNames = listResult.output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const subName of subscriptionNames) {
      await this.execCommandsSQL(
        [
          `ALTER SUBSCRIPTION ${subName} SET (slot_name = NONE)`,
          `DROP SUBSCRIPTION ${subName}`,
        ],
        dbName,
      );
    }
    await this.execCommandsSQL([
      `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`,
    ]);
  }

  /**
   * Executes a series of SQL commands against the Postgres database
   *
   * @param commands Array of SQL commands to execute in sequence
   * @throws Error if any command fails to execute with details of the failure
   */
  private async execCommandsSQL(
    commands: string[],
    database: string = "postgres",
  ): Promise<void> {
    for (const command of commands) {
      try {
        const result = await this.exec([
          "psql",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          this.getUsername(),
          "-d",
          database,
          "-c",
          command,
        ]);

        if (result.exitCode !== 0) {
          throw new Error(
            `Command failed with exit code ${result.exitCode}: ${result.output}`,
          );
        }
      } catch (error) {
        console.error(`Failed to execute command: ${command}`, error);
        throw error;
      }
    }
  }
}
