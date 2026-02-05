import { quoteLiteral } from "../../base.change.ts";
import { SqlFormatter } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import {
  parseProcedureReference,
  parseTypeString,
  stableId,
} from "../../utils.ts";
import type { Aggregate } from "../aggregate.model.ts";
import { CreateAggregateChange } from "./aggregate.base.ts";

/**
 * Create an aggregate.
 *
 * @see https://www.postgresql.org/docs/17/sql-createaggregate.html
 */
export class CreateAggregate extends CreateAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly orReplace: boolean;
  public readonly scope = "object" as const;

  constructor(props: { aggregate: Aggregate; orReplace?: boolean }) {
    super();
    this.aggregate = props.aggregate;
    this.orReplace = props.orReplace ?? false;
  }

  get creates() {
    return [this.aggregate.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.aggregate.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.aggregate.owner));

    // Transition function dependency
    const transProc = parseProcedureReference(
      this.aggregate.transition_function,
    );
    if (transProc) {
      dependencies.add(stableId.procedure(transProc.schema, transProc.name));
    }

    // State data type dependency (if user-defined)
    const stateType = parseTypeString(this.aggregate.state_data_type);
    if (stateType) {
      dependencies.add(stableId.type(stateType.schema, stateType.name));
    }

    // Final function dependency
    if (this.aggregate.final_function) {
      const finalProc = parseProcedureReference(this.aggregate.final_function);
      if (finalProc) {
        dependencies.add(stableId.procedure(finalProc.schema, finalProc.name));
      }
    }

    // Combine function dependency
    if (this.aggregate.combine_function) {
      const combineProc = parseProcedureReference(
        this.aggregate.combine_function,
      );
      if (combineProc) {
        dependencies.add(
          stableId.procedure(combineProc.schema, combineProc.name),
        );
      }
    }

    // Serial function dependency
    if (this.aggregate.serial_function) {
      const serialProc = parseProcedureReference(
        this.aggregate.serial_function,
      );
      if (serialProc) {
        dependencies.add(
          stableId.procedure(serialProc.schema, serialProc.name),
        );
      }
    }

    // Deserial function dependency
    if (this.aggregate.deserial_function) {
      const deserialProc = parseProcedureReference(
        this.aggregate.deserial_function,
      );
      if (deserialProc) {
        dependencies.add(
          stableId.procedure(deserialProc.schema, deserialProc.name),
        );
      }
    }

    // Moving transition function dependency
    if (this.aggregate.moving_transition_function) {
      const movingTransProc = parseProcedureReference(
        this.aggregate.moving_transition_function,
      );
      if (movingTransProc) {
        dependencies.add(
          stableId.procedure(movingTransProc.schema, movingTransProc.name),
        );
      }
    }

    // Moving inverse function dependency
    if (this.aggregate.moving_inverse_function) {
      const movingInvProc = parseProcedureReference(
        this.aggregate.moving_inverse_function,
      );
      if (movingInvProc) {
        dependencies.add(
          stableId.procedure(movingInvProc.schema, movingInvProc.name),
        );
      }
    }

    // Moving state data type dependency (if user-defined)
    if (this.aggregate.moving_state_data_type) {
      const movingStateType = parseTypeString(
        this.aggregate.moving_state_data_type,
      );
      if (movingStateType) {
        dependencies.add(
          stableId.type(movingStateType.schema, movingStateType.name),
        );
      }
    }

    // Moving final function dependency
    if (this.aggregate.moving_final_function) {
      const movingFinalProc = parseProcedureReference(
        this.aggregate.moving_final_function,
      );
      if (movingFinalProc) {
        dependencies.add(
          stableId.procedure(movingFinalProc.schema, movingFinalProc.name),
        );
      }
    }

    // Return type dependency (if user-defined)
    if (this.aggregate.return_type_schema) {
      const returnType = parseTypeString(this.aggregate.return_type);
      if (returnType) {
        dependencies.add(stableId.type(returnType.schema, returnType.name));
      }
    }

    // Argument type dependencies (if user-defined)
    if (this.aggregate.argument_types) {
      for (const argType of this.aggregate.argument_types) {
        const parsedType = parseTypeString(argType);
        if (parsedType) {
          dependencies.add(stableId.type(parsedType.schema, parsedType.name));
        }
      }
    }

    // Note: Sort operator dependencies are complex (they reference operators which
    // may reference types/functions). For now, we rely on pg_depend for these.

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const head = [
      "CREATE",
      this.orReplace ? "OR REPLACE" : null,
      "AGGREGATE",
      `${qualifiedName}${signature ? `(${signature})` : "()"}`,
    ]
      .filter(Boolean)
      .join(" ");

    const clauses: string[] = [];

    clauses.push(`SFUNC = ${formatProc(this.aggregate.transition_function)}`);
    clauses.push(`STYPE = ${this.aggregate.state_data_type}`);

    if (this.aggregate.state_data_space > 0) {
      clauses.push(`SSPACE = ${this.aggregate.state_data_space}`);
    }

    if (this.aggregate.final_function) {
      clauses.push(`FINALFUNC = ${formatProc(this.aggregate.final_function)}`);
    }
    if (this.aggregate.final_function_extra_args) {
      clauses.push("FINALFUNC_EXTRA");
    }
    // Only include FINALFUNC_MODIFY if it's explicitly set to a non-default value
    // PostgreSQL defaults to 'r' (READ_ONLY) when not specified
    if (
      this.aggregate.final_function_modify &&
      this.aggregate.final_function_modify !== "r"
    ) {
      clauses.push(
        `FINALFUNC_MODIFY = ${formatModify(this.aggregate.final_function_modify)}`,
      );
    }

    if (this.aggregate.combine_function) {
      clauses.push(
        `COMBINEFUNC = ${formatProc(this.aggregate.combine_function)}`,
      );
    }
    if (this.aggregate.serial_function) {
      clauses.push(
        `SERIALFUNC = ${formatProc(this.aggregate.serial_function)}`,
      );
    }
    if (this.aggregate.deserial_function) {
      clauses.push(
        `DESERIALFUNC = ${formatProc(this.aggregate.deserial_function)}`,
      );
    }

    if (this.aggregate.initial_condition !== null) {
      clauses.push(
        `INITCOND = ${quoteLiteral(this.aggregate.initial_condition)}`,
      );
    }

    if (this.aggregate.moving_transition_function) {
      clauses.push(
        `MSFUNC = ${formatProc(this.aggregate.moving_transition_function)}`,
      );
    }
    if (this.aggregate.moving_inverse_function) {
      clauses.push(
        `MINVFUNC = ${formatProc(this.aggregate.moving_inverse_function)}`,
      );
    }
    if (this.aggregate.moving_state_data_type) {
      clauses.push(`MSTYPE = ${this.aggregate.moving_state_data_type}`);
    }
    if (
      this.aggregate.moving_state_data_space &&
      this.aggregate.moving_state_data_space > 0
    ) {
      clauses.push(`MSSPACE = ${this.aggregate.moving_state_data_space}`);
    }
    if (this.aggregate.moving_final_function) {
      clauses.push(
        `MFINALFUNC = ${formatProc(this.aggregate.moving_final_function)}`,
      );
    }
    if (this.aggregate.moving_final_function_extra_args) {
      clauses.push("MFINALFUNC_EXTRA");
    }
    // Only include MFINALFUNC_MODIFY if it's explicitly set to a non-default value
    // PostgreSQL defaults to 'r' (READ_ONLY) when not specified
    if (
      this.aggregate.moving_final_function_modify &&
      this.aggregate.moving_final_function_modify !== "r"
    ) {
      clauses.push(
        `MFINALFUNC_MODIFY = ${formatModify(this.aggregate.moving_final_function_modify)}`,
      );
    }
    if (this.aggregate.moving_initial_condition !== null) {
      clauses.push(
        `MINITCOND = ${quoteLiteral(this.aggregate.moving_initial_condition)}`,
      );
    }

    if (this.aggregate.sort_operator) {
      clauses.push(`SORTOP = ${formatOperator(this.aggregate.sort_operator)}`);
    }

    if (this.aggregate.parallel_safety !== "u") {
      clauses.push(
        `PARALLEL ${formatParallel(this.aggregate.parallel_safety)}`,
      );
    }

    if (this.aggregate.is_strict) {
      clauses.push("STRICT");
    }

    if (this.aggregate.aggkind === "h") {
      clauses.push("HYPOTHETICAL");
    }

    const body = clauses.length ? `(${clauses.join(", ")})` : "()";

    return `${head} ${body}`;
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const headTokens: string[] = [formatter.keyword("CREATE")];

    if (this.orReplace) {
      headTokens.push(
        formatter.keyword("OR"),
        formatter.keyword("REPLACE"),
      );
    }

    headTokens.push(
      formatter.keyword("AGGREGATE"),
      `${qualifiedName}${signature ? `(${signature})` : "()"}`,
    );

    const clauses: string[] = [];

    clauses.push(
      `${formatter.keyword("SFUNC")} = ${formatProc(
        this.aggregate.transition_function,
      )}`,
    );
    clauses.push(
      `${formatter.keyword("STYPE")} = ${this.aggregate.state_data_type}`,
    );

    if (this.aggregate.state_data_space > 0) {
      clauses.push(
        `${formatter.keyword("SSPACE")} = ${this.aggregate.state_data_space}`,
      );
    }

    if (this.aggregate.final_function) {
      clauses.push(
        `${formatter.keyword("FINALFUNC")} = ${formatProc(
          this.aggregate.final_function,
        )}`,
      );
    }
    if (this.aggregate.final_function_extra_args) {
      clauses.push(formatter.keyword("FINALFUNC_EXTRA"));
    }
    if (
      this.aggregate.final_function_modify &&
      this.aggregate.final_function_modify !== "r"
    ) {
      clauses.push(
        `${formatter.keyword("FINALFUNC_MODIFY")} = ${formatModifyWithCase(
          this.aggregate.final_function_modify,
          formatter,
        )}`,
      );
    }

    if (this.aggregate.combine_function) {
      clauses.push(
        `${formatter.keyword("COMBINEFUNC")} = ${formatProc(
          this.aggregate.combine_function,
        )}`,
      );
    }
    if (this.aggregate.serial_function) {
      clauses.push(
        `${formatter.keyword("SERIALFUNC")} = ${formatProc(
          this.aggregate.serial_function,
        )}`,
      );
    }
    if (this.aggregate.deserial_function) {
      clauses.push(
        `${formatter.keyword("DESERIALFUNC")} = ${formatProc(
          this.aggregate.deserial_function,
        )}`,
      );
    }

    if (this.aggregate.initial_condition !== null) {
      clauses.push(
        `${formatter.keyword("INITCOND")} = ${quoteLiteral(
          this.aggregate.initial_condition,
        )}`,
      );
    }

    if (this.aggregate.moving_transition_function) {
      clauses.push(
        `${formatter.keyword("MSFUNC")} = ${formatProc(
          this.aggregate.moving_transition_function,
        )}`,
      );
    }
    if (this.aggregate.moving_inverse_function) {
      clauses.push(
        `${formatter.keyword("MINVFUNC")} = ${formatProc(
          this.aggregate.moving_inverse_function,
        )}`,
      );
    }
    if (this.aggregate.moving_state_data_type) {
      clauses.push(
        `${formatter.keyword("MSTYPE")} = ${this.aggregate.moving_state_data_type}`,
      );
    }
    if (
      this.aggregate.moving_state_data_space &&
      this.aggregate.moving_state_data_space > 0
    ) {
      clauses.push(
        `${formatter.keyword("MSSPACE")} = ${this.aggregate.moving_state_data_space}`,
      );
    }
    if (this.aggregate.moving_final_function) {
      clauses.push(
        `${formatter.keyword("MFINALFUNC")} = ${formatProc(
          this.aggregate.moving_final_function,
        )}`,
      );
    }
    if (this.aggregate.moving_final_function_extra_args) {
      clauses.push(formatter.keyword("MFINALFUNC_EXTRA"));
    }
    if (
      this.aggregate.moving_final_function_modify &&
      this.aggregate.moving_final_function_modify !== "r"
    ) {
      clauses.push(
        `${formatter.keyword("MFINALFUNC_MODIFY")} = ${formatModifyWithCase(
          this.aggregate.moving_final_function_modify,
          formatter,
        )}`,
      );
    }
    if (this.aggregate.moving_initial_condition !== null) {
      clauses.push(
        `${formatter.keyword("MINITCOND")} = ${quoteLiteral(
          this.aggregate.moving_initial_condition,
        )}`,
      );
    }

    if (this.aggregate.sort_operator) {
      clauses.push(
        `${formatter.keyword("SORTOP")} = ${formatOperatorWithCase(
          this.aggregate.sort_operator,
          formatter,
        )}`,
      );
    }

    if (this.aggregate.parallel_safety !== "u") {
      clauses.push(
        `${formatter.keyword("PARALLEL")} ${formatParallelWithCase(
          this.aggregate.parallel_safety,
          formatter,
        )}`,
      );
    }

    if (this.aggregate.is_strict) {
      clauses.push(formatter.keyword("STRICT"));
    }

    if (this.aggregate.aggkind === "h") {
      clauses.push(formatter.keyword("HYPOTHETICAL"));
    }

    const body = clauses.length
      ? formatter.parens(
          `${formatter.indent(1)}${formatter.list(clauses, 1)}`,
          true,
        )
      : "()";

    return `${headTokens.join(" ")} ${body}`;
  }
}

