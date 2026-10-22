/**
 * The Management API's migration path, for the integration tests: supabase/postgres
 * behind a real pg-meta (as supabase_admin, like the platform), and the one string
 * `applyAndTrackMigrations` POSTs to pg-meta `/query` (apps/mgmt-api
 * project-database-migrations.ts, `skipStatementTimeout`: only `queryTimeoutSecs`).
 */
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import {
  type SupabasePostgres,
  startSupabasePostgres,
} from "./supabase-postgres.ts";

const PG_META_IMAGE = "public.ecr.aws/supabase/postgres-meta:v0.100.0";

export interface PgMetaStack {
  readonly db: SupabasePostgres;
  /** POST `sql` to `/query`; the body is pg-meta's JSON (rows, or an error). */
  query(sql: string): Promise<{ status: number; body: unknown }>;
  stop(): Promise<void>;
}

export async function startPgMetaStack(image: string): Promise<PgMetaStack> {
  const network: StartedNetwork = await new Network().start();
  const db = await startSupabasePostgres(image, { network, alias: "db" });
  const meta: StartedTestContainer = await new GenericContainer(PG_META_IMAGE)
    .withNetwork(network)
    .withEnvironment({
      PG_META_DB_URL:
        "postgres://supabase_admin:postgres@db:5432/postgres?sslmode=disable",
    })
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp("/health", 8080))
    .start();
  const url = `http://${meta.getHost()}:${meta.getMappedPort(8080)}`;
  return {
    db,
    async query(sql) {
      const response = await fetch(`${url}/query?queryTimeoutSecs=185`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      return { status: response.status, body: await response.json() };
    },
    async stop() {
      await meta.stop();
      await db.stop();
      await network.stop();
    },
  };
}

export const INIT_HISTORY = `begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;
alter table supabase_migrations.schema_migrations add column if not exists created_by text;
alter table supabase_migrations.schema_migrations add column if not exists idempotency_key text unique;
alter table supabase_migrations.schema_migrations add column if not exists rollback text[];
commit;`;

/**
 * The platform's `begin; <file>; <history upsert>; commit;`, with the check before
 * the history insert and the in-transaction read after it. The version is passed
 * in (the platform uses the current timestamp) so tests in one second do not collide.
 */
export function applyAndTrack(
  file: string,
  version: string,
  options: { readonly check?: string; readonly warnRead?: string } = {},
): string {
  const quote = (s: string) => `$mig$${s}$mig$`;
  return `begin;

-- apply sql from post body
${file};

${options.check ?? ""}
insert into supabase_migrations.schema_migrations as old
  (version, name, statements, created_by, idempotency_key, rollback)
values (${quote(version)}, ${quote("test")}, array[${quote(file)}], ${quote("test@example.com")}, null, null)
on conflict (idempotency_key) do update set
  version = EXCLUDED.version,
  name = coalesce(EXCLUDED.name, old.name),
  statements = EXCLUDED.statements,
  rollback = EXCLUDED.rollback,
  created_by = EXCLUDED.created_by;
${options.warnRead ?? ""}
commit;`;
}
