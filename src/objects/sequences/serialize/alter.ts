import type { DiffOperation } from "../../../diff/types.ts";
import type { SequenceDefinition } from "../types.ts";

export function serializeSequenceAlter(
  operation: DiffOperation<SequenceDefinition>,
): string {
  const { object, changes } = operation;
  const { schema_name, sequence_name } = object;

  if (!changes?.length) return "";

  const statements: string[] = [];

  // Handle each property change
  changes.forEach((change) => {
    const { property, newValue } = change;

    switch (property) {
      case "data_type":
        statements.push(
          `alter sequence ${schema_name}.${sequence_name} as ${newValue};`,
        );
        break;

      case "start_value":
        statements.push(
          `alter sequence ${schema_name}.${sequence_name} restart with ${newValue};`,
        );
        break;

      case "increment":
        statements.push(
          `alter sequence ${schema_name}.${sequence_name} increment by ${newValue};`,
        );
        break;

      case "minimum_value":
        if (newValue === null) {
          statements.push(
            `alter sequence ${schema_name}.${sequence_name} no minvalue;`,
          );
        } else {
          statements.push(
            `alter sequence ${schema_name}.${sequence_name} minvalue ${newValue};`,
          );
        }
        break;

      case "maximum_value":
        if (newValue === null) {
          statements.push(
            `alter sequence ${schema_name}.${sequence_name} no maxvalue;`,
          );
        } else {
          statements.push(
            `alter sequence ${schema_name}.${sequence_name} maxvalue ${newValue};`,
          );
        }
        break;

      case "cache_size":
        statements.push(
          `alter sequence ${schema_name}.${sequence_name} cache ${newValue};`,
        );
        break;

      case "cycle":
        statements.push(
          `alter sequence ${schema_name}.${sequence_name} ${
            newValue ? "cycle" : "no cycle"
          };`,
        );
        break;
    }
  });

  return statements.join("\n");
}
