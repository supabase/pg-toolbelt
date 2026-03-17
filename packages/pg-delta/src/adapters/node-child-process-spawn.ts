import { spawn } from "node:child_process";
import { Effect } from "effect";
import { RuntimeHostError } from "../core/errors.ts";

interface SpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
}

export const spawnAndCaptureOutput = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd: options.cwd,
          env: options.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
          if (exitCode === 0) {
            resolve(stdout);
            return;
          }

          reject(
            new Error(stderr.trim() || "Failed to generate completion script."),
          );
        });
      }),
    catch: (error) =>
      new RuntimeHostError({
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate completion script.",
      }),
  });
