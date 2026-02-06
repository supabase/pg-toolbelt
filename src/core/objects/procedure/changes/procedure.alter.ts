import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Procedure } from "../procedure.model.ts";
import { formatConfigValue } from "../utils.ts";
import { AlterProcedureChange } from "./procedure.base.ts";

/**
 * Alter a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterfunction.html
 *
 * Synopsis
 * ```sql
 * ALTER FUNCTION name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * ALTER PROCEDURE name ( [ [ argmode ] [ argname ] argtype [, ...] ] )
 *     action [, ... ] [ RESTRICT ]
 * where action is one of:
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 *     [ EXTERNAL ] SECURITY INVOKER | [ EXTERNAL ] SECURITY DEFINER
 *     SET configuration_parameter { TO | = } { value | DEFAULT }
 *     SET configuration_parameter FROM CURRENT
 *     RESET configuration_parameter
 *     RESET ALL
 * ```
 */

export type AlterProcedure =
  | AlterProcedureChangeOwner
  | AlterProcedureSetConfig
  | AlterProcedureSetLeakproof
  | AlterProcedureSetParallel
  | AlterProcedureSetSecurity
  | AlterProcedureSetStrictness
  | AlterProcedureSetVolatility;

/**
 * ALTER FUNCTION/PROCEDURE ... OWNER TO ...
 */
export class AlterProcedureChangeOwner extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; owner: string }) {
    super();
    this.procedure = props.procedure;
    this.owner = props.owner;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";

    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... SECURITY { INVOKER | DEFINER }
 */
export class AlterProcedureSetSecurity extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly securityDefiner: boolean;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; securityDefiner: boolean }) {
    super();
    this.procedure = props.procedure;
    this.securityDefiner = props.securityDefiner;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const security = this.securityDefiner
      ? "SECURITY DEFINER"
      : "SECURITY INVOKER"; // INVOKER is default; only emitted when changed via diff

    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword(security),
    );
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... SET/RESET configuration_parameter
 * Emits individual RESET for removed keys and SET for added/changed keys.
 */
export class AlterProcedureSetConfig extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly action: "set" | "reset" | "reset_all";
  public readonly key?: string;
  public readonly value?: string;
  public readonly scope = "object" as const;

  constructor(props: {
    procedure: Procedure;
    action: "set";
    key: string;
    value: string;
  });
  constructor(props: { procedure: Procedure; action: "reset"; key: string });
  constructor(props: { procedure: Procedure; action: "reset_all" });
  constructor(props: {
    procedure: Procedure;
    action: "set" | "reset" | "reset_all";
    key?: string;
    value?: string;
  }) {
    super();
    this.procedure = props.procedure;
    this.action = props.action;
    this.key = props.key;
    this.value = props.value;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const head = ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION"),
      `${this.procedure.schema}.${this.procedure.name}`,
    );
    if (this.action === "reset_all") return ctx.line(head, ctx.keyword("RESET ALL"));
    if (this.action === "reset") return ctx.line(head, ctx.keyword("RESET"), this.key);
    const formatted = formatConfigValue(
      this.key as string,
      this.value as string,
    );
    return ctx.line(head, ctx.keyword("SET"), this.key, ctx.keyword("TO"), formatted);
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { IMMUTABLE | STABLE | VOLATILE }
 */
export class AlterProcedureSetVolatility extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly volatility: string;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; volatility: string }) {
    super();
    this.procedure = props.procedure;
    this.volatility = props.volatility;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const volMap: Record<string, string> = {
      i: "IMMUTABLE",
      s: "STABLE",
      v: "VOLATILE",
    };
    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword(volMap[this.volatility]),
    );
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { STRICT | CALLED ON NULL INPUT }
 */
export class AlterProcedureSetStrictness extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly isStrict: boolean;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; isStrict: boolean }) {
    super();
    this.procedure = props.procedure;
    this.isStrict = props.isStrict;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const strictness = this.isStrict ? "STRICT" : "CALLED ON NULL INPUT";
    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword(strictness),
    );
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... { LEAKPROOF | NOT LEAKPROOF }
 */
export class AlterProcedureSetLeakproof extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly leakproof: boolean;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; leakproof: boolean }) {
    super();
    this.procedure = props.procedure;
    this.leakproof = props.leakproof;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const leak = this.leakproof ? "LEAKPROOF" : "NOT LEAKPROOF";
    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword(leak),
    );
  }
}

/**
 * ALTER FUNCTION/PROCEDURE ... PARALLEL { UNSAFE | RESTRICTED | SAFE }
 */
export class AlterProcedureSetParallel extends AlterProcedureChange {
  public readonly procedure: Procedure;
  public readonly parallelSafety: string;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure; parallelSafety: string }) {
    super();
    this.procedure = props.procedure;
    this.parallelSafety = props.parallelSafety;
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";
    const parallelMap: Record<string, string> = {
      u: "PARALLEL UNSAFE",
      s: "PARALLEL SAFE",
      r: "PARALLEL RESTRICTED",
    };
    return ctx.line(
      ctx.keyword("ALTER"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}`,
      ctx.keyword(parallelMap[this.parallelSafety]),
    );
  }
}

/**
 * Replace a procedure by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER FUNCTION/PROCEDURE change.
 */
// NOTE: ReplaceProcedure removed. Non-alterable changes are emitted as Drop + Create in procedure.diff.ts.
