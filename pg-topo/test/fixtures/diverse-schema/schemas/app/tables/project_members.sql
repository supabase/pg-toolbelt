create table app.project_members (
    project_id bigint not null references app.projects(id) on delete cascade,
    user_id bigint not null references app.users(id) on delete cascade,
    role text not null default 'viewer',
    inserted_at timestamp without time zone default timezone('utc', now()) not null,
    primary key (project_id, user_id)
);
