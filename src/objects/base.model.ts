export abstract class BasePgModel {
  /**
   * Database-portable stable identifier for dependency resolution.
   * This identifier remains constant across database dumps/restores and
   * is used for cross-database dependency resolution.
   */
  abstract get stableId(): string;

  /**
   * Get all identity fields and their values.
   * Subclasses should override this to return the identity fields.
   */
  abstract get identityFields(): Record<string, unknown>;

  /**
   * Get all data fields and their values.
   * Subclasses should override this to return the data fields.
   */
  abstract get dataFields(): Record<string, unknown>;

  /**
   * Compare this object with another BasePgModel for equality based on stableId and dataFields.
   */
  equals(other: BasePgModel): boolean {
    return (
      this.stableId === other.stableId &&
      JSON.stringify(this.dataFields) === JSON.stringify(other.dataFields)
    );
  }
}
