create view public.post_comment_counts as
  select post_id, count(*) as comment_count from public.comments group by post_id;
