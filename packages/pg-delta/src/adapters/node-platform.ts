import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import * as NodeTerminal from "@effect/platform-node/NodeTerminal";
import { Layer } from "effect";

export const nodeFileSystemPathLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
);

const nodeCliBaseLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  NodeStdio.layer,
  NodeTerminal.layer,
);

export const nodeCliPlatformLayer = Layer.mergeAll(
  nodeCliBaseLayer,
  NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(nodeCliBaseLayer)),
);
