use ephyra::prelude::*;
use ephyra::{check, check_generator, signature, Config};
use pg_topo_ephyra::driver::{analyze, execute};
use pg_topo_ephyra::schema::{gen_case, masked, shrink_case, Case};

fn max_steps() -> usize {
    std::env::var("PGTOPO_STEPS").ok().and_then(|s| s.parse().ok()).unwrap_or(25)
}

fn cases() -> ephyra::BoxGen<Case> {
    let n = max_steps();
    (move |g: &mut Source| gen_case(g, n)).with_shrink(shrink_v).boxed()
}

fn shrink_v(c: &Case, visit: &mut dyn FnMut(Case) -> std::ops::ControlFlow<()>) -> std::ops::ControlFlow<()> {
    for x in shrink_case(c) {
        visit(x)?;
    }
    std::ops::ControlFlow::Continue(())
}

fn generator_valid(c: &Case) -> bool {
    execute(&c.valid_order()).is_ok()
}

#[test]
fn generator_is_valid() {
    let cfg = Config::default().tests(300).name("generator_is_valid");
    check(&cfg, cases(), |c: Case| {
        if let Err((i, msg)) = execute(&c.valid_order()) {
            signature(msg.split('"').enumerate().map(|(k, p)| if k % 2 == 1 { "_" } else { p }).collect::<String>());
            panic!("generator produced invalid schema at [{i}]: {msg}\n{}", c.stmts[i].sql);
        }
    })
    .assert_passed();
}

#[test]
fn sorted_output_executes() {
    let cfg = Config::default().tests(2000).name("sorted_output_executes");
    let report = check(&cfg, cases(), |c: Case| {
        // only valid schemas are in scope; shrinking must not escape that
        if !generator_valid(&c) {
            ephyra::assume!(false);
        }
        let inputs = c.inputs();
        let r = analyze(&inputs);
        if !r.ok {
            signature("analyzeAndSort threw");
            panic!("analyzeAndSort threw: {}", r.error.unwrap_or_default());
        }
        let parse_errs: Vec<_> = r.diagnostics.iter().filter(|d| d.code == "PARSE_ERROR").collect();
        if !parse_errs.is_empty() {
            signature("PARSE_ERROR on valid SQL");
            panic!("PARSE_ERROR on valid SQL: {parse_errs:?}");
        }
        // P3: every statement exactly once
        if r.ordered.len() != c.stmts.len() {
            signature("ordered length mismatch");
            panic!("ordered has {} statements, input has {}", r.ordered.len(), c.stmts.len());
        }
        // P4: determinism
        let r2 = analyze(&inputs);
        let a: Vec<_> = r.ordered.iter().map(|o| &o.sql).collect();
        let b: Vec<_> = r2.ordered.iter().map(|o| &o.sql).collect();
        if a != b {
            signature("nondeterministic order");
            panic!("nondeterministic order");
        }
        // P1: executes
        let sorted: Vec<String> = r.ordered.iter().map(|o| o.sql.clone()).collect();
        if let Err((i, msg)) = execute(&sorted) {
            let blocked = r.ordered[i].cls.clone();
            let norm_msg = msg
                .split('"')
                .enumerate()
                .map(|(k, p)| if k % 2 == 1 { "_" } else { p })
                .collect::<String>();
            let norm_msg = match norm_msg.find(" does not exist") {
                Some(_) => format!("{} does not exist", norm_msg.split_whitespace().next().unwrap_or("")),
                None => norm_msg,
            };
            signature(format!("exec fails: {blocked}: {norm_msg}"));
            panic!(
                "sorted output fails at ordered[{i}] ({}): {msg}\n  stmt: {}\n  diagnostics: {:?}",
                r.ordered[i].cls, sorted[i], r.diagnostics
            );
        }
        // P2: no cycles on acyclic input
        if let Some(d) = r.diagnostics.iter().find(|d| d.code == "CYCLE_DETECTED") {
            signature("CYCLE_DETECTED on acyclic schema");
            panic!("CYCLE_DETECTED on acyclic schema: {}", d.message);
        }
        ephyra::TestResult::Pass
    });
    report.assert_passed();
}

#[test]
fn generator_check() {
    let cfg = Config::default().tests(200);
    check_generator(&cfg, cases(), |c: &Case| c.order.len() == c.stmts.len() && c.breaks.len() == c.stmts.len()).assert_passed();
}

/// Every UNRESOLVED_DEPENDENCY on a self-contained schema must name a built-in
/// (pg_catalog / extension-provided) object, never one the schema creates.
#[test]
fn no_spurious_unresolved() {
    let cfg = Config::default().tests(2000).name("no_spurious_unresolved");
    let report = check(&cfg, cases(), |c: Case| {
        if !generator_valid(&c) {
            ephyra::assume!(false);
        }
        let r = analyze(&c.inputs());
        for d in r.diagnostics.iter().filter(|d| d.code == "UNRESOLVED_DEPENDENCY") {
            // message: No producer found for 'kind:schema:name:sig'.
            let key = d.message.split('\'').nth(1).unwrap_or("");
            let mut parts = key.split(':');
            let kind = parts.next().unwrap_or("");
            let schema = parts.next().unwrap_or("");
            let name = parts.next().unwrap_or("");
            if schema == "pg_catalog" || name == "citext" || kind == "extension" {
                continue;
            }
            // generated names all end in a number (optionally ".x"); anything else is built-in
            let ours = name.trim_end_matches(".x").chars().last().map(|ch| ch.is_ascii_digit()).unwrap_or(false);
            // a recursive view reports its own name (pg-topo bug N22)
            let self_ref = masked("recursive_view_self")
                && c.stmts.iter().any(|s| s.sql.starts_with("CREATE RECURSIVE VIEW") && s.sql.to_lowercase().contains(&name.to_lowercase()));
            if self_ref {
                continue;
            }
            if ours {
                signature(format!("spurious unresolved {kind}"));
                panic!("spurious UNRESOLVED_DEPENDENCY: {}", d.message);
            }
        }
        ephyra::TestResult::Pass
    });
    report.assert_passed();
}
