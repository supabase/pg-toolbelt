import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..", "..", "..");
const cliEntrypoint = join(packageRoot, "src", "cli", "bin", "cli.ts");

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunCliOptions {
  readonly stdin?: string;
  readonly env?: Record<string, string | undefined>;
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions = {},
): Promise<CliRunResult> {
  const proc = Bun.spawn({
    cmd: ["bun", cliEntrypoint, ...args],
    cwd: packageRoot,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CI: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...options.env,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}
