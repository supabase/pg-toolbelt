import type {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "./subscription.alter.ts";
import type { CommentSubscription } from "./subscription.comment.ts";
import type { CreateSubscription } from "./subscription.create.ts";
import type { DropSubscription } from "./subscription.drop.ts";
import type { SecurityLabelSubscription } from "./subscription.security-label.ts";

/** Union of all subscription-related change variants (`objectType: "subscription"`). @category Change Types */
export type SubscriptionChange =
  | CreateSubscription
  | DropSubscription
  | AlterSubscriptionSetConnection
  | AlterSubscriptionSetPublication
  | AlterSubscriptionEnable
  | AlterSubscriptionDisable
  | AlterSubscriptionSetOptions
  | AlterSubscriptionSetOwner
  | CommentSubscription
  | SecurityLabelSubscription;