function formatProc(proc: string): string {
  const idx = proc.indexOf("(");
  return idx === -1 ? proc : proc.slice(0, idx);
}

function formatOperator(op: string): string {
  const idx = op.indexOf("(");
  const qualified = idx === -1 ? op : op.slice(0, idx);
  return `OPERATOR(${qualified})`;
}

function formatModify(code: string): string {
  switch (code) {
    case "r":
      return "READ_ONLY";
    case "s":
      return "SHAREABLE";
    case "w":
      return "READ_WRITE";
    default:
      return code;
  }
}

function formatParallel(code: string): string {
  switch (code) {
    case "s":
      return "SAFE";
    case "r":
      return "RESTRICTED";
    default:
      return "UNSAFE";
  }
}

function formatOperatorWithCase(op: string, formatter: SqlFormatter): string {
  const idx = op.indexOf("(");
  const qualified = idx === -1 ? op : op.slice(0, idx);
  return `${formatter.keyword("OPERATOR")}(${qualified})`;
}

function formatModifyWithCase(code: string, formatter: SqlFormatter): string {
  switch (code) {
    case "r":
      return formatter.keyword("READ_ONLY");
    case "s":
      return formatter.keyword("SHAREABLE");
    case "w":
      return formatter.keyword("READ_WRITE");
    default:
      return formatter.keyword(code);
  }
}

function formatParallelWithCase(code: string, formatter: SqlFormatter): string {
  switch (code) {
    case "s":
      return formatter.keyword("SAFE");
    case "r":
      return formatter.keyword("RESTRICTED");
    default:
      return formatter.keyword("UNSAFE");
  }
}
