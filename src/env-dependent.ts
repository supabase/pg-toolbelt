/**
 * Environment-dependent option keys per object type.
 * These are ignored during diff comparison between environments.
 */

const ENV_DEPENDENT_SERVER_OPTIONS = [
  "host",
  "hostaddr",
  "port",
  "dbname",
  "password",
  "user",
  "sslpassword",
  "sslkey",
] as const;

const ENV_DEPENDENT_USER_MAPPING_OPTIONS = ["user", "password"] as const;

/**
 * Check if a server option key is environment-dependent.
 */
function isEnvDependentServerOption(key: string): boolean {
  return ENV_DEPENDENT_SERVER_OPTIONS.some(
    (envKey) => envKey.toLowerCase() === key.toLowerCase(),
  );
}

/**
 * Check if a user mapping option key is environment-dependent.
 */
function isEnvDependentUserMappingOption(key: string): boolean {
  return ENV_DEPENDENT_USER_MAPPING_OPTIONS.some(
    (envKey) => envKey.toLowerCase() === key.toLowerCase(),
  );
}

/**
 * Filter out environment-dependent options from server option changes.
 * Used during diff to prevent ALTER statements for env-specific values.
 */
export function filterServerEnvDependentOptions(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
): Array<{
  action: "ADD" | "SET" | "DROP";
  option: string;
  value?: string;
}> {
  return options.filter((opt) => !isEnvDependentServerOption(opt.option));
}

/**
 * Filter out environment-dependent options from user mapping option changes.
 * Used during diff to prevent ALTER statements for env-specific values.
 */
export function filterUserMappingEnvDependentOptions(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
): Array<{
  action: "ADD" | "SET" | "DROP";
  option: string;
  value?: string;
}> {
  return options.filter((opt) => !isEnvDependentUserMappingOption(opt.option));
}
