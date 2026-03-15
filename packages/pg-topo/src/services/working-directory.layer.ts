import { Layer } from "effect";
import { WorkingDirectory } from "./working-directory.service.ts";

export const withWorkingDirectory = (cwd: string) =>
  Layer.succeed(WorkingDirectory, cwd);
