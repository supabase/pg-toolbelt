import type { AlterAggregate } from "./aggregate.alter.ts";
import type { CommentAggregate } from "./aggregate.comment.ts";
import type { CreateAggregate } from "./aggregate.create.ts";
import type { DropAggregate } from "./aggregate.drop.ts";
import type { AggregatePrivilege } from "./aggregate.privilege.ts";
import type { SecurityLabelAggregate } from "./aggregate.security-label.ts";

/** Union of all aggregate-related change variants (`objectType: "aggregate"`). @category Change Types */
export type AggregateChange =
  | AlterAggregate
  | CommentAggregate
  | CreateAggregate
  | DropAggregate
  | AggregatePrivilege
  | SecurityLabelAggregate;
