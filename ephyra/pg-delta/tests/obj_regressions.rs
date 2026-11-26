//! Shrunk counterexamples from the `obj` generator, through `migrate_bare`
//! (empty tables) in both compact modes.

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

/// A collation whose locale or determinism changes is dropped and re-created
/// while a column still uses it.
#[test]
fn collation_definition_change_with_column() {
    converges(
        "CREATE COLLATION co (provider = icu, locale = 'und', deterministic = false); CREATE TABLE t (id int, c text COLLATE co);",
        "CREATE COLLATION co (provider = icu, locale = 'und-u-ks-level2', deterministic = false); CREATE TABLE t (id int, c text COLLATE co);",
    );
}

/// A function that must be dropped and re-created (return type, argument
/// name, new defaulted argument) is dropped while a STORED generated column
/// still calls it. Views, defaults, CHECKs, indexes and policies over the
/// same function are handled.
#[test]
fn function_replace_with_generated_column() {
    converges(
        "CREATE FUNCTION f(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT x + 1$f$; CREATE TABLE t (id int, c bigint GENERATED ALWAYS AS (f(id)) STORED);",
        "CREATE FUNCTION f(x integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS $f$SELECT (x + 1)::bigint$f$; CREATE TABLE t (id int, c bigint GENERATED ALWAYS AS (f(id)) STORED);",
    );
}

/// A new partition whose attached index has a non-default name: the
/// partition's index is created under PostgreSQL's generated name and never
/// renamed (draft 24 family).
#[test]
fn new_partition_with_named_index() {
    let p = "CREATE TABLE t (id bigint, k date NOT NULL) PARTITION BY LIST (k); CREATE INDEX t_ix ON t (k);";
    converges(p, &format!("{p} CREATE TABLE t_a PARTITION OF t FOR VALUES IN ('2000-01-01'); ALTER INDEX t_a_k_idx RENAME TO t_a_custom;"));
}

/// A column moves to a new range type that takes the old type's multirange
/// name: the new range is created before the old one is dropped.
#[test]
fn range_retype_reusing_multirange_name() {
    converges(
        "CREATE TYPE r1 AS RANGE (SUBTYPE = integer); CREATE TABLE t (c r1);",
        "CREATE TYPE r1 AS RANGE (SUBTYPE = date); ALTER TYPE r1 RENAME TO r1_r; CREATE TABLE t (c r1_r);",
    );
}

/// PG 14 only: creating any ICU collation throws at render time
/// ("expected a scalar, got null"); PG 15+ and libc collations pass.
#[test]
fn icu_collation_create() {
    converges("", "CREATE COLLATION co (provider = icu, locale = 'und');");
}
