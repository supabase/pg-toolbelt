import { afterAll } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { plugin } from "bun";
import { createInstrumenter } from "istanbul-lib-instrument";

const instrumenter = createInstrumenter({
  compact: false,
  esModules: true,
  parserPlugins: ["typescript"],
});

plugin({
  name: "istanbul-coverage",
  setup(build) {
    build.onLoad(
      { filter: /packages\/pg-(delta|topo)\/src\/.*(?<!\.test)\.ts$/ },
      async (args) => {
        const source = await Bun.file(args.path).text();
        const instrumented = instrumenter.instrumentSync(source, args.path);
        return { contents: instrumented, loader: "ts" };
      },
    );
  },
});

const nycOutput =
  process.env.NYC_OUTPUT_DIR || join(process.cwd(), ".nyc_output");
mkdirSync(nycOutput, { recursive: true });

afterAll(() => {
  const coverage = (globalThis as Record<string, unknown>).__coverage__;
  if (coverage) {
    const outFile = join(nycOutput, `coverage-${process.pid}.json`);
    writeFileSync(outFile, JSON.stringify(coverage));
  }
});
