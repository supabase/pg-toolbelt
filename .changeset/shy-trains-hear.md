"@supabase/pg-delta": patch
---

Add trigger integration coverage for `UPDATE OF <column_list>` handling to ensure migration plans preserve column-filtered update events during trigger creation and replacement.
