//! Shrunk counterexamples from the `ext` generator runs, as plain tests,
//! through `migrate_bare` (empty tables) in both compact modes.

use pg_delta_ephyra::migrate_bare;

fn converges(from: &str, to: &str) {
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|compact| (compact, migrate_bare(from, to, compact)))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(compact, o)| format!("compact={compact} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}

#[test]
fn create_inheritance_child_redeclaring_parent_column() {
    converges("", "CREATE TABLE p (id bigint); CREATE TABLE c (id bigint) INHERITS (p);");
}

#[test]
fn child_stops_redeclaring_inherited_column() {
    converges(
        "CREATE TABLE p (id bigint, a numeric); CREATE TABLE c (id bigint, a numeric) INHERITS (p);",
        "CREATE TABLE p (id bigint, a numeric); CREATE TABLE c (id bigint) INHERITS (p);",
    );
}

#[test]
fn parent_drop_not_null_keeps_child_not_null() {
    converges(
        "CREATE TABLE p (a numeric NOT NULL); CREATE TABLE c (a numeric NOT NULL) INHERITS (p);",
        "CREATE TABLE p (a numeric); CREATE TABLE c (a numeric NOT NULL) INHERITS (p);",
    );
}

#[test]
fn partitioned_to_plain_with_column_grant() {
    converges(
        "CREATE TABLE t (id bigint, k date NOT NULL, a numeric) PARTITION BY LIST (k); GRANT SELECT (a) ON t TO eph_reader;",
        "CREATE TABLE t (id bigint, k date NOT NULL, a numeric);",
    );
}


#[test]
fn publication_add_inheritance_parent() {
    converges(
        "CREATE PUBLICATION pub; CREATE TABLE p (id bigint); CREATE TABLE c () INHERITS (p);",
        "CREATE PUBLICATION pub; CREATE TABLE p (id bigint); CREATE TABLE c () INHERITS (p); ALTER PUBLICATION pub ADD TABLE p;",
    );
}

#[test]
fn publication_drop_inheritance_parent() {
    converges(
        "CREATE PUBLICATION pub; CREATE TABLE p (id bigint); CREATE TABLE c () INHERITS (p); ALTER PUBLICATION pub ADD TABLE p;",
        "CREATE PUBLICATION pub;",
    );
}

#[test]
fn child_starts_redeclaring_inherited_column() {
    converges(
        "CREATE TABLE p (id bigint, a bigint); CREATE TABLE c (id bigint) INHERITS (p);",
        "CREATE TABLE p (id bigint, a bigint); CREATE TABLE c (id bigint, a bigint) INHERITS (p);",
    );
}

#[test]
fn hash_partition_moves_with_fk_on_sibling() {
    converges(
        "CREATE TABLE t (id bigint NOT NULL, k text NOT NULL) PARTITION BY HASH (k);
         CREATE TABLE t_a PARTITION OF t FOR VALUES WITH (MODULUS 4, REMAINDER 3);
         CREATE TABLE t_b PARTITION OF t FOR VALUES WITH (MODULUS 4, REMAINDER 0);
         ALTER TABLE t ADD PRIMARY KEY (id, k);
         ALTER TABLE t_b ADD CONSTRAINT t_b_fk FOREIGN KEY (id, k) REFERENCES t (id, k);",
        "CREATE TABLE t (id bigint NOT NULL, k text NOT NULL) PARTITION BY HASH (k);
         CREATE TABLE t_a PARTITION OF t FOR VALUES WITH (MODULUS 4, REMAINDER 2);
         CREATE TABLE t_b PARTITION OF t FOR VALUES WITH (MODULUS 4, REMAINDER 0);
         ALTER TABLE t ADD PRIMARY KEY (id, k);
         ALTER TABLE t_b ADD CONSTRAINT t_b_fk FOREIGN KEY (id, k) REFERENCES t (id, k);",
    );
}

#[test]
fn owner_change_keeps_grant_to_previous_owner() {
    converges(
        "CREATE FUNCTION f() RETURNS integer LANGUAGE sql AS 'SELECT 0'; ALTER FUNCTION f() OWNER TO eph_owner;",
        "CREATE FUNCTION f() RETURNS integer LANGUAGE sql AS 'SELECT 0'; GRANT EXECUTE ON FUNCTION f() TO eph_owner;",
    );
}

#[test]
fn new_table_owned_by_other_role_skips_creator_default_privileges() {
    converges(
        "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO eph_reader;",
        "CREATE TABLE t (id bigint); ALTER TABLE t OWNER TO eph_owner; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO eph_reader;",
    );
}



#[test]
fn retype_column_of_inheritance_parent_and_child() {
    converges(
        "CREATE TABLE p (id bigint, a integer); CREATE TABLE c (id bigint, a integer) INHERITS (p);",
        "CREATE TABLE p (id bigint, a text); CREATE TABLE c (id bigint, a text) INHERITS (p);",
    );
}


#[test]
fn parent_adds_column_child_has_with_another_type() {
    converges(
        "CREATE TABLE p (id bigint); CREATE TABLE c (id bigint, a integer) INHERITS (p);",
        "CREATE TABLE p (id bigint, a date); CREATE TABLE c (id bigint, a date) INHERITS (p);",
    );
}

#[test]
fn schema_default_privilege_for_role_to_itself() {
    converges(
        "CREATE SCHEMA app;",
        "CREATE SCHEMA app; ALTER DEFAULT PRIVILEGES FOR ROLE eph_writer IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO eph_writer;",
    );
}

#[test]
fn global_default_privilege_revoke_from_role_itself() {
    converges("", "ALTER DEFAULT PRIVILEGES FOR ROLE eph_writer REVOKE SELECT, INSERT ON TABLES FROM eph_writer;");
}


#[test]
fn publication_member_moves_from_parent_to_child() {
    converges(
        "CREATE PUBLICATION pub; CREATE TABLE p (id bigint); CREATE TABLE c () INHERITS (p); ALTER PUBLICATION pub ADD TABLE p;",
        "CREATE PUBLICATION pub; CREATE TABLE p (id bigint); CREATE TABLE c () INHERITS (p); ALTER PUBLICATION pub ADD TABLE ONLY c;",
    );
}

#[test]
fn drop_partition_of_table_referenced_by_fk() {
    converges(
        "CREATE TABLE t (id bigint NOT NULL, k int NOT NULL) PARTITION BY RANGE (k); CREATE TABLE t_a PARTITION OF t FOR VALUES FROM (0) TO (100); ALTER TABLE t ADD PRIMARY KEY (id, k); CREATE TABLE r (id bigint, k int, FOREIGN KEY (id, k) REFERENCES t (id, k));",
        "CREATE TABLE t (id bigint NOT NULL, k int NOT NULL) PARTITION BY RANGE (k); ALTER TABLE t ADD PRIMARY KEY (id, k); CREATE TABLE r (id bigint, k int, FOREIGN KEY (id, k) REFERENCES t (id, k));",
    );
}

#[test]
fn inheritance_parent_to_partitioned_with_fk_to_former_child() {
    converges(
        "CREATE TABLE p (id bigint NOT NULL, k date NOT NULL); CREATE TABLE c () INHERITS (p); ALTER TABLE c ADD PRIMARY KEY (id); ALTER TABLE p ADD CONSTRAINT p_fk FOREIGN KEY (id) REFERENCES c (id);",
        "CREATE TABLE p (id bigint NOT NULL, k date NOT NULL) PARTITION BY HASH (k); CREATE TABLE c (id bigint NOT NULL, k date NOT NULL); ALTER TABLE c ADD PRIMARY KEY (id); ALTER TABLE p ADD CONSTRAINT p_fk FOREIGN KEY (id) REFERENCES c (id);",
    );
}
