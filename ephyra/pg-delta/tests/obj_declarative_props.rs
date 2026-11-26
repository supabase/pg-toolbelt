//! The declarative workflow (see tests/declarative_props.rs) and OID
//! independence (see tests/stable_props.rs) over the `obj` generator.

use ephyra::signature;
use pg_delta_ephyra::obj::{pairs, render, Pair};
use pg_delta_ephyra::{declarative, sig, stable};

#[ephyra::test(gen = pairs(), tests = 200)]
fn obj_declarative_sync_converges(p: Pair) {
    let layout = if p.compact { "grouped" } else { "by-object" };
    let o = declarative(&render(&p.a), &render(&p.b), layout, "stock");
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => panic!("generated SQL did not load ({}): {}", o.kind, o.detail),
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta declarative {} ({layout}): {}", o.kind, o.detail);
        }
    }
}

#[ephyra::test(gen = pairs(), tests = 150)]
fn obj_plan_is_oid_independent(p: Pair) {
    let o = stable(&render(&p.a), &render(&p.b), "stock");
    match o.verdict.as_str() {
        "pass" => {}
        "invalid" => panic!("generated SQL did not load: {}", o.detail),
        _ => {
            signature(sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}
