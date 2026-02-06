#!/bin/bash
set -e

export SOURCE_URL="postgres://postgres:postgres@db.platform.orb.local:5432/pgdelta_empty"
export TARGET_URL="postgres://postgres:postgres@db.platform.orb.local:5432/postgres"
pnpm dlx tsx scripts/declarative-export.ts

# Clean up old files in CLI folder before copying new ones
rm -rf /Users/avallete/Programming/Supa/cli/supabase/schemas
rm -rf /Users/avallete/Programming/Supa/cli/supabase/cluster

# Copy the results to cli local folder
cp -rf ./declarative-schemas/schemas /Users/avallete/Programming/Supa/cli/supabase/schemas
cp -rf ./declarative-schemas/cluster /Users/avallete/Programming/Supa/cli/supabase/cluster

# Update schema_paths in config.toml with our ordered file list
CLI_CONFIG="/Users/avallete/Programming/Supa/cli/supabase/config.toml"
ORDER_JSON="./declarative-schemas/order.json"

# Use node to generate the updated config since it's more reliable for TOML manipulation
node -e "
const fs = require('fs');
const order = JSON.parse(fs.readFileSync('$ORDER_JSON', 'utf8'));
const config = fs.readFileSync('$CLI_CONFIG', 'utf8');

// Find the schema_paths section and replace it
const schemaPathsStr = 'schema_paths = [\\n' + order.map(p => '  \"' + p + '\"').join(',\\n') + '\\n]';

// Match from 'schema_paths = [' to the closing ']' (handling multiline)
const updated = config.replace(/schema_paths\s*=\s*\[[\s\S]*?\n\]/m, schemaPathsStr);

fs.writeFileSync('$CLI_CONFIG', updated);
console.log('Updated schema_paths with ' + order.length + ' files');
"

# Run the cli to up the database and see if it works
cd /Users/avallete/Programming/Supa/cli && go run . db reset --experimental