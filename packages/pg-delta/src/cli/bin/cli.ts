#!/usr/bin/env node

import { run } from "@stricli/core";
import { UnorderableCycleError } from "../../core/sort/unorderable-cycle-error.ts";
import { app } from "../app.ts";
import { getCommandExitCode } from "../exit-code.ts";

await run(app, process.argv.slice(2), { process }).catch((error) => {
  if (error instanceof UnorderableCycleError) {
    console.error(error.message);
    console.error(
      "pg-delta could not find a valid execution order for these changes. Please report this plan at https://github.com/supabase/pg-toolbelt/issues.",
    );
  } else {
    console.error(error);
  }
  process.exit(1);
});

const code = getCommandExitCode();
if (code !== undefined) {
  process.exitCode = code;
}
