CREATE ROLE analyst NOLOGIN;
CREATE SCHEMA analytics;
CREATE SEQUENCE analytics.batch_id_seq;
CREATE TABLE analytics.page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL DEFAULT '/',
  batch_id bigint DEFAULT nextval('analytics.batch_id_seq'),
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_views_viewed_at_idx ON analytics.page_views (viewed_at);
CREATE VIEW analytics.daily_views AS
  SELECT date_trunc('day', viewed_at) AS day, count(*) AS views FROM analytics.page_views GROUP BY 1;
CREATE FUNCTION analytics.track(p_path text) RETURNS void LANGUAGE sql
  AS $$ INSERT INTO analytics.page_views (path) VALUES (p_path) $$;
GRANT USAGE ON SCHEMA analytics TO analyst;
GRANT SELECT ON analytics.page_views, analytics.daily_views TO analyst;
