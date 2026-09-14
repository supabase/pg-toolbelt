---
"@supabase/pg-delta": patch
---

CLI commands are now embedder-safe: command handlers (`schema apply`, `apply`, `drift`, `render`, `prove`, …) and the shared frontends/diagnostics helpers no longer call `process.exit` themselves. They throw instead (`UsageError` / `SchemaFrontendError` → exit 2, or `CliExit(code)` for operation-result exits), and `main()` is the sole exiter mapping those to the same CLI exit codes as before. Previously a guard such as the `schema apply` baseline-mismatch / pg_cron precheck aborted the host process mid-run when the command was invoked in-process (library use, tests), tearing everything down; those errors now propagate to the caller.
