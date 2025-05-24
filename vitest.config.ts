import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests in parallel
    pool: "threads",
    // Use 4 threads by default (adjust based on your CPU)
    poolOptions: {
      threads: {
        maxThreads: 4,
      },
    },
    // Run tests in parallel within a file
    sequence: {
      shuffle: true,
    },
  },
});
