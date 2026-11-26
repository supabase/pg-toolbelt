//! Second wave: metamorphic and API-surface properties on generated schemas.
use ephyra::prelude::*;
use ephyra::{check, signature, Config};
use pg_topo_ephyra::driver::{analyze, analyze_mode, execute, TopoResult};
use pg_topo_ephyra::schema::{gen_case, shrink_case, Case};
use std::collections::BTreeMap;

fn max_steps() -> usize {
    std::env::var("PGTOPO_STEPS").ok().and_then(|s| s.parse().ok()).unwrap_or(25)
}
fn tests(n: u64) -> u64 {
    std::env::var("PGTOPO_N").ok().and_then(|s| s.parse().ok()).unwrap_or(n)
}

/// A case plus a seed that derives the variant input (permutation, splits, noise).
/// Shrinking only shrinks the case; the variant is recomputed from the seed.
#[derive(Clone, Debug)]
struct Seeded(Case, u64);

fn seeded() -> ephyra::BoxGen<Seeded> {
    let n = max_steps();
    (move |g: &mut Source| {
        let c = gen_case(g, n);
        let s = (g.int(0..=u32::MAX as i64) as u64) << 16 ^ g.int(0..=0xffff) as u64;
        Seeded(c, s)
    })
    .with_shrink(|s: &Seeded, visit: &mut dyn FnMut(Seeded) -> std::ops::ControlFlow<()>| {
        for c in shrink_case(&s.0) {
            visit(Seeded(c, s.1))?;
        }
        std::ops::ControlFlow::Continue(())
    })
    .boxed()
}

