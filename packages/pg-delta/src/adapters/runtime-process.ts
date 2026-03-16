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

export const getRuntimeProcess = (): RuntimeProcess => {
  const runtimeProcess = globalThis.process;
  if (!runtimeProcess) {
    throw new Error("pgdelta runtime requires a process-like host");
  }
  return runtimeProcess as unknown as RuntimeProcess;
};

export const getRuntimeEnv = (name: string): string | undefined =>
  getRuntimeProcess().env[name];

export const isRuntimeCi = (): boolean => {
  const env = getRuntimeProcess().env;
  return (
    env.CI === "1" ||
    env.CI === "true" ||
    env.GITHUB_ACTIONS === "true" ||
    env.BUILDKITE === "true"
  );
};

export const colorsEnabledForStream = (isTty: boolean): boolean => {
  const env = getRuntimeProcess().env;
  if (!isTty) {
    return false;
  }
  if (env.NO_COLOR !== undefined) {
    return false;
  }
  if (env.FORCE_COLOR !== undefined) {
    return env.FORCE_COLOR !== "0";
  }
  return !isRuntimeCi();
};
