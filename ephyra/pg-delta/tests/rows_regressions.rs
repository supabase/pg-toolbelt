//! Shrunk counterexamples from tests/rows_props.rs: one real row per source
//! table (`migrate_rows`), both compact modes.

use pg_delta_ephyra::migrate_rows;

fn converges(from: &str, to: &str) {
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|compact| (compact, migrate_rows(from, to, compact, "stock")))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(compact, o)| format!("compact={compact} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}

/// The proof counts a kept inheritance parent with `count(*)` (no ONLY), so
/// its children's rows are counted as its own: dropping a child, or taking
/// it out of the hierarchy, reports data loss on the parent.
#[test]
fn proof_counts_inheritance_children_as_parent_rows() {
    converges(
        "CREATE TABLE p (id bigint NOT NULL); CREATE TABLE c () INHERITS (p);",
        "CREATE TABLE p (id bigint NOT NULL);",
    );
}

/// Taking a table out of its parent's hierarchy drops and re-creates it
/// (declared destructive) instead of `ALTER TABLE c NO INHERIT p`; the proof
/// only notices through the parent's count.
#[test]
fn removing_inheritance_recreates_the_child() {
    converges(
        "CREATE TABLE p (id bigint NOT NULL); CREATE TABLE c () INHERITS (p);",
        "CREATE TABLE p (id bigint NOT NULL); CREATE TABLE c (id bigint NOT NULL);",
    );
}

/// A collation-only change drops and re-adds the column (declared
/// destructive) instead of `ALTER COLUMN … TYPE text COLLATE "C"`; with a
/// row present the proof sees the column's value gone (bug 02 family).
#[test]
fn collation_change_drops_column_data() {
    converges("CREATE TABLE t (id int, c text);", "CREATE TABLE t (id int, c text COLLATE \"C\");");
}
