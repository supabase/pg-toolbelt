//! Shrunk counterexamples from `declarative_props` (stock cluster, raw
//! profile): export the desired database, re-sync it onto itself, sync it
//! onto the source, re-sync. Every layout is checked.

use pg_delta_ephyra::declarative;

fn syncs(from: &str, to: &str) {
    let fails: Vec<String> = ["grouped", "by-object", "ordered"]
        .into_iter()
        .map(|layout| (layout, declarative(from, to, layout, "stock")))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(layout, o)| format!("layout={layout} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n\n"));
}

#[test]
fn export_child_redeclaring_parent_column() {
    syncs("", "CREATE TABLE p (id bigint); CREATE TABLE c (id bigint) INHERITS (p);");
}

/// Under database scope the default owner's OWNER TO stays implicit, so the
/// sync never hands the object back; it rewrites the ACL instead and the
/// next sync plans the same REVOKE again.
#[test]
fn owner_back_to_default_owner() {
    syncs("CREATE SCHEMA app; ALTER SCHEMA app OWNER TO eph_writer;", "CREATE SCHEMA app;");
    syncs("CREATE TABLE t (id int); ALTER TABLE t OWNER TO eph_writer;", "CREATE TABLE t (id int);");
}

/// The export drops a partition index's own name; re-syncing the same
/// database plans DROP INDEX on the attached index (draft 24 family).
#[test]
fn renamed_partition_index_resyncs() {
    let p = "CREATE TABLE t (id bigint, k date NOT NULL) PARTITION BY LIST (k); CREATE TABLE t_a PARTITION OF t FOR VALUES IN ('2000-01-01'); CREATE INDEX t_ix ON t (k);";
    syncs("", &format!("{p} ALTER INDEX t_a_k_idx RENAME TO t_a_k_idx_r;"));
}
