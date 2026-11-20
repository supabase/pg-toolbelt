CREATE SCHEMA app;

CREATE TABLE app.t (
  id integer NOT NULL,
  status text,
  note text DEFAULT 'old',
  mood text DEFAULT 'old'
);
