/**
 * Metadata about sensitive information that needs manual handling
 * in migration scripts.
 */
export interface SensitiveInfo {
  /**
   * Type of sensitive information
   */
  type:
    | "role_password"
    | "subscription_conninfo"
    | "server_option"
    | "user_mapping_option";

  /**
   * Object type (e.g., "role", "subscription", "server", "user_mapping")
   */
  objectType: string;

  /**
   * Name of the object
   */
  objectName: string;

  /**
   * Field name that contains sensitive data
   */
  field: string;

  /**
   * Placeholder value used in the migration script
   */
  placeholder: string;

  /**
   * Human-readable instruction for handling this sensitive information
   */
  instruction: string;
}
