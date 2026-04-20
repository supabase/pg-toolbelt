import type { AlterSchema } from "./schema.alter.ts";
import type { CommentSchema } from "./schema.comment.ts";
import type { CreateSchema } from "./schema.create.ts";
import type { DropSchema } from "./schema.drop.ts";
import type { SchemaPrivilege } from "./schema.privilege.ts";
import type { SecurityLabelSchema } from "./schema.security-label.ts";

export type SchemaChange =
  | AlterSchema
  | CommentSchema
  | CreateSchema
  | DropSchema
  | SchemaPrivilege
  | SecurityLabelSchema;
