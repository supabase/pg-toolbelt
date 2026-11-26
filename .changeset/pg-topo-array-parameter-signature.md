---
"@supabase/pg-topo": patch
---

Give array and `variadic` parameters their own signature, so overloads like `f(text, uuid)` and `f(text, uuid[])` are no longer reported as `DUPLICATE_PRODUCER`, and calls order after the overload they reach. A function's `out` parameters no longer count toward its signature. A `pg-topo:requires` annotation or `externalProviders` signature for an array parameter now needs the array type, for example `function:public.f(bigint[])` or `function:public.f(variadic text[])`.
