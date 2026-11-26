---
"@supabase/pg-topo": patch
---

Update `pg-topo:requires` annotations and `externalProviders` signatures for array parameters to use the array type, for example `function:public.f(bigint[])` or `function:public.f(variadic text[])`: the element type no longer matches. Array and `variadic` parameters now get their own signature, so overloads like `f(text, uuid)` and `f(text, uuid[])` are no longer reported as `DUPLICATE_PRODUCER`, and calls order after the overload they reach. A function's `out` parameters no longer count toward its signature.
