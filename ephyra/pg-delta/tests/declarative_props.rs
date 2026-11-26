//! The Supabase CLI declarative workflow over the `ext` generator: export the
//! desired database (grouped or by-object), re-sync the files onto it (must
//! plan nothing), sync them onto the source, apply, re-sync (must plan
//! nothing). Children never redeclare inherited columns: that always hits
//! the merged-column export bug. Stock cluster with the raw profile by default; with
//! EPHYRA_FLAVOR=supabase, the Supabase profile on a full-stack database.

use pg_delta_ephyra::ext::{check_declarative, pairs_unmerged, Flavor, Pair};

fn flavor() -> (Flavor, &'static str) {
    if std::env::var("EPHYRA_FLAVOR").as_deref() == Ok("supabase") {
        (Flavor::Supabase, "supabase")
    } else {
        (Flavor::Stock, "stock")
    }
}

#[ephyra::test(gen = pairs_unmerged(flavor().0), tests = 150)]
fn declarative_sync_converges(p: Pair) {
    check_declarative(&p, flavor().1);
}
