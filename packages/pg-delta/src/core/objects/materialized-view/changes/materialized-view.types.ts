import type { AlterMaterializedView } from "./materialized-view.alter.ts";
import type { CommentMaterializedView } from "./materialized-view.comment.ts";
import type { CreateMaterializedView } from "./materialized-view.create.ts";
import type { DropMaterializedView } from "./materialized-view.drop.ts";
import type { MaterializedViewPrivilege } from "./materialized-view.privilege.ts";

/** Union of all materialized-view-related change variants (`objectType: "materialized_view"`). @category Change Types */
export type MaterializedViewChange =
  | AlterMaterializedView
  | CommentMaterializedView
  | CreateMaterializedView
  | DropMaterializedView
  | MaterializedViewPrivilege;
