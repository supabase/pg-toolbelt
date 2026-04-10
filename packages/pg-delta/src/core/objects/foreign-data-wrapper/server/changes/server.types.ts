import type { AlterServer } from "./server.alter.ts";
import type { CommentServer } from "./server.comment.ts";
import type { CreateServer } from "./server.create.ts";
import type { DropServer } from "./server.drop.ts";
import type { ServerPrivilege } from "./server.privilege.ts";

/** Union of all server-related change variants (`objectType: "server"`). @category Change Types */
export type ServerChange =
  | AlterServer
  | CommentServer
  | CreateServer
  | DropServer
  | ServerPrivilege;
