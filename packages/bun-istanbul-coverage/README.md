# @supabase/bun-istanbul-coverage

Drop-in Bun preload plugin that replaces Bun's built-in JSC coverage with [Istanbul](https://istanbul.js.org/) source instrumentation. You get deterministic, correct coverage with no JSC artifacts — just `bun test --preload` and `nyc report`.

## Why?

Bun's built-in coverage (JSC) has two known issues:

- **Phantom zero-hit lines** — structural lines like `} else {` are reported as 0 hits even when the branch executes.
- **Non-deterministic line sets** — different processes instrument slightly different sets of lines for the same file, making merged coverage unreliable.

Istanbul instruments code at the AST level *before* execution, so every process sees identical instrumented code and only executable lines are counted.

## Quick start

```bash
# Install
bun add -d @supabase/bun-istanbul-coverage nyc
```

Create a `.nycrc.json` at your project root:

```json
{
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts"],
  "temp-dir": ".nyc_output",
  "report-dir": "coverage",
  "reporter": ["lcov", "text"]
}
```

Run tests with coverage:

```bash
bun test --preload @supabase/bun-istanbul-coverage/preload
```

Generate the report:

```bash
npx nyc report
```

That's it. Coverage JSON files are written to `.nyc_output/` during the test run, and `nyc report` reads them to produce lcov, text, or HTML reports.

## How it works

1. A Bun `plugin()` registers an `onLoad` hook that intercepts `.ts`/`.tsx` file loading.
2. Each matched file is parsed by `istanbul-lib-instrument` (which uses `@babel/parser` with TypeScript support) and coverage counters are inserted into the AST.
3. The instrumented code is returned with `loader: "ts"` so Bun handles final compilation.
4. After all tests complete, an `afterAll` hook writes `globalThis.__coverage__` to a JSON file in the output directory.

## Programmatic API

For custom setups, import `setupCoverage` and call it from your own preload script:

```typescript
// my-coverage-preload.ts
import { setupCoverage } from "@supabase/bun-istanbul-coverage";

setupCoverage({
  include: [/src\/.*\.ts$/],
  exclude: [/\.test\.ts$/, /\.spec\.ts$/],
  outputDir: ".nyc_output",
});
```

```bash
bun test --preload ./my-coverage-preload.ts
```

### Resolving the preload path in a test runner script

When you spawn `bun test` from a script (e.g. a custom test runner), `--preload` must be an absolute file path; Bun does not resolve bare specifiers there. Use `import.meta.resolve()` and convert the URL to a path:

```typescript
import { fileURLToPath } from "node:url";

const preload = fileURLToPath(
  import.meta.resolve("@supabase/bun-istanbul-coverage/preload"),
);

Bun.spawn({
  cmd: ["bun", "test", "--preload", preload, ...],
});
```

### `setupCoverage(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `RegExp[]` | `[/\.tsx?$/]` | Regexes tested against absolute file paths. Only matching files are instrumented. |
| `exclude` | `RegExp[]` | `[/\.test\.tsx?$/, /\.spec\.tsx?$/]` | Regexes tested against absolute file paths. Matching files are skipped. |
| `outputDir` | `string` | `NYC_OUTPUT_DIR` env or `<cwd>/.nyc_output` | Directory where per-process coverage JSON files are written. |

## Environment variables

| Variable | Description |
|---|---|
| `NYC_OUTPUT_DIR` | Override the output directory for coverage JSON files. |
| `BUN_COVERAGE` | Convention (not read by this package) — set to `"1"` in your test runner to conditionally add the `--preload` flag. |

## CI integration

Each CI job runs tests with the preload and uploads `.nyc_output/` as an artifact. A final job downloads all artifacts into a single `.nyc_output/` and runs `nyc report`.

```yaml
# In each test job:
- name: Run tests
  env:
    BUN_COVERAGE: "1"
  run: bun test --preload @supabase/bun-istanbul-coverage/preload

- name: Upload coverage
  uses: actions/upload-artifact@v4
  with:
    name: coverage-${{ matrix.name }}
    path: .nyc_output/

# In the coverage job:
- name: Download all coverage
  uses: actions/download-artifact@v4
  with:
    pattern: coverage-*
    path: .nyc_output/
    merge-multiple: true

- name: Generate report
  run: npx nyc report
```

## Limitations

- **`bun test` only** — uses `afterAll` from `bun:test` to collect coverage. `process.on("exit")` does not fire reliably in `bun test`.
- **TypeScript/TSX only** — the Istanbul instrumenter is configured with `parserPlugins: ["typescript"]`. JavaScript files pass through unchanged.
- **No source maps** — coverage maps to the original TypeScript line numbers (which is usually what you want), but Istanbul's source map support is not wired up.

## License

MIT
