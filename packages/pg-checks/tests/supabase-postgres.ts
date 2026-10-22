/**
 * A `supabase/postgres` container started like the CLI's local stack: only
 * POSTGRES_PASSWORD is set, so `postgres` is the non-superuser CLI role and
 * `supabase_admin` is the superuser pg-meta connects as.
 */
import pg from "pg";
import {
  GenericContainer,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

export const SUPABASE_IMAGES = {
  "17": "public.ecr.aws/supabase/postgres:17.11.0.005",
  "15": "public.ecr.aws/supabase/postgres:15.19.0.005",
} as const;

export interface SupabasePostgres {
  readonly image: string;
  connect(user?: "postgres" | "supabase_admin"): Promise<pg.Client>;
  stop(): Promise<void>;
}

export async function startSupabasePostgres(
  image: string,
  /** Join `network` as host `alias`, for a sidecar such as pg-meta. */
  network?: { readonly network: StartedNetwork; readonly alias: string },
): Promise<SupabasePostgres> {
  let builder = new GenericContainer(image);
  if (network !== undefined) {
    builder = builder
      .withNetwork(network.network)
      .withNetworkAliases(network.alias);
  }
  const container: StartedTestContainer = await builder
    .withEnvironment({ POSTGRES_PASSWORD: "postgres" })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forHealthCheck())
    .withStartupTimeout(180_000)
    .withTmpFs({ "/var/lib/postgresql/data": "rw,noexec,nosuid,size=1024m" })
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return {
    image,
    async connect(user = "postgres") {
      const client = new pg.Client({
        host,
        port,
        user,
        password: "postgres",
        database: "postgres",
      });
      client.on("error", () => {});
      await client.connect();
      return client;
    },
    async stop() {
      await container.stop();
    },
  };
}
