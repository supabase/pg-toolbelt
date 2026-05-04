import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Procedure } from "../procedure.model.ts";
import {
  CreateProcedureChange,
  DropProcedureChange,
} from "./procedure.base.ts";

export type SecurityLabelProcedure =
  | CreateSecurityLabelOnProcedure
  | DropSecurityLabelOnProcedure;

function targetKeyword(p: Procedure): "FUNCTION" | "PROCEDURE" {
  return p.kind === "p" ? "PROCEDURE" : "FUNCTION";
}

function procedureIdentity(p: Procedure): string {
  return `${p.schema}.${p.name}(${(p.argument_types ?? []).join(",")})`;
}

export class CreateSecurityLabelOnProcedure extends CreateProcedureChange {
  public readonly procedure: Procedure;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    procedure: Procedure;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.procedure = props.procedure;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.procedure.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON",
      targetKeyword(this.procedure),
      procedureIdentity(this.procedure),
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnProcedure extends DropProcedureChange {
  public readonly procedure: Procedure;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    procedure: Procedure;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.procedure = props.procedure;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.procedure.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.procedure.stableId,
        this.securityLabel.provider,
      ),
      this.procedure.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON",
      targetKeyword(this.procedure),
      procedureIdentity(this.procedure),
      "IS NULL",
    ].join(" ");
  }
}
