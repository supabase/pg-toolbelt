import type { AlterMaterializedView } from "./materialized-view.alter.ts";
import type { CommentMaterializedView } from "./materialized-view.comment.ts";
import type { CreateMaterializedView } from "./materialized-view.create.ts";
import type { DropMaterializedView } from "./materialized-view.drop.ts";
import type { MaterializedViewPrivilege } from "./materialized-view.privilege.ts";

export type MaterializedViewChange =
  | AlterMaterializedView
  | CommentMaterializedView
  | CreateMaterializedView
  | DropMaterializedView
  | MaterializedViewPrivilege;
