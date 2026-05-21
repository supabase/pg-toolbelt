---
"@supabase/pg-delta": patch
---

fix(pg-delta): suppress Wasm FDW servers, foreign tables, and user mappings in supabase integration

Follow-up to CLI-1470. Also suppress SERVER (object/comment/security-label scopes), FOREIGN TABLE, and USER MAPPING changes whose parent wrapper handler or validator lives in `extensions.*`, so `db pull` no longer emits `CREATE SERVER clerk_oauth_server` for platform Wasm FDWs that local Docker cannot provision. Server _privilege_ scope is intentionally preserved — `GRANT/REVOKE ON SERVER` does not require superuser, and user `postgres_fdw` servers (whose handler installs into `extensions`) carry legitimate user ACL that must roundtrip.
