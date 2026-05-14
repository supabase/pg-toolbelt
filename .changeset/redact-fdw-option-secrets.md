---
"@supabase/pg-delta": patch
---

Redact sensitive foreign-data-wrapper option values (`password`, `passfile`, `passcode`, `sslpassword`) in every pg-delta output channel — plan SQL, catalog snapshots, declarative export, and fingerprints. Previously these credentials were emitted in cleartext, ending up on disk, in CLI stdout, and in CI logs. Non-secret options (`host`, `port`, `user`, `dbname`, …) continue to roundtrip with their real values. The redacted DDL is not directly re-appliable for the secret options — operators must re-supply credentials out of band.
