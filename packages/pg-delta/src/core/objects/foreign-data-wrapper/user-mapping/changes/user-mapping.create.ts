import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import { redactOptionValue } from "../../sensitive-options.ts";
import type { UserMapping } from "../user-mapping.model.ts";
import { CreateUserMappingChange } from "./user-mapping.base.ts";

/**
 * Create a user mapping.
 *
 * @see https://www.postgresql.org/docs/17/sql-createusermapping.html
 *
 * Synopsis
 * ```sql
 * CREATE USER MAPPING [ IF NOT EXISTS ] FOR { user_name | USER | CURRENT_ROLE | CURRENT_USER | PUBLIC | SESSION_USER }
 *     SERVER server_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateUserMapping extends CreateUserMappingChange {
  public readonly userMapping: UserMapping;
  public readonly scope = "object" as const;

  constructor(props: { userMapping: UserMapping }) {
    super();
    this.userMapping = props.userMapping;
  }

  get creates() {
    return [this.userMapping.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Server dependency
    dependencies.add(stableId.server(this.userMapping.server));

    return Array.from(dependencies);
  }

  serialize(_options?: SerializeOptions): string {
    const parts: string[] = ["CREATE USER MAPPING FOR"];

    // Add user (can be CURRENT_USER, PUBLIC, etc.)
    parts.push(this.userMapping.user);

    // Add SERVER clause
    parts.push("SERVER", this.userMapping.server);

    // Add OPTIONS clause
    if (this.userMapping.options && this.userMapping.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.userMapping.options.length; i += 2) {
        const key = this.userMapping.options[i];
        const value = this.userMapping.options[i + 1];
        if (key === undefined || value === undefined) continue;
        optionPairs.push(
          `${key} ${quoteLiteral(redactOptionValue(key, value))}`,
        );
      }
      if (optionPairs.length > 0) {
        parts.push(`OPTIONS (${optionPairs.join(", ")})`);
      }
    }

    return parts.join(" ");
  }
}