trait Tap { fn tap(self) -> Self; }
impl Tap for ephyra::Report {
    fn tap(self) -> Self {
        eprintln!("[{}] tests={} unique={} discarded={} in {:?}", self.name, self.tests, self.unique_tests, self.discarded, self.duration);
        self
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

const PHASES: &[&str] = &["bootstrap", "pre_data", "data_structures", "routines", "post_data", "privileges"];

/// Same statements, different permutation and split points, optional comment/annotation noise.
fn variant(c: &Case, seed: u64, noise: bool) -> Vec<String> {
    let mut r = Rng(seed);
    let mut order: Vec<usize> = (0..c.stmts.len()).collect();
    for i in (1..order.len()).rev() {
        order.swap(i, r.below(i + 1));
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    for &i in &order {
        if noise {
            match r.below(8) {
                0 => cur.push_str("-- note é😀 ; not a statement\n"),
                1 => cur.push_str("/* block /* nested ; */ ü */ "),
                2 => cur.push_str("-- pg-topo is not a directive here\n--pg-topo:\n"),
                3 => cur.push_str("\n\n\t  "),
                _ => {}
            }
        }
        cur.push_str(&c.stmts[i].sql);
        if noise && r.chance(15) {
            cur.push_str(" /* tail ✓ */");
        }
        cur.push_str(";\n");
        if r.chance(30) {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn valid(c: &Case) -> bool {
    execute(&c.valid_order()).is_ok()
}

fn ensure_ok(r: &TopoResult) {
    if !r.ok {
        signature("analyzeAndSort threw");
        panic!("threw: {}", r.error.clone().unwrap_or_default());
    }
}

fn edge_bag(r: &TopoResult, strip: bool) -> BTreeMap<(String, String), usize> {
    let mut m = BTreeMap::new();
    for (a, b) in &r.edges {
        let k = if strip { (core_sql(a), core_sql(b)) } else { (a.clone(), b.clone()) };
        *m.entry(k).or_insert(0) += 1;
    }
    m
}

fn code_bag(r: &TopoResult) -> BTreeMap<String, usize> {
    let mut m = BTreeMap::new();
    for d in &r.diagnostics {
        *m.entry(d.code.clone()).or_insert(0) += 1;
    }
    m
}

/// Statement text without our injected comments and the terminator.
fn core_sql(s: &str) -> String {
    let mut t = s.trim().to_string();
    loop {
        let before = t.clone();
        for p in ["-- note é😀 ; not a statement\n", "/* block /* nested ; */ ü */ "] {
            if let Some(x) = t.strip_prefix(p) {
                t = x.trim_start().to_string();
            }
        }
        if let Some(x) = t.strip_prefix("-- pg-topo is not a directive here\n--pg-topo:\n") {
            t = x.trim_start().to_string();
        }
        if t.starts_with("-- pg-topo:") {
            t = t.split_once('\n').map(|x| x.1).unwrap_or("").trim_start().to_string();
        }
        if t == before {
            break;
        }
    }
    let t = t.trim_end().trim_end_matches(';').trim_end();
    t.trim_end_matches("/* tail ✓ */").trim_end().to_string()
}

fn diff_bags<K: Ord + Clone + std::fmt::Debug>(a: &BTreeMap<K, usize>, b: &BTreeMap<K, usize>) -> (Vec<K>, Vec<K>) {
    let only_a = a.iter().filter(|(k, v)| b.get(*k).unwrap_or(&0) < v).map(|(k, _)| k.clone()).collect();
    let only_b = b.iter().filter(|(k, v)| a.get(*k).unwrap_or(&0) < v).map(|(k, _)| k.clone()).collect();
    (only_a, only_b)
}

/// The dependency graph is a function of the statements, not of their order or grouping.
#[test]
fn graph_is_order_independent() {
    let cfg = Config::default().tests(tests(1000)).name("graph_is_order_independent");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let a = analyze(&c.inputs());
        let b = analyze(&variant(&c, seed, false));
        ensure_ok(&a);
        ensure_ok(&b);
        let (ea, eb) = diff_bags(&edge_bag(&a, true), &edge_bag(&b, true));
        if !ea.is_empty() || !eb.is_empty() {
            signature("edges depend on input order");
            panic!("edges only in original order: {ea:#?}\nedges only in variant: {eb:#?}");
        }
        let (da, db) = diff_bags(&code_bag(&a), &code_bag(&b));
        if !da.is_empty() || !db.is_empty() {
            signature(format!("diagnostics depend on input order: {da:?} vs {db:?}"));
            panic!("diagnostic codes differ: {da:?} vs {db:?}\n{:#?}\n{:#?}", a.diagnostics, b.diagnostics);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// Comments, unicode and phase annotations do not change the graph, the
/// recovered statement text, or the validity of the order.
#[test]
fn noise_is_inert() {
    let cfg = Config::default().tests(tests(1000)).name("noise_is_inert");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let clean = analyze(&variant(&c, seed, false));
        let noisy_in = variant(&c, seed, true);
        let noisy = analyze(&noisy_in);
        ensure_ok(&clean);
        ensure_ok(&noisy);
        if let Some(d) = noisy.diagnostics.iter().find(|d| d.code == "PARSE_ERROR" || d.code == "INVALID_ANNOTATION") {
            signature(format!("{} under noise", d.code));
            panic!("{}: {}", d.code, d.message);
        }
        // text fidelity: each ordered statement is exactly one original statement
        let mut want: BTreeMap<String, usize> = BTreeMap::new();
        for s in &c.stmts {
            *want.entry(s.sql.trim().to_string()).or_insert(0) += 1;
        }
        let mut got: BTreeMap<String, usize> = BTreeMap::new();
        for o in &noisy.ordered {
            *got.entry(core_sql(&o.sql)).or_insert(0) += 1;
        }
        let (miss, extra) = diff_bags(&want, &got);
        if !miss.is_empty() || !extra.is_empty() {
            signature("statement text not preserved");
            panic!("missing originals: {miss:#?}\nunexpected texts: {extra:#?}");
        }
        let (ea, eb) = diff_bags(&edge_bag(&clean, true), &edge_bag(&noisy, true));
        if !ea.is_empty() || !eb.is_empty() {
            signature("edges change under noise");
            panic!("edges lost under noise: {ea:#?}\nedges gained: {eb:#?}");
        }
        let sorted: Vec<String> = noisy.ordered.iter().map(|o| o.sql.clone()).collect();
        if let Err((i, msg)) = execute(&sorted) {
            signature(format!("noisy order fails: {}", noisy.ordered[i].cls));
            panic!("noisy order fails at {i}: {msg}\n  {}\nINPUTS: {noisy_in:#?}\nORDERED: {sorted:#?}", sorted[i]);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// The filesystem adapter sees the same graph and produces an executable order.
#[test]
fn files_mode_agrees() {
    let cfg = Config::default().tests(tests(500)).name("files_mode_agrees");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let inputs = variant(&c, seed, true);
        let s = analyze(&inputs);
        let f = analyze_mode(&inputs, "files");
        ensure_ok(&s);
        ensure_ok(&f);
        if f.ordered.len() != c.stmts.len() {
            signature("files mode ordered length");
            panic!("files mode returned {} of {} statements; diags {:?}", f.ordered.len(), c.stmts.len(), f.diagnostics);
        }
        let (ea, eb) = diff_bags(&edge_bag(&s, true), &edge_bag(&f, true));
        if !ea.is_empty() || !eb.is_empty() {
            signature("files mode graph differs");
            panic!("only strings: {ea:#?}\nonly files: {eb:#?}");
        }
        let sorted: Vec<String> = f.ordered.iter().map(|o| o.sql.clone()).collect();
        if let Err((i, msg)) = execute(&sorted) {
            signature(format!("files order fails: {}", f.ordered[i].cls));
            panic!("files order fails at {i}: {msg}\n  {}\nINPUTS: {inputs:#?}\nORDERED: {sorted:#?}", sorted[i]);
        }
        let v = analyze_mode(&inputs, "validate");
        if let Some(d) = v.diagnostics.first() {
            signature("validateSqlSyntax rejects valid SQL");
            panic!("{}", d.message);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// A genuine cycle is reported, nothing is dropped, and the acyclic rest still executes.
#[test]
fn injected_cycle_is_contained() {
    let cfg = Config::default().tests(tests(500)).name("injected_cycle_is_contained");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let mut r = Rng(seed ^ 0xC1C1E);
        let a = format!("public.cyc_a{}", seed % 1000);
        let b = format!("public.cyc_b{}", seed % 1000);
        let ca = format!("create table {a} (id int primary key, o int references {b})");
        let cb = format!("create table {b} (id int primary key, o int references {a})");
        let mut inputs = variant(&c, seed, false);
        for s in [ca.clone(), cb.clone()] {
            let at = r.below(inputs.len() + 1);
            inputs.insert(at, format!("{s};\n"));
        }
        let res = analyze(&inputs);
        ensure_ok(&res);
        if res.ordered.len() != c.stmts.len() + 2 {
            signature("cycle drops statements");
            panic!("ordered {} of {}", res.ordered.len(), c.stmts.len() + 2);
        }
        if !res.diagnostics.iter().any(|d| d.code == "CYCLE_DETECTED") {
            signature("cycle not reported");
            panic!("no CYCLE_DETECTED; diags {:?}", res.diagnostics);
        }
        let in_group = res.cycles.iter().any(|g| g.iter().any(|s| s.contains(&a)) && g.iter().any(|s| s.contains(&b)));
        if !in_group {
            signature("cycle group misses injected pair");
            panic!("cycleGroups {:?}", res.cycles);
        }
        let rest: Vec<String> = res.ordered.iter().map(|o| o.sql.clone()).filter(|s| !s.contains("cyc_")).collect();
        if let Err((i, msg)) = execute(&rest) {
            signature("acyclic rest fails after cycle");
            panic!("rest fails at {i}: {msg}\n  {}", rest[i]);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// Every statement gets a random `-- pg-topo:phase` annotation. Phases only break
/// ties, so a missing dependency edge that the default phase order was hiding
/// now shows up as an execution failure.
#[test]
fn phase_inversion() {
    let cfg = Config::default().tests(tests(1000)).name("phase_inversion");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if pg_topo_ephyra::schema::masked("addcol") && c.stmts.iter().any(|s| s.sql.contains("ADD COLUMN")) {
            ephyra::assume!(false);
        }
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let mut r = Rng(seed ^ 0xFA5E);
        let inputs: Vec<String> = variant(&c, seed, false)
            .into_iter()
            .map(|inp| {
                inp.split(";\n")
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| {
                        let ph = PHASES[r.below(PHASES.len())];
                        // producers/consumers of edges already known missing keep their default phase
                        let up = s.trim_start().to_uppercase();
                        let known = ["CREATE ROLE", "CREATE EXTENSION", "CREATE COLLATION", "CREATE SCHEMA", "COMMENT ON COLUMN"]
                            .iter()
                            .any(|k| up.starts_with(k));
                        if known && pg_topo_ephyra::schema::masked("phase_known") {
                            format!("{s};\n")
                        } else {
                            format!("-- pg-topo:phase {ph}\n{s};\n")
                        }
                    })
                    .collect::<String>()
            })
            .collect();
        let res = analyze(&inputs);
        ensure_ok(&res);
        if let Some(d) = res.diagnostics.iter().find(|d| d.code == "INVALID_ANNOTATION" || d.code == "PARSE_ERROR") {
            signature(format!("{} on phase annotation", d.code));
            panic!("{}: {}", d.code, d.message);
        }
        if res.ordered.len() != c.stmts.len() {
            ephyra::assume!(false);
        }
        let sorted: Vec<String> = res.ordered.iter().map(|o| o.sql.clone()).collect();
        if let Err((i, msg)) = execute(&sorted) {
            let norm = msg.split('"').enumerate().map(|(k, p)| if k % 2 == 1 { "_" } else { p }).collect::<String>();
            signature(format!("phase-hidden edge: {}: {norm}", res.ordered[i].cls));
            panic!("fails at {i}: {msg}\n  {}\nORDERED: {sorted:#?}", sorted[i]);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// pg_dump round trip: dump a generated schema, shuffle the dump's statements,
/// sort them with pg-topo and restore into an empty database.
#[test]
fn dump_roundtrip() {
    use pg_topo_ephyra::driver::{drop_test_roles, dump_schema, execute_in};
    let tag = std::env::var("PGTOPO_DUMP_TAG").unwrap_or_else(|_| "rt".into());
    let cfg = Config::default().tests(tests(200)).name("dump_roundtrip");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        drop_test_roles();
        let dump = match dump_schema(&tag, &c.valid_order()) {
            Ok(d) => d,
            Err(e) => {
                drop_test_roles();
                // the generator's valid order failed outside a transaction: not pg-topo's concern
                eprintln!("skip: {e}");
                ephyra::assume!(false);
                unreachable!()
            }
        };
        let whole = analyze(&[dump.clone()]);
        ensure_ok(&whole);
        let stmts: Vec<String> = whole.ordered.iter().map(|o| o.sql.clone()).collect();
        // baseline: dump order itself restores (pg-topo kept the dump order? no: use the raw dump)
        if let Err((_, msg)) = execute_in(&tag, &[dump.clone()]) {
            drop_test_roles();
            eprintln!("skip: raw dump does not restore: {msg}");
            ephyra::assume!(false);
        }
        let check_order = |label: &str, res: &TopoResult| {
            let sorted: Vec<String> = res.ordered.iter().map(|o| o.sql.clone()).collect();
            if let Err((i, msg)) = execute_in(&tag, &sorted) {
                let norm = msg.split('"').enumerate().map(|(k, p)| if k % 2 == 1 { "_" } else { p }).collect::<String>();
                let norm = match norm.find(" does not exist") {
                    Some(_) => format!("{} does not exist", norm.split_whitespace().next().unwrap_or("")),
                    None => norm,
                };
                drop_test_roles();
                signature(format!("dump {label}: {}: {norm}", res.ordered[i].cls));
                panic!("dump {label} order fails at {i}: {msg}\n  {}\nDUMP:\n{dump}\nORDERED: {sorted:#?}", sorted[i]);
            }
        };
        check_order("as-is", &whole);
        let mut r = Rng(seed ^ 0xD0D0);
        let mut idx: Vec<usize> = (0..stmts.len()).collect();
        for i in (1..idx.len()).rev() {
            idx.swap(i, r.below(i + 1));
        }
        let mut inputs = Vec::new();
        let mut cur = String::new();
        for i in idx {
            cur.push_str(&stmts[i]);
            if !stmts[i].trim_end().ends_with(';') {
                cur.push(';');
            }
            cur.push('\n');
            if r.chance(25) {
                inputs.push(std::mem::take(&mut cur));
            }
        }
        if !cur.is_empty() {
            inputs.push(cur);
        }
        let shuffled = analyze(&inputs);
        ensure_ok(&shuffled);
        check_order("shuffled", &shuffled);
        drop_test_roles();
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}


fn ann_ident(s: &str) -> String {
    let simple = s.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c == '_')
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if simple { s.to_string() } else { format!("\"{}\"", s.replace('"', "\"\"")) }
}

/// Restating a real dependency as a `requires` / `depends_on` annotation, using
/// pg-topo's own key for the producer, is accepted, resolves, and yields the edge.
#[test]
fn annotation_roundtrip() {
    let cfg = Config::default().tests(tests(1000)).name("annotation_roundtrip");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if c.stmts.len() < 2 || !valid(&c) {
            ephyra::assume!(false);
        }
        let base = analyze(&variant(&c, seed, false));
        ensure_ok(&base);
        let prov_of = |sql: &str| base.ordered.iter().find(|o| core_sql(&o.sql) == sql.trim()).map(|o| o.provides.clone()).unwrap_or_default();
        let mut r = Rng(seed ^ 0xA77);
        let j = 1 + r.below(c.stmts.len() - 1);
        let i = r.below(j);
        const KINDS: &[&str] = &["table", "view", "materialized_view", "function", "procedure", "type", "domain", "sequence", "schema", "collation", "aggregate"];
        let provs: Vec<_> = prov_of(&c.stmts[i].sql).into_iter().filter(|p| KINDS.contains(&p.kind.as_str())).collect();
        if provs.is_empty() {
            ephyra::assume!(false);
        }
        let p = &provs[r.below(provs.len())];
        let qualified = match &p.schema {
            Some(s) => format!("{}.{}", ann_ident(s), ann_ident(&p.name)),
            None => ann_ident(&p.name),
        };
        let relation = matches!(p.kind.as_str(), "table" | "view" | "materialized_view");
        let directive = if relation && r.chance(40) {
            format!("depends_on {qualified}")
        } else {
            let kind = if r.chance(30) { p.kind.to_uppercase() } else { p.kind.clone() };
            let sig = p.signature.clone().map(|sg| if r.chance(50) { respell_sig(&sg, &mut r) } else { sg }).unwrap_or_default();
            let sep = if r.chance(20) { ": " } else { ":" };
            format!("requires {kind}{sep}{qualified}{sig}")
        };
        let mut stmts: Vec<String> = c.stmts.iter().map(|s| s.sql.clone()).collect();
        stmts[j] = format!("-- pg-topo:{directive}\n{}", stmts[j]);
        let mut order: Vec<usize> = (0..stmts.len()).collect();
        for k in (1..order.len()).rev() {
            order.swap(k, r.below(k + 1));
        }
        let inputs: Vec<String> = order.iter().map(|&k| format!("{};\n", stmts[k])).collect();
        let res = analyze(&inputs);
        ensure_ok(&res);
        if let Some(d) = res.diagnostics.iter().find(|d| d.code == "INVALID_ANNOTATION") {
            signature(format!("INVALID_ANNOTATION for {} key", p.kind));
            panic!("{directive}: {}", d.message);
        }
        if let Some(d) = res.diagnostics.iter().find(|d| d.code == "UNRESOLVED_DEPENDENCY" && d.message.contains(&format!("'{}:", p.kind)) && d.message.contains(&p.name)) {
            signature(format!("annotation key does not resolve: {} ({})", p.kind, if directive.starts_with("depends_on") { "depends_on" } else { "requires" }));
            panic!("{directive}\n{}\nprovides: {p:?}", d.message);
        }
        let want = (core_sql(&c.stmts[i].sql), core_sql(&stmts[j]));
        if !res.edges.iter().any(|(a, b)| core_sql(a) == want.0 && core_sql(b) == want.1) {
            signature(format!("annotation edge missing: {}", p.kind));
            panic!("{directive}\nexpected edge {:?} -> {:?}", want.0, want.1);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}


/// Same signature, spelled the way a person would write it.
fn respell_sig(sig: &str, r: &mut Rng) -> String {
    let inner = sig.trim_start_matches('(').trim_end_matches(')');
    if inner.is_empty() {
        return sig.to_string();
    }
    let parts: Vec<String> = inner
        .split(',')
        .map(|t| {
            let t = t.trim();
            if let Some(b) = t.strip_prefix("pg_catalog.") {
                let syn: &[&str] = match b {
                    "int4" => &["integer", "int", "INT4", "pg_catalog.int4"],
                    "int8" => &["bigint", "INT8"],
                    "int2" => &["smallint"],
                    "bool" => &["boolean", "BOOL"],
                    "text" => &["TEXT", "text"],
                    "varchar" => &["character varying", "varchar"],
                    // `decimal` is pg-topo bug N14
                    "numeric" => if pg_topo_ephyra::schema::masked("ann_sig") { &["NUMERIC"] } else { &["decimal", "NUMERIC"] },
                    "float8" => &["double precision"],
                    "timestamptz" => &["timestamp with time zone"],
                    _ => &[],
                };
                if syn.is_empty() { t.to_string() } else { syn[r.below(syn.len())].to_string() }
            } else if t.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.' || c == '[' || c == ']') && r.chance(50) {
                t.to_uppercase()
            } else {
                t.to_string()
            }
        })
        .collect();
    let sep = if r.chance(50) { ", " } else { "," };
    format!("({})", parts.join(sep))
}

/// Several FK cycles (length 2–4), some chained to each other by a one-way edge:
/// each cycle is its own cycleGroup with exactly its members, and the rest runs.
#[test]
fn multi_cycles_are_separated() {
    let cfg = Config::default().tests(tests(500)).name("multi_cycles_are_separated");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if !valid(&c) {
            ephyra::assume!(false);
        }
        let mut r = Rng(seed ^ 0x5CC);
        let k = 1 + r.below(3);
        let mut inputs = variant(&c, seed, false);
        let mut groups: Vec<Vec<String>> = Vec::new();
        for g in 0..k {
            let len = 2 + r.below(3);
            let names: Vec<String> = (0..len).map(|m| format!("public.cyc{g}_{m}")).collect();
            for m in 0..len {
                let next = &names[(m + 1) % len];
                // chain cycle g to cycle g-1 with a one-way FK: separate SCCs, ordered
                let bridge = if g > 0 && m == 0 { format!(", b int references public.cyc{}_0", g - 1) } else { String::new() };
                let s = format!("create table {} (id int primary key, o int references {next}{bridge});\n", names[m]);
                let at = r.below(inputs.len() + 1);
                inputs.insert(at, s);
            }
            groups.push(names);
        }
        let res = analyze(&inputs);
        ensure_ok(&res);
        let total: usize = groups.iter().map(|g| g.len()).sum();
        if res.ordered.len() != c.stmts.len() + total {
            signature("multi-cycle drops statements");
            panic!("ordered {} of {}", res.ordered.len(), c.stmts.len() + total);
        }
        for g in &groups {
            let found = res.cycles.iter().find(|cg| cg.iter().any(|s| s.contains(&format!("{} ", g[0]))));
            let Some(cg) = found else {
                signature("cycle not grouped");
                panic!("no cycleGroup for {g:?}; groups {:?}", res.cycles);
            };
            let members: Vec<&String> = cg.iter().collect();
            let ok = members.len() == g.len() && g.iter().all(|n| members.iter().any(|s| s.contains(&format!("{n} "))));
            if !ok {
                signature("cycleGroup has wrong members");
                panic!("expected {g:?}, got {members:#?}");
            }
        }
        // README: cycle blocks follow condensation-DAG order
        let pos = |n: &str| res.ordered.iter().position(|o| o.sql.contains(&format!("{n} "))).unwrap();
        for g in 1..groups.len() {
            let prev_last = groups[g - 1].iter().map(|n| pos(n)).max().unwrap();
            let this_first = groups[g].iter().map(|n| pos(n)).min().unwrap();
            if prev_last > this_first {
                signature("cycle blocks not in condensation order");
                panic!("block {:?} interleaves with / follows {:?}", groups[g - 1], groups[g]);
            }
        }
        let rest: Vec<String> = res.ordered.iter().map(|o| o.sql.clone()).filter(|s| !s.contains("cyc")).collect();
        if let Err((i, msg)) = execute(&rest) {
            signature("acyclic rest fails after multi-cycle");
            panic!("rest fails at {i}: {msg}\n  {}", rest[i]);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// A syntax error in one input never throws, never loses or alters the
/// statements of the other inputs, and never invents statement text.
#[test]
fn corrupt_input_is_contained() {
    let cfg = Config::default().tests(tests(1000)).name("corrupt_input_is_contained");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        let mut inputs = variant(&c, seed, false);
        if inputs.len() < 2 {
            ephyra::assume!(false);
        }
        let mut r = Rng(seed ^ 0xBAD);
        let k = r.below(inputs.len());
        let orig = inputs[k].clone();
        let chars: Vec<char> = orig.chars().collect();
        let at = r.below(chars.len().max(1));
        let bad: String = match r.below(4) {
            0 => chars[..at].iter().collect(),
            1 => format!("{}SELEC FROM ;{}", chars[..at].iter().collect::<String>(), chars[at..].iter().collect::<String>()),
            2 => format!("{orig}CREATE TABLE ;\n"),
            _ => orig.replacen("CREATE", "CRAETE", 1),
        };
        inputs[k] = bad.clone();
        let res = analyze(&inputs);
        ensure_ok(&res);
        let got: Vec<String> = res.ordered.iter().map(|o| core_sql(&o.sql)).collect();
        for (i, inp) in inputs.iter().enumerate() {
            if i == k {
                continue;
            }
            for stmt in inp.split(";\n").map(|s| s.trim()).filter(|s| !s.is_empty()) {
                if !got.iter().any(|g| g == stmt) {
                    signature("statement of an intact input lost after a sibling's syntax error");
                    panic!("lost {stmt:?} (input {i}); corrupted input {k}: {bad:?}\ndiags {:?}", res.diagnostics);
                }
            }
        }
        for g in &got {
            let from_intact = inputs.iter().enumerate().any(|(i, inp)| i != k && inp.contains(g.as_str()));
            if !from_intact && !bad.contains(g.as_str()) {
                signature("invented statement text");
                panic!("ordered contains {g:?}, found in no input");
            }
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}

/// Removing a dependency-closed set of statements and declaring what they
/// provide as `externalProviders` leaves no UNRESOLVED for those objects, and
/// the rest of the order runs once the removed statements exist.
#[test]
fn external_providers_stand_in() {
    use pg_topo_ephyra::driver::analyze_with;
    let cfg = Config::default().tests(tests(1000)).name("external_providers_stand_in");
    check(&cfg, seeded(), |Seeded(c, seed): Seeded| {
        if c.stmts.len() < 3 || !valid(&c) {
            ephyra::assume!(false);
        }
        let base = analyze(&c.inputs());
        ensure_ok(&base);
        let mut r = Rng(seed ^ 0xE47);
        let mut ext = vec![false; c.stmts.len()];
        for _ in 0..1 + r.below(3) {
            ext[r.below(c.stmts.len())] = true;
        }
        // close under dependencies (deps point backwards, so one pass from the end suffices)
        for i in (0..c.stmts.len()).rev() {
            if ext[i] {
                for &d in &c.stmts[i].deps {
                    ext[d] = true;
                }
            }
        }
        if ext.iter().all(|&e| e) {
            ephyra::assume!(false);
        }
        let mut providers = Vec::new();
        let mut names = Vec::new();
        for (_, s) in c.stmts.iter().enumerate().filter(|(i, _)| ext[*i]) {
            if let Some(o) = base.ordered.iter().find(|o| core_sql(&o.sql) == s.sql.trim()) {
                for p in &o.provides {
                    names.push(format!("{}:{}:{}:", p.kind, p.schema.clone().unwrap_or_default(), p.name));
                    let mut v = serde_json::json!({ "kind": p.kind, "name": p.name });
                    if let Some(sc) = &p.schema {
                        v["schema"] = serde_json::json!(sc);
                    }
                    if let Some(sg) = &p.signature {
                        v["signature"] = serde_json::json!(sg);
                    }
                    providers.push(v);
                }
            }
        }
        let rest: Vec<String> = c.stmts.iter().enumerate().filter(|(i, _)| !ext[*i]).map(|(_, s)| format!("{};\n", s.sql)).collect();
        let mut rest = rest;
        for k in (1..rest.len()).rev() {
            rest.swap(k, r.below(k + 1));
        }
        let res = analyze_with(&rest, "strings", serde_json::json!({ "externalProviders": providers }));
        ensure_ok(&res);
        if let Some(d) = res.diagnostics.iter().find(|d| d.code == "UNRESOLVED_DEPENDENCY" && names.iter().any(|n| d.message.contains(n.as_str()))) {
            signature("external provider not honored");
            panic!("{}\nexternal: {names:?}", d.message);
        }
        let mut run: Vec<String> = c.stmts.iter().enumerate().filter(|(i, _)| ext[*i]).map(|(_, s)| s.sql.clone()).collect();
        let first = run.len();
        run.extend(res.ordered.iter().map(|o| o.sql.clone()));
        if let Err((i, msg)) = execute(&run) {
            signature(format!("order with external providers fails: {}", if i >= first { res.ordered[i - first].cls.as_str() } else { "external part" }));
            panic!("fails at {i}: {msg}\n  {}", run[i]);
        }
        ephyra::TestResult::Pass
    })
    .tap()
    .assert_passed();
}
