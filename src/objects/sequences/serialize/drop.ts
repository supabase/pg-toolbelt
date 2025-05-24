import type { SequenceDefinition } from "../types.ts";

export function serializeSequenceDrop(sequence: SequenceDefinition): string {
  return `drop sequence if exists ${sequence.schema_name}.${sequence.sequence_name};`;
}
