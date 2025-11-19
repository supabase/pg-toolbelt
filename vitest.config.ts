import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    slowTestThreshold: 10_000,
    coverage: {
      // Also report coverage if some tests fail
      reportOnFailure: true,
      reporter: ["text", "lcov", "html"],
      // Vitest 4.0: coverage.all and coverage.extensions removed
      // Only include files that are loaded during test run (or specify include pattern)
      // For integration tests, you typically don't need coverage, so this is fine
    },
    projects: [
      {
        extends: true,
        test: {
          // Unit tests - run with full parallelism for maximum speed
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          pool: "threads", // Full parallelism for unit tests
        },
      },
      {
        extends: true,
        test: {
          // Integration tests - run with forks to share containers via ContainerManager
          name: "integration",
          globalSetup: ["./tests/global-setup.ts"],
          include: [
            "tests/integration/**/*.test.ts",
            "**/*.integration.test.ts",
          ],
          retry: process.env.CI ? 1 : 0,
          pool: "forks",
          isolate: false, // Share ContainerManager singleton across workers
          sequence: {
            concurrent: true, // Run tests concurrently within each worker
          },
        },
      },
      {
        extends: true,
        test: {
          // Unit tests - run with full parallelism for maximum speed
          name: "supabase",
          include: ["tests/supabase/supabase.test.ts"],
        },
      },
    ],
  },
});
