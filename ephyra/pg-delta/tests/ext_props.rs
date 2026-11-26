//! `migration_converges` (see tests/props.rs) over the `ext` generator:
//! partitioning, inheritance, ownership, privileges and default privileges,
//! on the stock cluster with three fixed roles (`eph_owner`, `eph_reader`,
//! `eph_writer`).

use pg_delta_ephyra::ext::{check, pairs, Flavor, Pair};

#[ephyra::test(gen = pairs(Flavor::Stock), tests = 200)]
fn ext_migration_converges(p: Pair) {
    check(&p, "stock");
}
