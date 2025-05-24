export type SequenceDefinition = {
  id: string;
  schema_name: string;
  sequence_name: string;
  data_type: string;
  start_value: number;
  minimum_value: number | null;
  maximum_value: number | null;
  increment: number;
  cycle: boolean;
  cache_size: number;
};
