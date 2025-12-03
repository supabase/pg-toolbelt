# Integrations

Integrations allow you to customize how `pg-delta` handles platform-specific differences, sensitive data, and environment-dependent values.

## Overview

An integration consists of two optional functions:

- **Filter**: Determines which changes should be included in the migration
- **Serialize**: Customizes how changes are serialized to SQL (e.g., masking sensitive values)

## Built-in Integrations

### `base`

The default integration with safe-by-default handling:

- Masks all unknown options in foreign data wrapper configurations
- Filters known environment-dependent fields (e.g., role passwords, subscription connection info)

**Usage:**

```typescript
import { main, base } from "@supabase/pg-delta";

const result = await main(sourceUrl, targetUrl, base);
```

### `supabase`

Supabase-specific integration that:

- Filters out Supabase system schemas and roles
- Applies base integration's masking and filtering
- Handles Supabase-specific schema ownership

**Usage:**

```typescript
import { main } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const result = await main(sourceUrl, targetUrl, supabase);
```

**CLI Usage:**

```bash
pg-delta diff <source> <target> --integration supabase
```

## Creating Custom Integrations

### Basic Integration

```typescript
import type { Integration } from "@supabase/pg-delta";

const myIntegration: Integration = {
  filter: (ctx, change) => {
    // Return false to exclude this change
    // Return true to include this change
    return true;
  },
  serialize: (ctx, change) => {
    // Return undefined to use default serialization
    // Return string to use custom SQL
    return undefined;
  },
};
```

### Filtering Changes

The filter function receives the diff context and each change. Use it to exclude changes that shouldn't be in migrations:

```typescript
const myIntegration: Integration = {
  filter: (ctx, change) => {
    // Exclude changes to a specific schema
    if (change.schema === "internal") {
      return false;
    }

    // Exclude specific object types
    if (change.objectType === "extension") {
      return false;
    }

    return true;
  },
};
```

### Custom Serialization

The serialize function allows you to customize the SQL output for specific changes:

```typescript
const myIntegration: Integration = {
  serialize: (ctx, change) => {
    // Mask sensitive values
    if (change.objectType === "role" && change.operation === "create") {
      // Return custom SQL with masked password
      return `CREATE ROLE ${change.name} WITH PASSWORD '***MASKED***';`;
    }

    // Use default serialization for other changes
    return undefined;
  },
};
```

### Combining Filter and Serialize

You can use both functions together:

```typescript
const myIntegration: Integration = {
  filter: (ctx, change) => {
    // Filter out test data
    if (change.schema === "test") {
      return false;
    }
    return true;
  },
  serialize: (ctx, change) => {
    // Mask production secrets
    if (change.objectType === "subscription") {
      return change.serialize({ skipAuthorization: true });
    }
    return undefined;
  },
};
```

## Integration Configuration

For more advanced integrations, you can use the `IntegrationConfig` type to configure filtering and masking behavior:

```typescript
import type { IntegrationConfig } from "@supabase/pg-delta/integrations/integration.types";

const config: IntegrationConfig = {
  role: {
    filter: ["password", "validUntil"], // Filter out these fields
    mask: {
      password: (roleName) => ({
        placeholder: "***MASKED***",
        instruction: `Set password for role ${roleName}`,
      }),
    },
  },
  subscription: {
    filter: ["conninfo"], // Filter out connection info
    mask: {
      conninfo: (subName) => ({
        placeholder: "host=*** port=***",
        instruction: `Configure connection for subscription ${subName}`,
      }),
    },
  },
};
```

## Best Practices

1. **Always filter environment-dependent values**: Passwords, connection strings, and other environment-specific values should be filtered or masked.

2. **Use built-in integrations when possible**: The `base` and `supabase` integrations handle common cases.

3. **Test your integration**: Ensure your custom integration produces valid SQL and handles edge cases.

4. **Document your integration**: If sharing an integration, document what it filters and why.

5. **Compose integrations**: You can create integrations that build on top of existing ones:

```typescript
import { base } from "@supabase/pg-delta";

const myIntegration: Integration = {
  filter: (ctx, change) => {
    // First apply base filter
    if (!base.filter?.(ctx, change)) {
      return false;
    }
    // Then apply custom filter
    return change.schema !== "internal";
  },
  serialize: base.serialize, // Use base serialization
};
```

