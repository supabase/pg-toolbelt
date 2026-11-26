//! Shrunk counterexamples from tests/rename_props.rs, planned with
//! `renames: "auto"`. The desired side is the source plus RENAME statements.

use pg_delta_ephyra::migrate_with_renames;

fn converges(from: &str, renames: &str) {
    let to = format!("{from} {renames}");
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|compact| (compact, migrate_with_renames(from, &to, compact)))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(compact, o)| format!("compact={compact} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}

const TRIGGER: &str = "CREATE TABLE t (id integer PRIMARY KEY, c0 integer); CREATE FUNCTION tf() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN RETURN NEW; END$f$;";

/// PostgreSQL rewrites a trigger that names a renamed column; the plan also
/// re-creates the trigger with the new name, and the two actions cycle.
#[test]
fn column_rename_with_trigger_update_of() {
    converges(
        &format!("{TRIGGER} CREATE TRIGGER tr AFTER UPDATE OF c0 ON t FOR EACH ROW EXECUTE FUNCTION tf();"),
        "ALTER TABLE t RENAME COLUMN c0 TO c0_r;",
    );
}

#[test]
fn column_rename_with_trigger_when() {
    converges(
        &format!("{TRIGGER} CREATE TRIGGER tr AFTER UPDATE ON t FOR EACH ROW WHEN (NEW.id > 0) EXECUTE FUNCTION tf();"),
        "ALTER TABLE t RENAME COLUMN id TO id_r;",
    );
}

/// A renamed type's columns follow it; the plan also retypes the column to
/// the new name, and that cycles with the rename.
#[test]
fn type_rename_with_column() {
    converges("CREATE TYPE c0 AS (a bigint, b text); CREATE TABLE t (id integer, c c0);", "ALTER TYPE c0 RENAME TO c0_r;");
}

/// A partition's index (attached to the parent's index) is renamed; the plan
/// drops it instead, which PostgreSQL refuses.
#[test]
fn partition_index_rename() {
    converges(
        "CREATE TABLE t (id bigint, k date NOT NULL) PARTITION BY LIST (k); CREATE TABLE t_a PARTITION OF t FOR VALUES IN ('2000-01-01'); CREATE INDEX t_ix ON t (k);",
        "ALTER INDEX t_a_k_idx RENAME TO t_a_k_idx_r;",
    );
}

/// A merged column (the child declares it too) cannot be renamed on the
/// parent alone (bug 08 family).
#[test]
fn inherited_merged_column_rename() {
    converges("CREATE TABLE p (id bigint, c date); CREATE TABLE ch (c date) INHERITS (p);", "ALTER TABLE p RENAME COLUMN c TO c_r;");
}

/// A rename plus any change to the object that contains it (schema owner;
/// table owner or RLS for a policy) cycles; each change alone plans fine.
#[test]
fn table_rename_with_schema_owner_change() {
    let a = "CREATE SCHEMA app; CREATE TABLE app.t0 (id int);";
    let to = "ALTER SCHEMA app OWNER TO eph_writer; ALTER TABLE app.t0 RENAME TO t0_r;";
    converges(a, to);
}

#[test]
fn policy_rename_with_table_change() {
    let a = "CREATE TABLE t0 (id int); ALTER TABLE t0 ENABLE ROW LEVEL SECURITY; CREATE POLICY p ON t0 USING (id > 0);";
    converges(a, "ALTER TABLE t0 OWNER TO eph_owner; ALTER POLICY p ON t0 RENAME TO p_r;");
}

/// A table and one of its columns renamed together: the plan renames the
/// table only and the column keeps its old name (proof drift).
#[test]
fn table_and_column_renamed_together() {
    converges("CREATE TABLE t (id int, c int);", "ALTER TABLE t RENAME COLUMN c TO c_r; ALTER TABLE t RENAME TO t_r;");
}

/// A rename plus a body change of a function the renamed object calls
/// (column default, CHECK, policy) cycles with CREATE OR REPLACE FUNCTION.
#[test]
fn rename_with_function_body_change() {
    let fi = "CREATE FUNCTION f(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT x$f$;";
    let fb = "CREATE FUNCTION f(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT x + 1$f$;";
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|c| (c, pg_delta_ephyra::migrate_with_renames(&format!("{fi} CREATE TABLE t (id int, c int DEFAULT f(1));"), &format!("{fb} CREATE TABLE t (id int, c int DEFAULT f(1)); ALTER TABLE t RENAME COLUMN c TO c_r;"), c)))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(c, o)| format!("compact={c} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}

/// A column renamed on a table the same plan re-creates (here: becomes
/// partitioned) cycles with the DROP / CREATE TABLE.
#[test]
fn column_rename_on_replaced_table() {
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|c| (c, pg_delta_ephyra::migrate_with_renames("CREATE TABLE t (id bigint NOT NULL, c1 date NOT NULL);", "CREATE TABLE t (id bigint NOT NULL, c1 date NOT NULL) PARTITION BY HASH (id); ALTER TABLE t RENAME COLUMN c1 TO c1_r;", c)))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(c, o)| format!("compact={c} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}
