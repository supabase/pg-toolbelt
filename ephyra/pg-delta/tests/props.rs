//! Properties of pg-delta, checked against a live Postgres through the Bun
//! worker:
//!
//! 1. `migration_converges`: for any two loadable schemas A and B, the plan
//!    from A to B applies on a clone of A, the clone then extracts to B's fact
//!    base, and seeded rows survive (pg-delta's own proof loop, `provePlan`).
//!    Source: README "proves the plan converges (state + data preservation)".
//! 2. `plan_is_deterministic`: checked inside (1), the same inputs give the
//!    same plan.
//! 3. `export_roundtrips`: load(export(db)) has the same fact base as db, for
//!    every layout. Source: AGENTS.md "gated by load(export(db)) ≡ db".

use ephyra::prelude::*;
use ephyra::{signature, GenExt};
use pg_delta_ephyra::gen::{self, Pair};
use pg_delta_ephyra::model::Db;
use pg_delta_ephyra::render::render;
use pg_delta_ephyra::gen::known_bug;
use pg_delta_ephyra::{migrate, roundtrip, sig};

fn pairs() -> impl Gen<Value = Pair> {
    (|g: &mut Source| gen::pair(g)).with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in gen::shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

fn dbs() -> impl Gen<Value = (DbShow, u8)> {
    (|g: &mut Source| (DbShow(gen::db(g)), g.int(0u8..=2))).with_shrink(|(d, l): &(DbShow, u8), visit: &mut dyn FnMut((DbShow, u8)) -> std::ops::ControlFlow<()>| {
        for c in gen::shrink_db(&d.0) {
            visit((DbShow(c), *l))?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

#[derive(Clone, PartialEq)]
struct DbShow(Db);
impl std::fmt::Debug for DbShow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "\n{}", render(&self.0))
    }
}

#[ephyra::test(gen = pairs(), tests = 200)]
fn migration_converges(p: Pair) {
    let (a, b) = (render(&p.a), render(&p.b));
    let o = migrate(&a, &b, p.compact);
    ephyra::classify(o.kind == "data_hazard", "data hazard (fails only with seeded rows)");
    // Intended: pg-delta refuses an in-use domain's base-type change with an
    // explicit error (plan/rules: "cannot replace an in-use domain").
    let refused = o.kind == "plan_throw"
        && (o.detail.contains("cannot replace an in-use domain") || (o.detail.contains("composite type") && o.detail.contains("while the type is used by table columns")));
    ephyra::classify(refused, "intended refusal: in-use domain/composite");
    let known = known_bug(&o);
    ephyra::classify(known.is_some(), "known bug (pinned in tests/regressions.rs)");
    match o.verdict.as_str() {
        "pass" => {}
        _ if refused || known.is_some() => {}
        "invalid" => {
            signature(sig(&format!("generator-invalid {}", o.kind), &o.detail));
            panic!("generated SQL did not load ({}): {}", o.kind, o.detail);
        }
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}

#[ephyra::test(gen = dbs(), tests = 200)]
fn export_roundtrips(input: (DbShow, u8)) {
    let layout = ["by-object", "ordered", "grouped"][input.1 as usize];
    let o = roundtrip(&render(&input.0 .0), layout);
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => {
            signature(sig(&format!("generator-invalid {}", o.kind), &o.detail));
            panic!("generated SQL did not load ({}): {}", o.kind, o.detail);
        }
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta {} ({layout}): {}", o.kind, o.detail);
        }
    }
}
