import { Command, Flag } from "effect/unstable/cli";
import { handleApply } from "./apply.handler.ts";

const plan = Flag.string("plan").pipe(
  Flag.withAlias("p"),
  Flag.withDescription("Path to plan file (JSON format)"),
);

const source = Flag.string("source").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Source database connection URL (current state)"),
);

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription("Target database connection URL (desired state)"),
);

const unsafe = Flag.boolean("unsafe").pipe(
  Flag.withAlias("u"),
  Flag.withDescription("Allow data-loss operations (unsafe mode)"),
  Flag.withDefault(false),
);

const applyFlags = { plan, source, target, unsafe } as const;

export const applyCommand = Command.make("apply", applyFlags).pipe(
  Command.withHandler(handleApply),
);
