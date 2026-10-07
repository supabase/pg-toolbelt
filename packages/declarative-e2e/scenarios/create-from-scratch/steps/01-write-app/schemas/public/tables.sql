create table public.projects (
  id bigint generated always as identity primary key,
  name text not null
);

create table public.tasks (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  title text not null,
  status public.task_status not null default 'todo',
  updated_at timestamptz not null default now()
);

create index tasks_project_id_idx on public.tasks (project_id);

comment on table public.tasks is 'Work items of a project.';

alter table public.tasks enable row level security;

create policy "members read tasks" on public.tasks
  for select to authenticated using (true);
