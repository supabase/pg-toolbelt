export const POSTGRES_VERSIONS = process.env.TEST_POSTGRES_VERSIONS
  ? process.env.TEST_POSTGRES_VERSIONS.split(",").map(Number)
  : [15, 16, 17];
