create view public.open_tasks as
  select id, project_id, title from public.tasks where status = 'todo';
