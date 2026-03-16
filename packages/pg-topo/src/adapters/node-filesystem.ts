import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Layer } from "effect";
import { withWorkingDirectory } from "../services/working-directory.layer.ts";

export const nodeFileSystemLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
);

export const makeNodeFileSystemRuntimeLayer = (cwd: string) =>
  Layer.mergeAll(nodeFileSystemLayer, withWorkingDirectory(cwd));

export const makeDefaultNodeFileSystemRuntimeLayer = () =>
  makeNodeFileSystemRuntimeLayer(process.cwd());
