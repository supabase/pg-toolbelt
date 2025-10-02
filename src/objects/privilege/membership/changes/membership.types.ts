import type { CreateMembership } from "./membership.create.ts";
import type { DropMembership } from "./membership.drop.ts";

export type MembershipChange = CreateMembership | DropMembership;
