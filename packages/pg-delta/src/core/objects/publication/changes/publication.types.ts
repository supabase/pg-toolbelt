import type {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetList,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "./publication.alter.ts";
import type { CommentPublication } from "./publication.comment.ts";
import type { CreatePublication } from "./publication.create.ts";
import type { DropPublication } from "./publication.drop.ts";
import type { SecurityLabelPublication } from "./publication.security-label.ts";

/** Union of all publication-related change variants (`objectType: "publication"`). @category Change Types */
export type PublicationChange =
  | AlterPublicationAddSchemas
  | AlterPublicationAddTables
  | AlterPublicationDropSchemas
  | AlterPublicationDropTables
  | AlterPublicationSetList
  | AlterPublicationSetOptions
  | AlterPublicationSetOwner
  | CommentPublication
  | CreatePublication
  | DropPublication
  | SecurityLabelPublication;
