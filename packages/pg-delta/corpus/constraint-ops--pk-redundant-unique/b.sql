-- UNIQUE whose column list equals the PRIMARY KEY: Postgres honours this
-- when added via ALTER TABLE, and silently drops it when inlined in CREATE TABLE.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema."companyIntegration" (
  id integer NOT NULL,
  "companyId" integer NOT NULL,
  CONSTRAINT "companyIntegration_pkey" PRIMARY KEY (id, "companyId")
);
ALTER TABLE test_schema."companyIntegration"
  ADD CONSTRAINT "companyIntegration_id_companyId_unique" UNIQUE (id, "companyId");

-- control: UNIQUE on a different column set still folds into CREATE TABLE
CREATE TABLE test_schema.u (
  a integer NOT NULL,
  c integer,
  CONSTRAINT u_pkey PRIMARY KEY (a)
);
ALTER TABLE test_schema.u ADD CONSTRAINT u_c_unique UNIQUE (c);

-- two UNIQUEs on the same columns: CREATE TABLE keeps only the first
CREATE TABLE test_schema.dup_unique (a integer NOT NULL);
ALTER TABLE test_schema.dup_unique ADD CONSTRAINT dup_u1 UNIQUE (a);
ALTER TABLE test_schema.dup_unique ADD CONSTRAINT dup_u2 UNIQUE (a);
