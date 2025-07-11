import { getContainerRuntimeClient, ImageName } from "testcontainers";
import {
  POSTGRES_VERSION_TO_DOCKER_TAG,
  POSTGRES_VERSIONS,
} from "./constants.ts";

export async function setup() {
  const containerRuntimeClient = await getContainerRuntimeClient();
  // pull all the images before running the tests
  await Promise.all(
    POSTGRES_VERSIONS.map((postgresVersion) =>
      containerRuntimeClient.image.pull(
        ImageName.fromString(
          `supabase/postgres:${POSTGRES_VERSION_TO_DOCKER_TAG[postgresVersion]}`,
        ),
      ),
    ),
  );
}
