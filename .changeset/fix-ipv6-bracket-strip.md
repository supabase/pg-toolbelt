---
"@supabase/pg-delta": patch
---

fix(pg-delta): strip brackets from IPv6 hosts before handing them to pg so `getaddrinfo` sees a bare address.

The alpha.14 IPv6 fix normalized percent-encoded hosts into the canonical bracketed URL form (`postgresql://user@[2600:...]:5432/db`). That is a valid URL, but `pg-connection-string`'s WHATWG-based parser keeps the brackets on `config.host`, so `pg` passed `[2600:...]` verbatim to `getaddrinfo` and connections failed with `ENOTFOUND [2600:...]`.

`createManagedPool` now expands bracketed-IPv6 URLs into explicit `host` / `port` / `user` / `password` / `database` pool fields (plus any remaining query params like `application_name`) and drops `connectionString` on that path — `pg` merges a parsed `connectionString` on top of user config, so a co-provided `host` would otherwise be clobbered. Non-IPv6 URLs still go through `connectionString` unchanged.
