import { Effect } from "effect";
import { RuntimeHostError } from "../core/errors.ts";

type RuntimeReadable = NodeJS.ReadableStream & { isTTY?: boolean };
type RuntimeWritable = NodeJS.WritableStream & { isTTY?: boolean };

interface RuntimeProcess {
  readonly argv: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
  readonly cwd: () => string;
  readonly stdin: RuntimeReadable;
  readonly stdout: RuntimeWritable;
  readonly stderr: RuntimeWritable;
  exitCode?: number;
}

function isRuntimeProcess(value: unknown): value is RuntimeProcess {
  return (
    typeof value === "object" &&
    value !== null &&
    "argv" in value &&
    "env" in value &&
    "cwd" in value
  );
}

export const getRuntimeProcess = () =>
  Effect.sync(() => globalThis.process).pipe(
    Effect.flatMap((runtimeProcess) =>
      runtimeProcess && isRuntimeProcess(runtimeProcess)
        ? Effect.succeed(runtimeProcess)
        : Effect.fail(
            new RuntimeHostError({
              message: "pgdelta runtime requires a process-like host",
            }),
          ),
    ),
  );

export const getRuntimeEnv = (name: string) =>
  getRuntimeProcess().pipe(
    Effect.map((runtimeProcess) => runtimeProcess.env[name]),
  );

export const isRuntimeCi = (runtimeProcess: RuntimeProcess): boolean => {
  const { env } = runtimeProcess;
  return (
    env.CI === "1" ||
    env.CI === "true" ||
    env.GITHUB_ACTIONS === "true" ||
    env.BUILDKITE === "true"
  );
};

export const colorsEnabledForRuntimeProcess = (
  runtimeProcess: RuntimeProcess,
  isTty: boolean,
): boolean => {
  const { env } = runtimeProcess;
  if (!isTty) {
    return false;
  }
  if (env.NO_COLOR !== undefined) {
    return false;
  }
  if (env.FORCE_COLOR !== undefined) {
    return env.FORCE_COLOR !== "0";
  }
  return !isRuntimeCi(runtimeProcess);
};
