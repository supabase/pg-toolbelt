//! `migration_converges` over the `obj` generator (src/obj.rs): function
//! signatures, procedures, aggregates, operators, casts, range types,
//! collations, extensions, event triggers, rules, publications and foreign
//! data, with the dependency chains between them. Stock cluster, superuser.

use pg_delta_ephyra::obj::{check, pairs, Pair};

#[ephyra::test(gen = pairs(), tests = 200)]
fn obj_migration_converges(p: Pair) {
    check(&p);
}
