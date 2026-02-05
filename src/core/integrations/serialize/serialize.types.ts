import type { Change } from "../../change.types.ts";
import type { SqlFormatOptions } from "../../format/index.ts";

export type SerializeOptions = {
  skipAuthorization?: boolean;
  format?: SqlFormatOptions;
  [key: string]: unknown;
};

export type ChangeSerializer = (change: Change) => string | undefined;
