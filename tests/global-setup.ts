import { getContainerRuntimeClient, ImageName } from "testcontainers";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "./constants.ts";
import { containerPool } from "./container-pool.js";

export async function setup() {
  const containerRuntimeClient = await getContainerRuntimeClient();
  // pull all the images before running the tests
  const imagesSupabasePostgres = POSTGRES_VERSIONS.map(
    (postgresVersion) =>
      `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}`,
  );
  const imagesAlpinePostgres = POSTGRES_VERSIONS.map(
    (postgresVersion) =>
      `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[postgresVersion]}`,
  );

  await Promise.all([
    ...imagesSupabasePostgres.map((image) =>
      containerRuntimeClient.image.pull(ImageName.fromString(image)),
    ),
    ...imagesAlpinePostgres.map((image) =>
      containerRuntimeClient.image.pull(ImageName.fromString(image)),
    ),
  ]);

  // Container pool will be initialized lazily when first needed
}

export async function teardown() {
  // Cleanup the container pool
  await containerPool.cleanup();
}
