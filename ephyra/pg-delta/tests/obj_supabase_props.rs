//! The `obj` generator under the Supabase profile, as `postgres` on a
//! full-stack database: DB-to-DB migration and the declarative workflow.
//! Runs only with EPHYRA_FLAVOR=supabase.

use ephyra::signature;
use pg_delta_ephyra::obj::{check_supabase, known_bug, pairs_supabase, render, Pair};
use pg_delta_ephyra::{declarative, sig};

fn on() -> bool {
    std::env::var("EPHYRA_FLAVOR").as_deref() == Ok("supabase")
}

#[ephyra::test(gen = pairs_supabase(), tests = 150)]
fn obj_supabase_migration_converges(p: Pair) {
    if on() {
        check_supabase(&p);
    }
}

#[ephyra::test(gen = pairs_supabase(), tests = 150)]
fn obj_supabase_declarative_sync_converges(p: Pair) {
    if !on() {
        return;
    }
    let layout = if p.compact { "grouped" } else { "by-object" };
    let o = declarative(&render(&p.a), &render(&p.b), layout, "supabase");
    if known_bug(&o).is_some() {
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
