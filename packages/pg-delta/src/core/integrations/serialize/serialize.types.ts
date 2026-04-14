import type { Change } from "../../change.types.ts";

export type SerializeOptions = {
  skipAuthorization?: boolean;
  skipSchema?: boolean;
};

export type SchemaSerializeOptions = Pick<
  SerializeOptions,
  "skipAuthorization"
>;

export type ExtensionSerializeOptions = Pick<SerializeOptions, "skipSchema">;

export type ChangeSerializer = (change: Change) => string | undefined;
