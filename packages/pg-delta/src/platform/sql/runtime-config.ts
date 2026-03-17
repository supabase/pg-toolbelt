import { Config, ConfigProvider, Effect, Layer, ServiceMap } from "effect";
import { getRuntimeEnv } from "../../adapters/runtime-process.ts";

const DEFAULT_POOL_MAX = 5;
const DEFAULT_CONNECTION_TIMEOUT_MS = 3_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_500;

export interface PgRuntimeConfigApi {
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly getEnv: (name: string) => string | undefined;
}

export class PgRuntimeConfigService extends ServiceMap.Service<
  PgRuntimeConfigService,
  PgRuntimeConfigApi
>()("@pg-delta/PgRuntimeConfigService") {}

const defaultGetEnv = (name: string): string | undefined =>
  Effect.runSync(getRuntimeEnv(name).pipe(Effect.orDie));

const numberFromString = (name: string, fallback: number) =>
  Config.withDefault(Config.string(name), String(fallback)).pipe(
    Config.map((value) => Number(value) || fallback),
  );

const PgRuntimeConfig = Config.all({
  poolMax: numberFromString("PGDELTA_POOL_MAX", DEFAULT_POOL_MAX),
  connectionTimeoutMs: numberFromString(
    "PGDELTA_CONNECTION_TIMEOUT_MS",
    DEFAULT_CONNECTION_TIMEOUT_MS,
  ),
  connectTimeoutMs: numberFromString(
    "PGDELTA_CONNECT_TIMEOUT_MS",
    DEFAULT_CONNECT_TIMEOUT_MS,
  ),
});

export const loadPgRuntimeConfig = (
  provider: ConfigProvider.ConfigProvider = ConfigProvider.fromEnv(),
  getEnv: (name: string) => string | undefined = defaultGetEnv,
): Effect.Effect<PgRuntimeConfigApi> =>
  PgRuntimeConfig.parse(provider).pipe(
    Effect.map((config) => ({
      ...config,
      getEnv,
    })),
    Effect.orDie,
  );

export const getDefaultRuntimeConfig = () =>
  Effect.runSync(loadPgRuntimeConfig(ConfigProvider.fromEnv()));

export const makePgRuntimeConfigLayer = (
  provider: ConfigProvider.ConfigProvider = ConfigProvider.fromEnv(),
  getEnv: (name: string) => string | undefined = defaultGetEnv,
) =>
  Layer.effect(PgRuntimeConfigService, loadPgRuntimeConfig(provider, getEnv));
