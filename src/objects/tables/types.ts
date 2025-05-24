type ColumnDefinition = {
  name: string;
  type: string; // from pg_catalog.format_type
  nullable: boolean;
  default: string | null; // from pg_get_expr
  generated: "" | "s" | "a"; // empty string, 's' for STORED, 'a' for ALWAYS
  identity: "" | "a" | "d"; // empty string, 'a' for ALWAYS, 'd' for BY DEFAULT
};

export type TableDefinition = {
  id: string; // stable identifier: schema_name.table_name
  schema_name: string;
  table_name: string;
  table_options: string[] | null;
  columns: ColumnDefinition[];
};
