//! Supabase profile, as `postgres`, with one real row in every source table
//! (FKs and triggers stay on: `postgres` cannot set session_replication_role).
//! Runs only with EPHYRA_FLAVOR=supabase.

use pg_delta_ephyra::{ext, obj};

fn on() -> bool {
    std::env::var("EPHYRA_FLAVOR").as_deref() == Ok("supabase")
}

#[ephyra::test(gen = ext::pairs(ext::Flavor::Supabase), tests = 120)]
fn ext_supabase_rows_survive(p: ext::Pair) {
    if on() {
        ext::check_rows(&p, "supabase");
    }
}

#[ephyra::test(gen = obj::pairs_supabase(), tests = 120)]
fn obj_supabase_rows_survive(p: obj::Pair) {
    if on() {
        obj::check_supabase_rows(&p);
    }
}
