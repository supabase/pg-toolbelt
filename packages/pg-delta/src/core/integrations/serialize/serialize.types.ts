import type { Change } from "../../change.types.ts";

/**
 * Shared serialization options passed to `change.serialize(options)`.
 *
 * This is the global source of truth for serialize-option flags used by the
 * integration serialization DSL and concrete change serializers.
 *
 * @category Integration
 */
export type SerializeOptions = {
  /** Skip `AUTHORIZATION` when serializing schema creation. */
  skipAuthorization?: boolean;
  /** Skip `WITH SCHEMA ...` when serializing extension creation. */
  skipSchema?: boolean;
};

/**
 * Schema-specific view of {@link SerializeOptions}.
 *
 * @category Integration
 */
export type SchemaSerializeOptions = Pick<
  SerializeOptions,
  "skipAuthorization"
>;

/**
 * Extension-specific view of {@link SerializeOptions}.
 *
 * @category Integration
 */
export type ExtensionSerializeOptions = Pick<SerializeOptions, "skipSchema">;

/**
 * Compiled serializer function used during plan/declarative export rendering.
 *
 * @category Integration
 */
export type ChangeSerializer = (change: Change) => string | undefined;
