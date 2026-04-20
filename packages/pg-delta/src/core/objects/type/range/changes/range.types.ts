import type { AlterRange } from "./range.alter.ts";
import type { CommentRange } from "./range.comment.ts";
import type { CreateRange } from "./range.create.ts";
import type { DropRange } from "./range.drop.ts";
import type { RangePrivilege } from "./range.privilege.ts";
import type { SecurityLabelRange } from "./range.security-label.ts";

export type RangeChange =
  | AlterRange
  | CommentRange
  | CreateRange
  | DropRange
  | RangePrivilege
  | SecurityLabelRange;
