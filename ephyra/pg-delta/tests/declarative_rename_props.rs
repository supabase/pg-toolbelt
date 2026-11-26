//! The declarative workflow with rename detection and real rows: export B
//! after renaming 1–3 of its objects, sync onto a live A holding one row per
//! table with `renames: "auto"`, apply, re-sync (must plan nothing). Fewer
//! rows after a plan with no destructive action is `silent_data_loss`.
//! Stock by default; EPHYRA_FLAVOR=supabase for the Supabase profile.

use ephyra::prelude::*;
use ephyra::{classify, signature};
use pg_delta_ephyra::{declarative_renamed, ext, obj, sig, Outcome};

fn flavor() -> &'static str {
    if std::env::var("EPHYRA_FLAVOR").as_deref() == Ok("supabase") { "supabase" } else { "stock" }
}

fn check(a: &str, b: &str, compact: bool, seed: u32, known: &dyn Fn(&Outcome) -> Option<&'static str>) {
    let layout = if compact { "grouped" } else { "by-object" };
    let o = declarative_renamed(a, b, layout, flavor(), seed);
    classify(o.kind == "data_hazard", "data hazard");
    if let Some(k) = known(&o).or_else(|| rename_known(&o)) {
        classify(true, k);
        return;
    }
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => panic!("generated SQL did not load ({}): {}", o.kind, o.detail),
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta declarative {} ({layout}): {}", o.kind, o.detail);
        }
    }
}

#[ephyra::test(gen = (ext::pairs_unmerged(if flavor() == "supabase" { ext::Flavor::Supabase } else { ext::Flavor::Stock }), any::<u32>()), tests = 120)]
fn ext_declarative_renames(input: (ext::Pair, u32)) {
    let (p, s) = input;
    check(&ext::render(&p.a), &ext::render(&p.b), p.compact, s, &|o| ext::known_bug(o).or_else(|| ext::known_declarative(o)));
}

#[ephyra::test(gen = (if flavor() == "supabase" { obj::pairs_supabase().boxed() } else { obj::pairs().boxed() }, any::<u32>()), tests = 120)]
fn obj_declarative_renames(input: (obj::Pair, u32)) {
    let (p, s) = input;
    check(&obj::render(&p.a), &obj::render(&p.b), p.compact, s, &obj::known_bug);
}

/// Families pinned in tests/rename_regressions.rs.
fn rename_known(o: &pg_delta_ephyra::Outcome) -> Option<&'static str> {
    let first = o.detail.lines().next().unwrap_or("");
    match o.kind.as_str() {
        "plan_throw" | "sync_throw" | "resync_throw" if first.contains("dependency cycle") && o.detail.contains("RENAME") => {
            Some("rename cycles with a dependent / container change")
        }
        "resync_not_empty" | "sync_not_converged" if first.starts_with("DROP INDEX") && first.contains("_idx") => Some("partition index name"),
        "drift" if o.detail.lines().any(|l| l.trim_start().starts_with("add index:")) && o.detail.contains("PARTITION") || (o.kind == "drift" && o.detail.contains("_idx")) => Some("partition index name"),
        "drift" if o.detail.lines().any(|l| l.trim_start().starts_with("add column:")) && o.detail.contains("RENAME COLUMN") && o.detail.contains(" RENAME TO ") => Some("table + column renamed together"),
        // a table moved to another schema is planned as drop + create (documented limit)
        "apply_error" if first.contains("cannot drop table") && o.detail.contains("CREATE TABLE \"app\".") => Some("cross-schema move is drop + create"),
        "apply_error" if first.contains("cannot drop index") && first.contains("requires it") => Some("partition index name change"),
        "apply_error" if first.contains("cannot rename inherited column") || (first.contains("does not exist") && o.detail.contains("RENAME COLUMN")) => Some("merged inherited column"),
        _ => None,
    }
}
