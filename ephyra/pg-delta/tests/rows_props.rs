//! `migration_converges` with one real row in every source table, so the
//! proof's data check covers tables its own DEFAULT VALUES seed cannot fill
//! (every `ext` table, many `obj` ones). A row lost from a kept table fails;
//! an apply error that needs the row is a data hazard, as before.

use pg_delta_ephyra::{ext, gen, obj};

#[ephyra::test(gen = ext::pairs(ext::Flavor::Stock), tests = 200)]
fn ext_rows_survive(p: ext::Pair) {
    ext::check_rows(&p, "stock");
}

#[ephyra::test(gen = obj::pairs(), tests = 200)]
fn obj_rows_survive(p: obj::Pair) {
    obj::check_rows(&p);
}

#[ephyra::test(gen = gen::pairs(), tests = 200)]
fn gen_rows_survive(p: gen::Pair) {
    gen::check_rows(&p);
}
