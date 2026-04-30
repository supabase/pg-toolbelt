import type { AlterLanguage } from "./language.alter.ts";
import type { CommentLanguage } from "./language.comment.ts";
import type { CreateLanguage } from "./language.create.ts";
import type { DropLanguage } from "./language.drop.ts";
import type { LanguagePrivilege } from "./language.privilege.ts";

/** Union of all language-related change variants (`objectType: "language"`). @category Change Types */
export type LanguageChange =
  | AlterLanguage
  | CommentLanguage
  | CreateLanguage
  | DropLanguage
  | LanguagePrivilege;
