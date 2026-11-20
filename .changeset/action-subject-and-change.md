---
"@supabase/pg-delta": minor
---

Every plan action now says what it is about: `Action.subject` is the fact the statement creates, changes or drops, and an `alter` carries `Action.change` (which attribute, the new owner, a rename, or a default-privilege cleanup). Both are part of the plan hash. Read them instead of the first element of `produces` / `consumes` / `destroys`, which are ordering edges and name the wrong object for identity columns and default-privilege cleanup `REVOKE`s. A cleanup `REVOKE` now reports lock class `none` instead of the lock of the object it follows. The export-only `ALTER DEFAULT PRIVILEGES … REVOKE ALL` wipe of a platform default grant is now an `alter` with a `defaultPrivileges` change instead of a `create`. `ENGINE_VERSION` is `0.4.0`: plans saved by an earlier version must be re-planned.
