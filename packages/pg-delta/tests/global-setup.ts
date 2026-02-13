import { getContainerRuntimeClient, ImageName } from "testcontainers";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "./constants.ts";
import { containerManager } from "./container-manager.ts";

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

// Pre-create shared containers so tests don't pay lazy-init cost.
// Essential for concurrent execution — prevents races to initialize the same container.
await containerManager.initialize(POSTGRES_VERSIONS);
