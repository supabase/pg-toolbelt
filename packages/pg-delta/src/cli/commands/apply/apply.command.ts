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
  Command.withShortDescription("Apply a saved migration plan"),
  Command.withDescription(
    "Read a previously generated plan artifact, verify it against the source and target databases, and execute the SQL statements in order. This command does not compute a diff; use `plan` first when you need to create or review the plan file.",
  ),
  Command.withExamples([
    {
      command:
        "pgdelta apply --plan plan.json --source postgresql://user:pass@localhost:5432/source_db --target postgresql://user:pass@localhost:5432/target_db",
      description: "Apply a reviewed plan file to the target database",
    },
    {
      command:
        "pgdelta apply --plan destructive.plan.json --source postgresql://user:pass@localhost:5432/source_db --target postgresql://user:pass@localhost:5432/target_db --unsafe",
      description:
        "Allow execution of a plan that contains data-loss operations",
    },
  ]),
);
