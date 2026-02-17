create view app.active_projects as
select
    p.id,
    p.ref,
    p.slug,
    p.name,
    p.organization_id,
    p.owner_id
from app.projects p
where p.slug is not null;

comment on view app.active_projects is 'Readable projection for active projects';

grant select on table app.active_projects to app_reader;
