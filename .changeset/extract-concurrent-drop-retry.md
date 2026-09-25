---
"@supabase/pg-delta": patch
---

Extraction no longer fails with `cache lookup failed …` (or records a `"null"` definition) when concurrent DDL drops an object mid-extraction: the attempt is retried on a fresh snapshot, up to 3 times. If the catalog keeps changing, `extract()` throws the new `ConcurrentCatalogChangeError` (`code: "concurrent_catalog_change"`) so callers can report a retryable condition instead of an internal error.
