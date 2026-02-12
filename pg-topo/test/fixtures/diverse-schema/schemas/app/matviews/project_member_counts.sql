create materialized view app.project_member_counts as
select
    pm.project_id,
    count(*)::bigint as member_count
from app.project_members pm
group by pm.project_id;
