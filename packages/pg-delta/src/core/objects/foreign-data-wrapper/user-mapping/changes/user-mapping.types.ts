import type { AlterUserMapping } from "./user-mapping.alter.ts";
import type { CreateUserMapping } from "./user-mapping.create.ts";
import type { DropUserMapping } from "./user-mapping.drop.ts";

/** Union of all user-mapping-related change variants (`objectType: "user_mapping"`). @category Change Types */
export type UserMappingChange =
  | AlterUserMapping
  | CreateUserMapping
  | DropUserMapping;
