import type { ForeignDataWrapperChange as FDWChange } from "./foreign-data-wrapper/changes/foreign-data-wrapper.types.ts";
import type { ForeignTableChange } from "./foreign-table/changes/foreign-table.types.ts";
import type { ServerChange } from "./server/changes/server.types.ts";
import type { UserMappingChange } from "./user-mapping/changes/user-mapping.types.ts";

/** Union of all foreign-data-wrapper-related change variants (`objectType: "foreign_data_wrapper" | "server" | "foreign_table" | "user_mapping"`). @category Change Types */
export type ForeignDataWrapperChange =
  | FDWChange
  | ServerChange
  | UserMappingChange
  | ForeignTableChange;
