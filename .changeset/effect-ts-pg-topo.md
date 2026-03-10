---
"@supabase/pg-topo": minor
---

Add Effect-TS support with typed errors, dependency injection, and dual API exports.

- Added `ParseError`, `DiscoveryError`, `ValidationError` tagged error types
- Added `ParserService` interface with `ParserServiceLive` implementation
- Added Effect-native versions of all core pipeline functions:
  - `analyzeAndSortEffect` (uses `ParserService`)
  - `analyzeAndSortFromFilesEffect` (uses `ParserService` + `FileSystem`)
  - `discoverSqlFilesEffect` (uses `@effect/platform` `FileSystem`)
  - `validateSqlSyntaxEffect` (uses `ParserService`)
- All existing Promise-based APIs remain unchanged for backward compatibility
- New dependencies: `effect`, `@effect/platform`
