import type { ChangeFilter, ChangeSerializer } from "../main.ts";

/**
 * Configuration for filtering out environment-dependent fields.
 * These cause the entire change to be dropped if it ONLY contains these fields.
 */
export interface EnvDependentConfig {
  role?: ("password" | "validUntil")[];
  subscription?: "conninfo"[];
  server?: string[]; // FDW-specific, provided by integration
  userMapping?: string[]; // FDW-specific, provided by integration
}

/**
 * Configuration for masking sensitive fields in output.
 * Maps field patterns to placeholder generators.
 */
export interface SensitiveFieldsConfig {
  role?: {
    password?: (roleName: string) => {
      placeholder: string;
      instruction: string;
    };
  };
  subscription?: {
    conninfo?: (subName: string) => {
      placeholder: string;
      instruction: string;
    };
  };
  server?: {
    // Pattern-based for unknown FDW options
    patterns?: Array<{
      match: RegExp;
      placeholder: (key: string, serverName: string) => string;
      instruction?: (key: string, serverName: string) => string;
    }>;
    // Or explicit keys
    keys?: string[];
  };
  userMapping?: {
    patterns?: Array<{
      match: RegExp;
      placeholder: (key: string, mappingId: string) => string;
      instruction?: (key: string, mappingId: string) => string;
    }>;
    keys?: string[];
  };
}

export type Integration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};
