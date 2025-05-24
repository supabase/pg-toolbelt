import type { SequenceDefinition } from "../types.ts";

export function serializeSequenceCreate(sequence: SequenceDefinition): string {
  const parts: string[] = [];

  parts.push(
    `create sequence ${sequence.schema_name}.${sequence.sequence_name}`,
  );
  parts.push(`as ${sequence.data_type}`);
  parts.push(`start with ${sequence.start_value}`);
  parts.push(`increment by ${sequence.increment}`);

  if (sequence.minimum_value === null) {
    parts.push("no minvalue");
  } else {
    parts.push(`minvalue ${sequence.minimum_value}`);
  }

  if (sequence.maximum_value === null) {
    parts.push("no maxvalue");
  } else {
    parts.push(`maxvalue ${sequence.maximum_value}`);
  }

  parts.push(`cache ${sequence.cache_size}`);

  if (sequence.cycle) {
    parts.push("cycle");
  } else {
    parts.push("no cycle");
  }

  return parts.join("\n  ") + ";";
}
