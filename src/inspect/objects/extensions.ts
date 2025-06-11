const EXTENSIONS_QUERY = /* sql */ `
select
  nspname as schema,
  extname as name,
  extversion as version,
  e.oid as oid
from
    pg_extension e
    inner join pg_namespace
        on pg_namespace.oid=e.extnamespace
order by schema, name;
`;
