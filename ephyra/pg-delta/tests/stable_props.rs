//! The extracted fact base and the plan do not depend on OIDs or catalog
//! history: each side is loaded twice, once after 40 tables, types and
//! functions were created and dropped, and both runs must agree. Over both
//! generators (`gen` and `ext`).

use ephyra::prelude::*;
use ephyra::{signature, GenExt};
use pg_delta_ephyra::gen::{self, Pair};
use pg_delta_ephyra::render::render;
use pg_delta_ephyra::{ext, sig, stable};

fn check(a: &str, b: &str) {
    let o = stable(a, b, "stock");
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => panic!("generated SQL did not load: {}", o.detail),
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}

fn pairs() -> impl Gen<Value = Pair> {
    (|g: &mut Source| gen::pair(g)).with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in gen::shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

#[ephyra::test(gen = pairs(), tests = 150)]
fn gen_plan_is_oid_independent(p: Pair) {
    check(&render(&p.a), &render(&p.b));
}

#[ephyra::test(gen = ext::pairs(ext::Flavor::Stock), tests = 150)]
fn ext_plan_is_oid_independent(p: ext::Pair) {
    check(&ext::render(&p.a), &ext::render(&p.b));
}
