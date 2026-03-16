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

export const getRuntimeProcess = (): Effect.Effect<
  RuntimeProcess,
  RuntimeHostError
> =>
  Effect.sync(() => globalThis.process).pipe(
    Effect.flatMap((runtimeProcess) =>
      runtimeProcess
        ? Effect.succeed(runtimeProcess as unknown as RuntimeProcess)
        : Effect.fail(
            new RuntimeHostError({
              message: "pgdelta runtime requires a process-like host",
            }),
          ),
    ),
  );

export const getRuntimeEnv = (
  name: string,
): Effect.Effect<string | undefined, RuntimeHostError> =>
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
