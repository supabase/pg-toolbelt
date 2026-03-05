import { afterAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plugin } from "bun";
import { createInstrumenter } from "istanbul-lib-instrument";

export interface CoverageOptions {
  /**
   * Regexes tested against absolute file paths to decide which files to
   * instrument. Default: `[/\.tsx?$/]` (all TypeScript files outside
   * node_modules).
   *
   * These are also combined into the Bun plugin `onLoad` filter for
   * performance -- only files matching at least one pattern trigger the hook.
   */
  include?: RegExp[];
  /**
   * Regexes tested against absolute file paths to skip instrumentation.
   * Matching files are still loaded through the plugin hook but returned
   * unchanged. Default: `[/\.test\.tsx?$/, /\.spec\.tsx?$/]`.
   */
  exclude?: RegExp[];
  /**
   * Directory to write per-process coverage JSON files.
   * Default: `NYC_OUTPUT_DIR` env var, or `<cwd>/.nyc_output`.
   */
  outputDir?: string;
}

/**
 * Registers a Bun plugin that instruments TypeScript source files with
 * Istanbul coverage counters, and an `afterAll` hook that writes the
 * accumulated `__coverage__` object to disk as JSON.
 *
 * Must be called from a preload script (`bun test --preload`).
 */
export function setupCoverage(options: CoverageOptions = {}): void {
  const {
    include = [/\.tsx?$/],
    exclude = [/\.test\.tsx?$/, /\.spec\.tsx?$/],
    outputDir = process.env.NYC_OUTPUT_DIR ||
      join(process.cwd(), ".nyc_output"),
  } = options;

  const instrumenter = createInstrumenter({
    compact: false,
    esModules: true,
    parserPlugins: ["typescript"],
  });

  const filterRegex = new RegExp(
    include.map((re) => `(?:${re.source})`).join("|"),
  );

  plugin({
    name: "istanbul-coverage",
    setup(build) {
      build.onLoad({ filter: filterRegex }, async (args) => {
        const source = await Bun.file(args.path).text();

        if (args.path.includes("/node_modules/")) {
          return { contents: source, loader: "ts" };
        }
        if (exclude.some((re) => re.test(args.path))) {
          return { contents: source, loader: "ts" };
        }

        const instrumented = instrumenter.instrumentSync(source, args.path);
        return { contents: instrumented, loader: "ts" };
      });
    },
  });

  mkdirSync(outputDir, { recursive: true });

  afterAll(() => {
    const coverage = (globalThis as Record<string, unknown>).__coverage__;
    if (coverage) {
      writeFileSync(
        join(outputDir, `coverage-${process.pid}.json`),
        JSON.stringify(coverage),
      );
    }
  });
}
