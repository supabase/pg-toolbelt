---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress Wasm FDW servers, foreign tables, and user mappings in supabase integration

Follow-up to CLI-1470. Also suppress SERVER (object/comment/security-label scopes), FOREIGN TABLE, and USER MAPPING changes whose parent wrapper is a Supabase Wasm FDW — identified by the `extensions.wasm_fdw_handler` / `extensions.wasm_fdw_validator` functions the `wrappers` extension ships — so `db pull` no longer emits `CREATE SERVER clerk_oauth_server` for platform Wasm FDWs that local Docker cannot provision.

The discriminator is the Wasm handler/validator function names, not the bare `extensions.*` namespace: contrib FDWs like `postgres_fdw` install their handler/validator into `extensions` on Supabase too, but they ARE available in the local image, so user-created `postgres_fdw` wrappers (and their servers, foreign tables, and user mappings) must still roundtrip. Server _privilege_ scope is likewise preserved — `GRANT/REVOKE ON SERVER` does not require superuser.
