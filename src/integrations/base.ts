import { createEnvDependentFilter } from "./filter.ts";
import type {
  EnvDependentConfig,
  Integration,
  SensitiveFieldsConfig,
} from "./integration.types.ts";
import { createMaskingSerializer } from "./serialize.ts";

/**
 * Default env-dependent field configuration.
 * Filters known env-dependent fields (conninfo, password changes).
 */
export const defaultEnvDependent: EnvDependentConfig = {
  role: ["password"],
  subscription: ["conninfo"],
  server: [], // Don't filter any - can't know what's env-dependent for unknown FDWs
  userMapping: [], // Same
};

/**
 * Default sensitive fields configuration.
 * Masks everything for unknown FDW options, provides safe defaults.
 */
export const defaultSensitiveFields: SensitiveFieldsConfig = {
  role: {
    password: (roleName) => ({
      placeholder: "<your-password-here>",
      instruction: `Role ${roleName} requires a password to be set manually. Run: ALTER ROLE ${roleName} PASSWORD '<your-password-here>';`,
    }),
  },
  subscription: {
    conninfo: (subName) => ({
      placeholder: "__SENSITIVE_PASSWORD__",
      instruction: `Replace __SENSITIVE_PASSWORD__ in the connection string for subscription ${subName} with the actual password, or run ALTER SUBSCRIPTION ${subName} CONNECTION after this script.`,
    }),
  },
  server: {
    // Mask all options by default (safe for unknown FDWs)
    patterns: [
      {
        match: /.*/, // Match everything
        placeholder: (key, _serverName) => `__OPTION_${key.toUpperCase()}__`,
        instruction: (key, serverName) =>
          `Replace __OPTION_${key.toUpperCase()}__ with the actual ${key} value for server ${serverName}, or run ALTER SERVER ${serverName} after this script.`,
      },
    ],
  },
  userMapping: {
    patterns: [
      {
        match: /.*/, // Match everything
        placeholder: (key, _mappingId) => `__OPTION_${key.toUpperCase()}__`,
        instruction: (key, mappingId) =>
          `Replace __OPTION_${key.toUpperCase()}__ with the actual ${key} value for user mapping ${mappingId}, or run ALTER USER MAPPING after this script.`,
      },
    ],
  },
};

/**
 * Base integration with safe-by-default sensitivity handling.
 * Masks all unknown options, filters known env-dependent fields.
 */
export const base: Integration = {
  filter: createEnvDependentFilter(defaultEnvDependent),
  serialize: createMaskingSerializer(defaultSensitiveFields),
};
