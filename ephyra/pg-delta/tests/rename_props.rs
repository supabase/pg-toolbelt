//! Rename detection: B is the generated desired side with 1–3 of its objects
//! renamed afterwards (tables, columns, views, sequences, indexes, functions,
//! types, constraints, triggers, policies, schemas). Planned with
//! `renames: "auto"` against a source holding one row per table; the proof
//! must pass. A rename pg-delta does not detect (a declared drop + create) is
//! a documented limit, labelled rather than failed.

use ephyra::prelude::*;
use ephyra::{classify, signature};
use pg_delta_ephyra::{ext, migrate_renamed, obj, sig};

fn check(a: &str, b: &str, compact: bool, seed: u32, known: fn(&pg_delta_ephyra::Outcome) -> Option<&'static str>) {
    let o = migrate_renamed(a, b, compact, seed);
    let k = known(&o).or_else(|| rename_known(&o));
    if let Some(k) = k {
        classify(true, k);
        return;
    }
    classify(o.kind == "rename_missed", "rename not detected (declared drop + create)");
    classify(o.kind == "data_hazard", "data hazard");
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => panic!("generated SQL did not load ({}): {}", o.kind, o.detail),
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}

#[ephyra::test(gen = (obj::pairs(), any::<u32>()), tests = 150)]
fn obj_renames_converge(input: (obj::Pair, u32)) {
    let (p, s) = input;
    check(&obj::render(&p.a), &obj::render(&p.b), p.compact, s, obj::known_bug);
}

#[ephyra::test(gen = (ext::pairs(ext::Flavor::Stock), any::<u32>()), tests = 150)]
fn ext_renames_converge(input: (ext::Pair, u32)) {
    let (p, s) = input;
    check(&ext::render(&p.a), &ext::render(&p.b), p.compact, s, ext::known_bug);
}

/// Families pinned in tests/rename_regressions.rs.
fn rename_known(o: &pg_delta_ephyra::Outcome) -> Option<&'static str> {
    let first = o.detail.lines().next().unwrap_or("");
    match o.kind.as_str() {
        "plan_throw" if first.contains("dependency cycle") && o.detail.contains("RENAME") => {
            Some("rename cycles with a dependent / container change")
        }
        "drift" if o.detail.lines().any(|l| l.trim_start().starts_with("add index:")) && o.detail.contains("PARTITION") || (o.kind == "drift" && o.detail.contains("_idx")) => Some("partition index name"),
        "drift" if o.detail.lines().any(|l| l.trim_start().starts_with("add column:")) && o.detail.contains("RENAME COLUMN") && o.detail.contains(" RENAME TO ") => Some("table + column renamed together"),
        // a table moved to another schema is planned as drop + create (documented limit)
        "apply_error" if first.contains("cannot drop table") && o.detail.contains("CREATE TABLE \"app\".") => Some("cross-schema move is drop + create"),
        // a partition dropped while an FK references its parent (draft 12)
        "apply_error" if first.contains("cannot drop table") && first.contains("other objects depend on it") => Some("partition drop with an FK to the parent"),
        "apply_error" if first.contains("cannot drop index") && first.contains("requires it") => Some("partition index name change"),
        "apply_error" if first.contains("cannot rename inherited column") || (first.contains("does not exist") && o.detail.contains("RENAME COLUMN")) => Some("merged inherited column"),
        _ => None,
    }
}
