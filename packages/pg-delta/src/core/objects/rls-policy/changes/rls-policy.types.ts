import type { AlterRlsPolicy } from "./rls-policy.alter.ts";
import type { CommentRlsPolicy } from "./rls-policy.comment.ts";
import type { CreateRlsPolicy } from "./rls-policy.create.ts";
import type { DropRlsPolicy } from "./rls-policy.drop.ts";

export type RlsPolicyChange =
  | AlterRlsPolicy
  | CommentRlsPolicy
  | CreateRlsPolicy
  | DropRlsPolicy;
