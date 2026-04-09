import type { AlterRlsPolicy } from "./rls-policy.alter.ts";
import type { CommentRlsPolicy } from "./rls-policy.comment.ts";
import type { CreateRlsPolicy } from "./rls-policy.create.ts";
import type { DropRlsPolicy } from "./rls-policy.drop.ts";

/** Union of all RLS policy-related change variants (`objectType: "rls_policy"`). @category Change Types */
export type RlsPolicyChange =
  | AlterRlsPolicy
  | CommentRlsPolicy
  | CreateRlsPolicy
  | DropRlsPolicy;
