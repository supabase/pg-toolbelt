import { BaseChange } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";

abstract class BaseProcedureChange extends BaseChange {
  abstract readonly procedure: Procedure;
  abstract readonly scope:
    | "object"
    | "comment"
    | "privilege"
    | "security_label";
  readonly objectType: "procedure" = "procedure";
}

export abstract class CreateProcedureChange extends BaseProcedureChange {
  readonly operation = "create" as const;
}

export abstract class AlterProcedureChange extends BaseProcedureChange {
  readonly operation = "alter" as const;
}

export abstract class DropProcedureChange extends BaseProcedureChange {
  readonly operation = "drop" as const;
}
