const RLSPOLICIES_QUERY = /* sql */ `
select
  p.polname as name,
  n.nspname as schema,
  c.relname as table_name,
  p.polcmd as commandtype,
  p.polpermissive as permissive,
  (
    select
      array_agg(
        case when o = 0 then
        'public'
        else
        pg_get_userbyid(o)
        end
      )
    from
    unnest(p.polroles) as unn(o)
  )
  as roles,
  p.polqual as qualtree,
  pg_get_expr(p.polqual, p.polrelid) as qual,
  pg_get_expr(p.polwithcheck, p.polrelid) as withcheck
from
  pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
order by
  2, 1
`;
