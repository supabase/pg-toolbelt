---
"@supabase/pg-delta": major
"@supabase/pg-topo": major
---

Refactor both packages around explicit Effect runtime boundaries.

For `pg-delta`, `/effect` no longer exposes `pg.Pool`-typed APIs. Use
`@supabase/pg-delta/node`, `@supabase/pg-delta/bun`, or
`@supabase/pg-delta/adapters/node-pg` for Node runtime interop.

For `pg-topo`, file-based Effect APIs now rely on injected `FileSystem`,
`Path`, and working-directory services, while `/node`, `/bun`, and
`@supabase/pg-topo/adapters/node-filesystem` provide the runtime layers.
