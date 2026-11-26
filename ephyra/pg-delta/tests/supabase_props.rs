//! `migration_converges` under pg-delta's Supabase profile, as `postgres` on a
//! full-stack Supabase database (the base-init fixture replayed). Runs only
//! with EPHYRA_FLAVOR=supabase, which makes the worker boot that container.

use pg_delta_ephyra::ext::{check, pairs, Flavor, Pair};

#[ephyra::test(gen = pairs(Flavor::Supabase), tests = 150)]
fn supabase_migration_converges(p: Pair) {
    if std::env::var("EPHYRA_FLAVOR").as_deref() != Ok("supabase") {
        return;
    }
    check(&p, "supabase");
}
