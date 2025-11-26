import type { Change } from "../change.types.ts";
import type { ChangeFilter, DiffContext } from "../main.ts";
import type { AlterServerSetOptions } from "../objects/foreign-data-wrapper/server/changes/server.alter.ts";
import type { AlterUserMappingSetOptions } from "../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
import { AlterSubscriptionSetConnection } from "../objects/subscription/changes/subscription.alter.ts";
import type { EnvDependentConfig } from "./integration.types.ts";

/**
 * Create a filter function that filters out env-dependent changes.
 * This filter can also mutate changes to remove env-dependent options from ALTER statements.
 */
export function createEnvDependentFilter(
  config: EnvDependentConfig,
): ChangeFilter {
  const envDependent = config;

  return (_ctx: DiffContext, change: Change): boolean => {
    // Subscription: filter if only conninfo changed
    if (
      change.objectType === "subscription" &&
      change.operation === "alter" &&
      envDependent.subscription?.includes("conninfo")
    ) {
      // AlterSubscriptionSetConnection changes are filtered out
      if (change instanceof AlterSubscriptionSetConnection) {
        return false;
      }
    }

    // Server: filter SET actions for env-dependent option keys
    if (change.objectType === "server" && change.operation === "alter") {
      const alterChange = change as AlterServerSetOptions;
      if (alterChange.options) {
        const envDependentKeys = envDependent.server;
        // If envDependent.server is undefined or empty array, filter ALL SET actions
        // (safe default for unknown FDWs - we can't know what's env-dependent)
        const filterAllSetActions =
          !envDependentKeys || envDependentKeys.length === 0;
        const envDependentKeysSet = filterAllSetActions
          ? null // null means "all SET actions"
          : new Set(envDependentKeys);

        // Filter out if all options are SET actions (and they're all env-dependent)
        const hasNonEnvDependent = alterChange.options.some(
          (opt) =>
            opt.action !== "SET" ||
            (envDependentKeysSet !== null &&
              !envDependentKeysSet.has(opt.option)),
        );
        if (!hasNonEnvDependent && alterChange.options.length > 0) {
          return false;
        }
        // Filter SET actions for env-dependent keys, keep ADD/DROP
        // If envDependentKeysSet is null, filter ALL SET actions
        // Otherwise, filter only SET actions for keys in the set
        const filteredOptions = alterChange.options.filter(
          (opt) =>
            opt.action !== "SET" ||
            (envDependentKeysSet !== null &&
              !envDependentKeysSet.has(opt.option)),
        );
        // If no options left, filter out the entire change
        if (filteredOptions.length === 0) {
          return false;
        }
        // Mutate the change to remove env-dependent options
        (
          alterChange as unknown as { options: typeof filteredOptions }
        ).options = filteredOptions;
      }
    }

    // User mapping: filter SET actions for env-dependent option keys
    if (change.objectType === "user_mapping" && change.operation === "alter") {
      const alterChange = change as AlterUserMappingSetOptions;
      if (alterChange.options) {
        const envDependentKeys = envDependent.userMapping;
        // If envDependent.userMapping is undefined or empty array, filter ALL SET actions
        // (safe default for unknown FDWs - we can't know what's env-dependent)
        const filterAllSetActions =
          !envDependentKeys || envDependentKeys.length === 0;
        const envDependentKeysSet = filterAllSetActions
          ? null // null means "all SET actions"
          : new Set(envDependentKeys);

        // Filter out if all options are SET actions (and they're all env-dependent)
        const hasNonEnvDependent = alterChange.options.some(
          (opt) =>
            opt.action !== "SET" ||
            (envDependentKeysSet !== null &&
              !envDependentKeysSet.has(opt.option)),
        );
        if (!hasNonEnvDependent && alterChange.options.length > 0) {
          return false;
        }
        // Filter SET actions for env-dependent keys, keep ADD/DROP
        // If envDependentKeysSet is null, filter ALL SET actions
        // Otherwise, filter only SET actions for keys in the set
        const filteredOptions = alterChange.options.filter(
          (opt) =>
            opt.action !== "SET" ||
            (envDependentKeysSet !== null &&
              !envDependentKeysSet.has(opt.option)),
        );
        // If no options left, filter out the entire change
        if (filteredOptions.length === 0) {
          return false;
        }
        // Mutate the change to remove env-dependent options
        (
          alterChange as unknown as { options: typeof filteredOptions }
        ).options = filteredOptions;
      }
    }

    return true;
  };
}
