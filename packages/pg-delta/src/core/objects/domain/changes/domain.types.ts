import type { AlterDomain } from "./domain.alter.ts";
import type { CommentDomain } from "./domain.comment.ts";
import type { CreateDomain } from "./domain.create.ts";
import type { DropDomain } from "./domain.drop.ts";
import type { DomainPrivilege } from "./domain.privilege.ts";
import type { SecurityLabelDomain } from "./domain.security-label.ts";

/** Union of all domain-related change variants (`objectType: "domain"`). @category Change Types */
export type DomainChange =
  | AlterDomain
  | CommentDomain
  | CreateDomain
  | DropDomain
  | DomainPrivilege
  | SecurityLabelDomain;
