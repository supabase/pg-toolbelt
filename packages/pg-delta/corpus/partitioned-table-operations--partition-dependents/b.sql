-- partitioned table whose partitions carry inherited columns and a cloned
-- PK/index/trigger; a view, an FK and a local index hang off one partition,
-- and b.sql changes that partition's bound (drop + recreate)
CREATE SCHEMA app;

CREATE FUNCTION app.touch() RETURNS trigger
  LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;

CREATE TABLE app.messages (
  id bigint GENERATED ALWAYS AS IDENTITY,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  body text,
  PRIMARY KEY (id, inserted_at)
) PARTITION BY RANGE (inserted_at);
CREATE TABLE app.messages_2024 PARTITION OF app.messages
  FOR VALUES FROM ('2024-01-01') TO ('2024-07-01');
CREATE TABLE app.messages_default PARTITION OF app.messages DEFAULT;
CREATE INDEX messages_body_idx ON app.messages (body);
CREATE TRIGGER messages_touch BEFORE UPDATE ON app.messages
  FOR EACH ROW EXECUTE FUNCTION app.touch();

-- dependents of a single partition: replacing it must rebuild them
CREATE INDEX messages_2024_at_idx ON app.messages_2024 (inserted_at);
CREATE VIEW app.recent AS SELECT id, body FROM app.messages_2024;
CREATE TABLE app.pins (
  msg_id bigint,
  msg_at timestamptz,
  FOREIGN KEY (msg_id, msg_at) REFERENCES app.messages_2024 (id, inserted_at)
);
