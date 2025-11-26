import type { Change } from "../change.types.ts";
import type { ChangeSerializer, DiffContext } from "../main.ts";
import { AlterServerSetOptions } from "../objects/foreign-data-wrapper/server/changes/server.alter.ts";
import { CreateServer } from "../objects/foreign-data-wrapper/server/changes/server.create.ts";
import { Server } from "../objects/foreign-data-wrapper/server/server.model.ts";
import { AlterUserMappingSetOptions } from "../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
import { CreateUserMapping } from "../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.create.ts";
import { UserMapping } from "../objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { CreateRole } from "../objects/role/changes/role.create.ts";
import { AlterSubscriptionSetConnection } from "../objects/subscription/changes/subscription.alter.ts";
import { CreateSubscription } from "../objects/subscription/changes/subscription.create.ts";
import { Subscription } from "../objects/subscription/subscription.model.ts";
import type { SensitiveFieldsConfig } from "./integration.types.ts";

/**
 * Create a serialize function that applies masking to sensitive fields.
 */
export function createMaskingSerializer(
  config: SensitiveFieldsConfig,
): ChangeSerializer {
  const sensitiveFields = config;

  return (_ctx: DiffContext, change: Change): string | undefined => {
    let maskedChange: Change | null = null;
    let warningComment = "";

    // Apply masking based on change type by creating masked change instances
    if (change instanceof CreateRole) {
      if (change.role.can_login && sensitiveFields.role?.password) {
        const config = sensitiveFields.role.password(change.role.name);
        warningComment = `-- WARNING: Role requires password to be set manually\n-- Run: ALTER ROLE ${change.role.name} PASSWORD '${config.placeholder}';\n`;
        // No change instance needed - just add comment
      }
    }

    if (change instanceof CreateSubscription) {
      if (sensitiveFields.subscription?.conninfo) {
        const masked = maskConninfo(change.subscription.conninfo);
        if (masked.hadPassword) {
          warningComment = `-- WARNING: Connection string contains sensitive password\n-- Replace __SENSITIVE_PASSWORD__ in the connection string with the actual password, or run ALTER SUBSCRIPTION ${change.subscription.name} CONNECTION after this script\n`;
          // Create masked subscription and change instance
          const maskedSubscription = new Subscription({
            name: change.subscription.name,
            ...change.subscription.dataFields,
            conninfo: masked.masked,
          });
          maskedChange = new CreateSubscription({
            subscription: maskedSubscription,
          });
        }
      }
    }

    if (change instanceof AlterSubscriptionSetConnection) {
      if (change.subscription && sensitiveFields.subscription?.conninfo) {
        const masked = maskConninfo(change.subscription.conninfo);
        if (masked.hadPassword) {
          warningComment = `-- WARNING: Connection string contains sensitive password\n-- Replace __SENSITIVE_PASSWORD__ in the connection string with the actual password before executing\n`;
          // Create masked subscription and change instance
          const maskedSubscription = new Subscription({
            name: change.subscription.name,
            ...change.subscription.dataFields,
            conninfo: masked.masked,
          });
          maskedChange = new AlterSubscriptionSetConnection({
            subscription: maskedSubscription,
          });
        }
      }
    }

    if (change instanceof CreateServer) {
      if (
        change.server.options &&
        change.server.options.length > 0 &&
        sensitiveFields.server
      ) {
        const masked = maskServerOptions(
          change.server.options,
          change.server.name,
          sensitiveFields.server,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: Server contains options (${optionKeys})\n-- Replace the placeholders in the OPTIONS clause with actual values, or run ALTER SERVER ${change.server.name} after this script\n`;
          // Create masked server and change instance
          const maskedServer = new Server({
            ...change.server.dataFields,
            name: change.server.name,
            options: masked.masked,
          });
          maskedChange = new CreateServer({ server: maskedServer });
        }
      }
    }

    if (change instanceof AlterServerSetOptions) {
      if (change.options && sensitiveFields.server) {
        const masked = maskServerOptionsInAlter(
          change.options,
          change.server.name,
          sensitiveFields.server,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: Server options contain values (${optionKeys})\n-- Replace the placeholders in the OPTIONS clause with actual values before executing\n`;
          // Create masked change instance with masked options
          maskedChange = new AlterServerSetOptions({
            server: change.server,
            options: masked.masked,
          });
        }
      }
    }

    if (change instanceof CreateUserMapping) {
      if (
        change.userMapping.options &&
        change.userMapping.options.length > 0 &&
        sensitiveFields.userMapping
      ) {
        const mappingId = `${change.userMapping.server}:${change.userMapping.user}`;
        const masked = maskUserMappingOptions(
          change.userMapping.options,
          mappingId,
          sensitiveFields.userMapping,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: User mapping contains options (${optionKeys})\n-- Replace the placeholders in the OPTIONS clause with actual values, or run ALTER USER MAPPING after this script\n`;
          // Create masked user mapping and change instance
          const maskedUserMapping = new UserMapping({
            ...change.userMapping.dataFields,
            user: change.userMapping.user,
            server: change.userMapping.server,
            options: masked.masked,
          });
          maskedChange = new CreateUserMapping({
            userMapping: maskedUserMapping,
          });
        }
      }
    }

    if (change instanceof AlterUserMappingSetOptions) {
      if (change.options && sensitiveFields.userMapping) {
        const mappingId = `${change.userMapping.server}:${change.userMapping.user}`;
        const masked = maskUserMappingOptionsInAlter(
          change.options,
          mappingId,
          sensitiveFields.userMapping,
        );
        if (masked.fields.length > 0) {
          const optionKeys = masked.fields.map((f) => f.field).join(", ");
          warningComment = `-- WARNING: User mapping options contain values (${optionKeys})\n-- Replace the placeholders in the OPTIONS clause with actual values before executing\n`;
          // Create masked change instance with masked options
          maskedChange = new AlterUserMappingSetOptions({
            userMapping: change.userMapping,
            options: masked.masked,
          });
        }
      }
    }

    // If masking was applied, serialize the masked change and add warning comment
    if (maskedChange || warningComment) {
      const sql = maskedChange ? maskedChange.serialize() : change.serialize();
      return warningComment + sql;
    }

    // Return undefined if no masking was applied (fall back to default serialize)
    return undefined;
  };
}

/**
 * Mask password in conninfo string
 */
function maskConninfo(conninfo: string): {
  masked: string;
  hadPassword: boolean;
} {
  const passwordPattern = /password\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s]+))/gi;
  let hadPassword = false;
  const masked = conninfo.replace(passwordPattern, () => {
    hadPassword = true;
    return "password=__SENSITIVE_PASSWORD__";
  });
  return { masked, hadPassword };
}

/**
 * Mask server options based on sensitivity config
 */
function maskServerOptions(
  options: string[],
  serverName: string,
  config: NonNullable<SensitiveFieldsConfig["server"]>,
): { masked: string[]; fields: Array<{ field: string }> } {
  const masked: string[] = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  // Options are [key1, value1, key2, value2, ...]
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 >= options.length) break;

    const key = options[i];
    const value = options[i + 1];

    // Check if this key should be masked
    let shouldMask = false;
    let placeholder = value;

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, serverName);
          break;
        }
      }
    }

    if (shouldMask) {
      masked.push(key, placeholder);
      fields.push({ field: key });
    } else {
      masked.push(key, value);
    }
  }

  return { masked, fields };
}

/**
 * Mask server options in ALTER statement
 */
function maskServerOptionsInAlter(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
  serverName: string,
  config: NonNullable<SensitiveFieldsConfig["server"]>,
): { masked: typeof options; fields: Array<{ field: string }> } {
  const masked: typeof options = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  for (const opt of options) {
    if (opt.action === "DROP") {
      masked.push(opt);
      continue;
    }

    const key = opt.option;
    let shouldMask = false;
    let placeholder = opt.value ?? "";

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, serverName);
          break;
        }
      }
    }

    if (shouldMask && opt.value !== undefined) {
      masked.push({ ...opt, value: placeholder });
      fields.push({ field: key });
    } else {
      masked.push(opt);
    }
  }

  return { masked, fields };
}

/**
 * Mask user mapping options
 */
function maskUserMappingOptions(
  options: string[],
  mappingId: string,
  config: NonNullable<SensitiveFieldsConfig["userMapping"]>,
): { masked: string[]; fields: Array<{ field: string }> } {
  const masked: string[] = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  // Options are [key1, value1, key2, value2, ...]
  for (let i = 0; i < options.length; i += 2) {
    if (i + 1 >= options.length) break;

    const key = options[i];
    const value = options[i + 1];

    let shouldMask = false;
    let placeholder = value;

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, mappingId);
          break;
        }
      }
    }

    if (shouldMask) {
      masked.push(key, placeholder);
      fields.push({ field: key });
    } else {
      masked.push(key, value);
    }
  }

  return { masked, fields };
}

/**
 * Mask user mapping options in ALTER statement
 */
function maskUserMappingOptionsInAlter(
  options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>,
  mappingId: string,
  config: NonNullable<SensitiveFieldsConfig["userMapping"]>,
): { masked: typeof options; fields: Array<{ field: string }> } {
  const masked: typeof options = [];
  const fields: Array<{ field: string }> = [];

  if (!config) return { masked: options, fields: [] };

  for (const opt of options) {
    if (opt.action === "DROP") {
      masked.push(opt);
      continue;
    }

    const key = opt.option;
    let shouldMask = false;
    let placeholder = opt.value ?? "";

    if (config.keys?.includes(key)) {
      shouldMask = true;
      placeholder = `__OPTION_${key.toUpperCase()}__`;
    } else if (config.patterns) {
      for (const pattern of config.patterns) {
        if (pattern.match.test(key)) {
          shouldMask = true;
          placeholder = pattern.placeholder(key, mappingId);
          break;
        }
      }
    }

    if (shouldMask && opt.value !== undefined) {
      masked.push({ ...opt, value: placeholder });
      fields.push({ field: key });
    } else {
      masked.push(opt);
    }
  }

  return { masked, fields };
}
