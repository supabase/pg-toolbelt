//! Third generator: the object kinds the first two never produce, and the
//! dependency chains between them. Function signatures (arguments, return
//! types, OUT / SETOF / TABLE / VARIADIC, overloads), procedures, aggregates,
//! operators, casts, range types, ICU collations, extensions (citext, hstore,
//! pg_trgm, btree_gist), event triggers, rules, constraint triggers,
//! exclusion constraints, expression indexes, views over views and over
//! set-returning functions, publications with column lists and row filters,
//! and postgres_fdw servers, user mappings and foreign tables.
//!
//! Every object is `(kind, n, v)`: `v` is a vector of small integers the
//! renderer reads per kind. That keeps generation, edits and shrinking generic;
//! only `render` knows what a field means. References to other objects are by
//! `n` and are dropped at render time when they do not resolve (or resolve to
//! something unusable there, e.g. a volatile function in an index), so every
//! value renders to SQL that loads.

use ephyra::{Gen, GenExt, Source};
use std::collections::BTreeSet;
use std::fmt::Write;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    Ext,
    Coll,
    Range,
    Comp,
    Fun,
    Proc,
    Agg,
    Op,
    Cast,
    Table,
    View,
    EvtTrig,
    Pub,
    Fdw,
}

/// Generated kinds. `Op` and `Cast` render but are not generated: pg-delta
/// deliberately does not model operators and casts (src/extract/unmodeled.ts:
/// an `unmodeled_kind` warning, delivered through `_custom/`), so every pair
/// that touches one fails by design.
const KINDS: [Kind; 12] = [
    Kind::Ext,
    Kind::Coll,
    Kind::Range,
    Kind::Comp,
    Kind::Fun,
    Kind::Proc,
    Kind::Agg,
    Kind::Table,
    Kind::View,
    Kind::EvtTrig,
    Kind::Pub,
    Kind::Fdw,
];

/// Exclusive upper bound of each field of `v`, per kind.
fn ranges(k: Kind) -> &'static [u8] {
    match k {
        // which extension (n is ignored), schema public / ext
        Kind::Ext => &[4, 2],
        // icu nondeterministic, icu deterministic, from "C", icu level2 nondeterministic; comment
        Kind::Coll => &[4, 2],
        // subtype int4 / numeric / date; comment
        Kind::Range => &[3, 2],
        // attribute set; comment
        Kind::Comp => &[4, 2],
        // sig, lang, body, volatility, flags (strict 1, secdef 2, SET 4, revoke public 8, comment 16), overload
        Kind::Fun => &[7, 3, 3, 3, 32, 2],
        // sig, lang, body, flags (secdef 1, SET 2, comment 4)
        Kind::Proc => &[3, 2, 3, 8],
        // k, initcond, parallel, finalfunc, comment
        Kind::Agg => &[3, 3, 2, 2, 2],
        // k, commutator, comment
        Kind::Op => &[3, 2, 2],
        // composite ref, method (function / inout), context, k
        Kind::Cast => &[4, 2, 3, 3],
        // 3 x (column kind, ref), index kind, index ref, exclusion, trigger kind, trigger body,
        // rule, policy func ref (0 none), flags (unlogged 1, comment 2)
        Kind::Table => &[13, 4, 13, 4, 13, 4, 5, 4, 2, 6, 3, 4, 5, 4],
        // src kind, src ref, extra col kind, extra ref, aliases, materialized,
        // check option, label column, comment, security_barrier
        Kind::View => &[4, 4, 4, 4, 3, 2, 2, 3, 2, 2],
        // event, tags, enable state, body, comment
        Kind::EvtTrig => &[3, 4, 4, 3, 2],
        // mode, table ref, second table ref (0 none), column list, row filter, publish
        Kind::Pub => &[3, 4, 5, 2, 2, 3],
        // host, port, user mapping, mapping user, foreign table, remote table name
        Kind::Fdw => &[3, 2, 3, 3, 3, 3],
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Obj {
    pub kind: Kind,
    pub n: u8,
    pub v: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Db {
    pub objs: Vec<Obj>,
}

/// Postgres 15+ features (publication column lists, row filters, schemas).
fn pg15() -> bool {
    !std::env::var("PGDELTA_TEST_IMAGE").unwrap_or_default().contains(":14")
}

fn count(k: Kind) -> u8 {
    match k {
        Kind::Ext => 4,
        Kind::EvtTrig | Kind::Fdw | Kind::Pub => 2,
        _ => 4,
    }
}

// ------------------------------------------------------------------ render

struct R<'a> {
    d: &'a Db,
}

impl<'a> R<'a> {
    fn get(&self, k: Kind, n: u8) -> Option<&'a Obj> {
        self.d.objs.iter().find(|o| o.kind == k && o.n == n)
    }
    fn ext(&self, which: u8) -> Option<&'static str> {
        let o = self.d.objs.iter().find(|o| o.kind == Kind::Ext && o.v[0] == which)?;
        Some(if o.v[1] == 1 { "ext" } else { "public" })
    }
    /// An integer-valued call of function `n` on `arg`, if it has a scalar
    /// signature; `immutable` requires the function to be IMMUTABLE.
    fn fcall(&self, n: u8, arg: &str, immutable: bool) -> Option<String> {
        let f = self.get(Kind::Fun, n)?;
        if immutable && f.v[3] != 2 {
            return None;
        }
        match f.v[0] {
            0 | 1 | 2 => Some(format!("public.f{n}({arg})")),
            // VARIADIC needs at least one element
            6 => Some(format!("public.f{n}({arg}, 0)")),
            3 => Some(format!("(public.f{n}({arg})).r")),
            _ => None,
        }
    }
    fn op(&self, n: u8) -> Option<String> {
        self.get(Kind::Op, n).map(|_| format!("OPERATOR(public.#{}#)", "+".repeat(n as usize + 1)))
    }
}

fn comment(o: &mut String, on: &str, flag: bool, what: &str) {
    if flag {
        let _ = writeln!(o, "COMMENT ON {on} IS '{what}';");
    }
}

const VOL: [&str; 3] = ["VOLATILE", "STABLE", "IMMUTABLE"];

fn fun_sql(o: &mut String, n: u8, v: &[u8]) {
    let (sig, lang, k) = (v[0], v[1], v[2]);
    let (args, ret) = match sig {
        0 => ("x integer", "RETURNS integer"),
        1 => ("x integer, y integer DEFAULT 1", "RETURNS integer"),
        2 => ("a integer", "RETURNS bigint"),
        3 => ("x integer, OUT r integer, OUT s text", ""),
        4 => ("x integer", "RETURNS SETOF integer"),
        5 => ("x integer", "RETURNS TABLE(r integer, s text)"),
        _ => ("x integer, VARIADIC ys integer[]", "RETURNS integer"),
    };
    // BEGIN ATOMIC only where its body is a single scalar SELECT
    let lang = if lang == 2 && !matches!(sig, 0 | 1 | 2 | 6) { 0 } else { lang };
    let body = match (lang, sig) {
        (1, 0) | (1, 6) => format!("BEGIN RETURN x + {k}; END"),
        (1, 1) => format!("BEGIN RETURN x + y + {k}; END"),
        (1, 2) => format!("BEGIN RETURN a + {k}; END"),
        (1, 3) => format!("BEGIN r := x + {k}; s := 's{k}'; END"),
        (1, 4) => format!("BEGIN RETURN QUERY SELECT generate_series(1, x + {k}); END"),
        (1, 5) => format!("BEGIN RETURN QUERY SELECT x + {k}, 's{k}'::text; END"),
        (_, 0) => format!("SELECT x + {k}"),
        (_, 1) => format!("SELECT x + y + {k}"),
        (_, 2) => format!("SELECT (a + {k})::bigint"),
        (_, 3) => format!("SELECT x + {k}, 's{k}'::text"),
        (_, 4) => format!("SELECT generate_series(1, x + {k})"),
        (_, 5) => format!("SELECT x + {k}, 's{k}'::text"),
        _ => format!("SELECT x + {k} + coalesce(array_length(ys, 1), 0)"),
    };
    let flags = v[4];
    let mut head = format!("LANGUAGE {} {}", ["sql", "plpgsql", "sql"][lang as usize], VOL[v[3] as usize]);
    if flags & 1 != 0 {
        head += " STRICT";
    }
    if flags & 2 != 0 {
        head += " SECURITY DEFINER";
    }
    if flags & 4 != 0 {
        head += " SET search_path = pg_catalog, public";
    }
    let def = if lang == 2 { format!("BEGIN ATOMIC\n  {body};\nEND") } else { format!("AS $f${body}$f$") };
    let _ = writeln!(o, "CREATE FUNCTION public.f{n}({args}) {ret} {head}\n{def};");
    let sigtext = match sig {
        3 => "integer".to_string(),
        6 => "integer, integer[]".to_string(),
        1 => "integer, integer".to_string(),
        _ => "integer".to_string(),
    };
    if flags & 8 != 0 {
        let _ = writeln!(o, "REVOKE EXECUTE ON FUNCTION public.f{n}({sigtext}) FROM PUBLIC;");
    }
    comment(o, &format!("FUNCTION public.f{n}({sigtext})"), flags & 16 != 0, &format!("f{n}"));
    if v[5] == 1 {
        let _ = writeln!(o, "CREATE FUNCTION public.f{n}(x text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$SELECT x || '{k}'$f$;");
    }
}

pub fn render(d: &Db) -> String {
    let r = R { d };
    let mut o = String::new();
    let mut objs: Vec<&Obj> = d.objs.iter().collect();
    objs.sort_by_key(|x| (x.kind, x.n));
    if objs.iter().any(|x| x.kind == Kind::Ext && x.v[1] == 1) {
        o += "CREATE SCHEMA ext;\n";
    }
    let mut seen = BTreeSet::new();
    for x in &objs {
        if !seen.insert((x.kind, if x.kind == Kind::Ext { x.v[0] } else { x.n })) {
            continue;
        }
        let (n, v) = (x.n, &x.v);
        match x.kind {
            Kind::Ext => {
                let name = ["citext", "hstore", "pg_trgm", "btree_gist"][v[0] as usize];
                let _ = writeln!(o, "CREATE EXTENSION {name} SCHEMA {};", if v[1] == 1 { "ext" } else { "public" });
            }
            Kind::Coll => {
                let def = match v[0] {
                    0 => "(provider = icu, locale = 'und', deterministic = false)",
                    1 => "(provider = icu, locale = 'und')",
                    2 => "FROM \"C\"",
                    _ => "(provider = icu, locale = 'und-u-ks-level2', deterministic = false)",
                };
                let _ = writeln!(o, "CREATE COLLATION public.co{n} {def};");
                comment(&mut o, &format!("COLLATION public.co{n}"), v[1] == 1, "coll");
            }
            Kind::Range => {
                let _ = writeln!(o, "CREATE TYPE public.r{n} AS RANGE (SUBTYPE = {});", ["integer", "numeric", "date"][v[0] as usize]);
                comment(&mut o, &format!("TYPE public.r{n}"), v[1] == 1, "range");
            }
            Kind::Comp => {
                let attrs = ["a integer, b text", "a integer, b text, c date", "a bigint, b text", "a integer"][v[0] as usize];
                let _ = writeln!(o, "CREATE TYPE public.c{n} AS ({attrs});");
                comment(&mut o, &format!("TYPE public.c{n}"), v[1] == 1, "comp");
            }
            Kind::Fun => fun_sql(&mut o, n, v),
            Kind::Proc => {
                let k = v[2];
                let args = ["x integer", "x integer, INOUT y integer", "x integer, y text DEFAULT 'd'"][v[0] as usize];
                let body = match (v[1], v[0]) {
                    (1, 1) => format!("BEGIN y := x + {k}; END"),
                    (1, _) => format!("BEGIN PERFORM x + {k}; END"),
                    (_, 1) => format!("SELECT x + {k}"),
                    _ => format!("SELECT x + {k}"),
                };
                let mut head = format!("LANGUAGE {}", ["sql", "plpgsql"][v[1] as usize]);
                if v[3] & 1 != 0 {
                    head += " SECURITY DEFINER";
                }
                if v[3] & 2 != 0 {
                    head += " SET search_path = pg_catalog";
                }
                let _ = writeln!(o, "CREATE PROCEDURE public.p{n}({args}) {head} AS $p${body}$p$;");
                let sig = ["integer", "integer, integer", "integer, text"][v[0] as usize];
                comment(&mut o, &format!("PROCEDURE public.p{n}({sig})"), v[3] & 4 != 0, "proc");
            }
            Kind::Agg => {
                let k = v[0] + 1;
                let _ = writeln!(o, "CREATE FUNCTION public.agg_sf{n}(s integer, x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT s + x * {k}$f$;");
                let mut opts = format!("SFUNC = public.agg_sf{n}, STYPE = integer, INITCOND = '{}'", v[1]);
                if v[3] == 1 {
                    let _ = writeln!(o, "CREATE FUNCTION public.agg_ff{n}(s integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT s * 2$f$;");
                    opts += &format!(", FINALFUNC = public.agg_ff{n}");
                }
                if v[2] == 1 {
                    opts += ", PARALLEL = SAFE";
                }
                let _ = writeln!(o, "CREATE AGGREGATE public.a{n}(integer) ({opts});");
                comment(&mut o, &format!("AGGREGATE public.a{n}(integer)"), v[4] == 1, "agg");
            }
            Kind::Op => {
                let name = format!("#{}#", "+".repeat(n as usize + 1));
                let _ = writeln!(o, "CREATE FUNCTION public.op_f{n}(a integer, b integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT a + b * {}$f$;", v[0] + 1);
                let comm = if v[1] == 1 && v[0] == 0 { format!(", COMMUTATOR = {name}") } else { String::new() };
                let _ = writeln!(o, "CREATE OPERATOR public.{name} (LEFTARG = integer, RIGHTARG = integer, FUNCTION = public.op_f{n}{comm});");
                comment(&mut o, &format!("OPERATOR public.{name} (integer, integer)"), v[2] == 1, "op");
            }
            Kind::Cast => {
                let Some(c) = r.get(Kind::Comp, v[0]) else { continue };
                // one cast per source type
                if !seen.insert((Kind::Cast, 100 + c.n)) {
                    continue;
                }
                let src = format!("public.c{}", c.n);
                let ctx = ["", " AS ASSIGNMENT", " AS IMPLICIT"][v[2] as usize];
                if v[1] == 0 {
                    let a = if c.v[0] == 2 { "(($1).a)::integer" } else { "($1).a" };
                    let _ = writeln!(o, "CREATE FUNCTION public.cast_f{n}({src}) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT {a} + {}$f$;", v[3]);
                    let _ = writeln!(o, "CREATE CAST ({src} AS integer) WITH FUNCTION public.cast_f{n}({src}){ctx};");
                } else {
                    let _ = writeln!(o, "CREATE CAST ({src} AS integer) WITH INOUT{ctx};");
                }
            }
            Kind::Table => table_sql(&r, &mut o, n, v),
            Kind::View => view_sql(&r, &mut o, n, v),
            Kind::EvtTrig => {
                let _ = writeln!(o, "CREATE FUNCTION public.etf{n}() RETURNS event_trigger LANGUAGE plpgsql AS $f$BEGIN PERFORM {}; END$f$;", v[3]);
                let event = ["ddl_command_end", "ddl_command_start", "sql_drop"][v[0] as usize];
                let tags = match v[1] {
                    1 => " WHEN TAG IN ('CREATE TABLE')",
                    2 => " WHEN TAG IN ('DROP TABLE')",
                    3 => " WHEN TAG IN ('CREATE TABLE', 'DROP TABLE')",
                    _ => "",
                };
                let _ = writeln!(o, "CREATE EVENT TRIGGER et{n} ON {event}{tags} EXECUTE FUNCTION public.etf{n}();");
                match v[2] {
                    1 => o += &format!("ALTER EVENT TRIGGER et{n} DISABLE;\n"),
                    2 => o += &format!("ALTER EVENT TRIGGER et{n} ENABLE REPLICA;\n"),
                    3 => o += &format!("ALTER EVENT TRIGGER et{n} ENABLE ALWAYS;\n"),
                    _ => {}
                }
                comment(&mut o, &format!("EVENT TRIGGER et{n}"), v[4] == 1, "evt");
            }
            Kind::Pub => {
                let mode = if pg15() { v[0] } else { v[0].min(1) * 2 % 3 };
                let target = match mode {
                    1 => "FOR TABLES IN SCHEMA public".to_string(),
                    2 => "FOR ALL TABLES".to_string(),
                    _ => {
                        let mut ts = Vec::new();
                        for (i, tr) in [Some(v[1]), v[2].checked_sub(1)].into_iter().enumerate() {
                            let Some(t) = tr.and_then(|t| r.get(Kind::Table, t)) else { continue };
                            if ts.iter().any(|s: &String| s.starts_with(&format!("public.t{} ", t.n)) || *s == format!("public.t{}", t.n)) {
                                continue;
                            }
                            // unlogged tables cannot be published
                            if t.v[13] & 1 != 0 {
                                continue;
                            }
                            let mut s = format!("public.t{}", t.n);
                            if pg15() && i == 0 && v[3] == 1 {
                                s += " (id)";
                            }
                            if pg15() && i == 0 && v[4] == 1 {
                                s += " WHERE (id > 0)";
                            }
                            ts.push(s);
                        }
                        if ts.is_empty() {
                            String::new()
                        } else {
                            format!("FOR TABLE {}", ts.join(", "))
                        }
                    }
                };
                let with = match v[5] {
                    1 => " WITH (publish = 'insert')",
                    2 => " WITH (publish = 'insert, update')",
                    _ => "",
                };
                let _ = writeln!(o, "CREATE PUBLICATION pb{n} {target}{with};");
            }
            Kind::Fdw => {
                if !o.contains("CREATE EXTENSION postgres_fdw") {
                    o += "CREATE EXTENSION postgres_fdw;\n";
                }
                let _ = writeln!(o, "CREATE SERVER sv{n} FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'h{}', dbname 'd'{});", v[0], if v[1] == 1 { ", port '5433'" } else { "" });
                match v[2] {
                    1 => o += &format!("CREATE USER MAPPING FOR PUBLIC SERVER sv{n} OPTIONS (user 'u{}');\n", v[3]),
                    2 => o += &format!("CREATE USER MAPPING FOR CURRENT_USER SERVER sv{n} OPTIONS (user 'u{}');\n", v[3]),
                    _ => {}
                }
                match v[4] {
                    1 => o += &format!("CREATE FOREIGN TABLE public.ft{n} (a integer) SERVER sv{n} OPTIONS (table_name 'rt{}');\n", v[5]),
                    2 => o += &format!("CREATE FOREIGN TABLE public.ft{n} (a integer, b text OPTIONS (column_name 'bb')) SERVER sv{n} OPTIONS (schema_name 's', table_name 'rt{}');\n", v[5]),
                    _ => {}
                }
            }
        }
    }
    o
}

/// One table column: `(definition, tag)`, tag 0 integer, 1 text, 2 range,
/// 3 anything else; `None` for "no column".
fn column(r: &R, j: usize, kind: u8, rf: u8) -> Option<(String, u8)> {
    let c = format!("c{j}");
    let int = || Some((format!("{c} integer"), 0));
    match kind {
        0 => None,
        1 => int(),
        2 => Some((format!("{c} text"), 1)),
        3 => r.get(Kind::Range, rf).map(|_| (format!("{c} public.r{rf}"), 2)).or_else(int),
        4 => r.ext(0).map(|s| (format!("{c} {s}.citext"), 3)).or_else(int),
        5 => r.ext(1).map(|s| (format!("{c} {s}.hstore"), 3)).or_else(int),
        6 => r.get(Kind::Coll, rf).map(|_| (format!("{c} text COLLATE public.co{rf}"), 3)).or_else(int),
        7 => r.get(Kind::Comp, rf).map(|_| (format!("{c} public.c{rf}"), 3)).or_else(int),
        8 => r.fcall(rf, "1", false).map(|e| (format!("{c} integer DEFAULT {e}"), 0)).or_else(int),
        9 => r.fcall(rf, "id", true).map(|e| (format!("{c} integer GENERATED ALWAYS AS ({e}) STORED"), 0)).or_else(int),
        10 => r.fcall(rf, &c, false).map(|e| (format!("{c} integer CHECK ({e} IS NOT NULL)"), 0)).or_else(int),
        11 => r.op(rf).map(|op| (format!("{c} integer CHECK (({c} {op} 1) > -1000)"), 0)).or_else(int),
        _ => r.get(Kind::Range, rf).filter(|_| r.ext(3).is_some()).map(|_| (format!("{c} public.r{rf}"), 4)).or_else(int),
    }
}

fn table_sql(r: &R, o: &mut String, n: u8, v: &[u8]) {
    let t = format!("public.t{n}");
    let mut defs = vec!["id integer PRIMARY KEY".to_string()];
    // (index, tag): tag 4 is a range column usable with btree_gist
    let mut cols: Vec<(usize, u8)> = Vec::new();
    for j in 0..3 {
        if let Some((d, tag)) = column(r, j, v[2 * j], v[2 * j + 1]) {
            defs.push(d);
            cols.push((j, tag));
        }
    }
    let unlogged = if v[13] & 1 != 0 { "UNLOGGED " } else { "" };
    // exclusion constraint over a range column (with btree_gist: also over id)
    if v[8] == 1 {
        if let Some((j, tag)) = cols.iter().find(|c| c.1 == 2 || c.1 == 4) {
            if *tag == 4 {
                defs.push(format!("EXCLUDE USING gist (id WITH =, c{j} WITH &&)"));
            } else {
                defs.push(format!("EXCLUDE USING gist (c{j} WITH &&)"));
            }
        }
    }
    let _ = writeln!(o, "CREATE {unlogged}TABLE {t} ({});", defs.join(", "));
    let text_col = cols.iter().find(|c| c.1 == 1).map(|c| c.0);
    match v[6] {
        1 => {
            if let Some(e) = r.fcall(v[7], "id", true) {
                let _ = writeln!(o, "CREATE INDEX t{n}_ix ON {t} (({e}));");
            }
        }
        2 => {
            if let (Some(s), Some(j)) = (r.ext(2), text_col) {
                let _ = writeln!(o, "CREATE INDEX t{n}_ix ON {t} USING gin (c{j} {s}.gin_trgm_ops);");
            }
        }
        3 => {
            if let Some(op) = r.op(v[7]) {
                let _ = writeln!(o, "CREATE INDEX t{n}_ix ON {t} ((id {op} 1));");
            }
        }
        4 => {
            if let Some(e) = r.fcall(v[7], "id", true) {
                let _ = writeln!(o, "CREATE INDEX t{n}_ix ON {t} (id) WHERE {e} > 0;");
            }
        }
        _ => {}
    }
    if v[9] != 0 {
        let k = v[10];
        let _ = writeln!(o, "CREATE FUNCTION public.tf{n}() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN PERFORM {k}; RETURN NEW; END$f$;");
        let first_col = cols.first().map(|c| c.0);
        let tr = match v[9] {
            1 => format!("CREATE TRIGGER t{n}_tr BEFORE INSERT ON {t} FOR EACH ROW EXECUTE FUNCTION public.tf{n}();"),
            2 => match first_col {
                Some(j) => format!("CREATE TRIGGER t{n}_tr AFTER UPDATE OF c{j} ON {t} FOR EACH ROW WHEN (NEW.id > {k}) EXECUTE FUNCTION public.tf{n}();"),
                None => format!("CREATE TRIGGER t{n}_tr AFTER UPDATE ON {t} FOR EACH ROW WHEN (NEW.id > {k}) EXECUTE FUNCTION public.tf{n}();"),
            },
            3 => format!("CREATE TRIGGER t{n}_tr AFTER INSERT ON {t} FOR EACH STATEMENT EXECUTE FUNCTION public.tf{n}();"),
            4 => format!("CREATE CONSTRAINT TRIGGER t{n}_tr AFTER INSERT ON {t} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tf{n}();"),
            // AFTER: a BEFORE trigger's WHEN cannot read NEW generated columns
            _ => format!("CREATE TRIGGER t{n}_tr AFTER UPDATE ON {t} FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION public.tf{n}();"),
        };
        o.push_str(&tr);
        o.push('\n');
    }
    match v[11] {
        1 => {
            let _ = writeln!(o, "CREATE RULE t{n}_rl AS ON UPDATE TO {t} WHERE NEW.id < 0 DO INSTEAD NOTHING;");
        }
        2 => {
            let _ = writeln!(o, "CREATE RULE t{n}_rl AS ON DELETE TO {t} DO ALSO NOTHING;");
        }
        3 => {
            let _ = writeln!(o, "CREATE RULE t{n}_rl AS ON DELETE TO {t} WHERE OLD.id < 0 DO INSTEAD NOTHING;");
        }
        _ => {}
    }
    if let Some(f) = v[12].checked_sub(1) {
        if let Some(e) = r.fcall(f, "id", false) {
            let _ = writeln!(o, "ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;");
            let _ = writeln!(o, "CREATE POLICY t{n}_pol ON {t} USING ({e} > 0);");
        }
    }
    comment(o, &format!("TABLE {t}"), v[13] & 2 != 0, &format!("t{n}"));
}

/// Whether view `n` renders and exposes an `id` column (views on views need it).
fn view_has_id(r: &R, n: u8, depth: u8) -> bool {
    let Some(x) = r.get(Kind::View, n) else { return false };
    depth < 8 && view_src(r, n, &x.v, depth).is_some() && x.v[2] != 3 && x.v[4] == 0
}

fn view_src(r: &R, n: u8, v: &[u8], depth: u8) -> Option<(String, &'static str)> {
    match v[0] {
        0 => r.get(Kind::Table, v[1]).map(|_| (format!("public.t{}", v[1]), "id")),
        1 if v[1] < n && view_has_id(r, v[1], depth + 1) => Some((format!("public.v{}", v[1]), "id")),
        2 => r.get(Kind::Fun, v[1]).filter(|f| f.v[0] == 4).map(|_| (format!("public.f{}(3) AS s(id)", v[1]), "id")),
        3 => r.get(Kind::Fun, v[1]).filter(|f| f.v[0] == 5).map(|_| (format!("public.f{}(3)", v[1]), "r")),
        _ => None,
    }
}

fn view_sql(r: &R, o: &mut String, n: u8, v: &[u8]) {
    let Some((src, idcol)) = view_src(r, n, v, 0) else { return };
    let id_alias = ["id", "ident", "id"][v[4] as usize];
    let x_alias = ["x", "x", "xx"][v[4] as usize];
    let id_sel = if idcol == id_alias { idcol.to_string() } else { format!("{idcol} AS {id_alias}") };
    let mut sel = Vec::new();
    if v[7] == 1 {
        sel.push(format!("'l{n}'::text AS label"));
    }
    let extra = match v[2] {
        1 => r.fcall(v[3], idcol, false).map(|e| format!("{e} AS {x_alias}")),
        2 => r.op(v[3]).map(|op| format!("({idcol} {op} 2) AS {x_alias}")),
        _ => None,
    };
    if v[2] == 3 {
        // an aggregate view: no id column
        let Some(_) = r.get(Kind::Agg, v[3]) else { return };
        sel = vec![format!("public.a{}({idcol}) AS total", v[3])];
    } else {
        sel.insert(if v[7] == 2 { 0 } else { sel.len() }, id_sel);
        if v[7] == 2 {
            sel.push(format!("'l{n}'::text AS label"));
        }
        sel.extend(extra);
    }
    let mat = v[5] == 1;
    let opts = if v[9] == 1 && !mat { " WITH (security_barrier = true)" } else { "" };
    let check = if v[6] == 1 && !mat && v[0] == 0 && v[2] != 3 { "\n  WITH LOCAL CHECK OPTION" } else { "" };
    let kw = if mat { "MATERIALIZED VIEW" } else { "VIEW" };
    let _ = writeln!(o, "CREATE {kw} public.v{n}{opts} AS SELECT {} FROM {src}{check};", sel.join(", "));
    comment(o, &format!("{kw} public.v{n}"), v[8] == 1, &format!("v{n}"));
}

// ------------------------------------------------------------------ generate

fn obj(g: &mut Source, kind: Kind, n: u8) -> Obj {
    Obj { kind, n, v: ranges(kind).iter().map(|&m| g.int(0..m)).collect() }
}

fn some_kind(g: &mut Source) -> Kind {
    // tables, functions and views carry most of the dependencies
    let weighted = [Kind::Table, Kind::Table, Kind::Fun, Kind::Fun, Kind::View, Kind::View];
    if g.bool() {
        *g.pick(&weighted)
    } else {
        *g.pick(&KINDS)
    }
}

pub fn db(g: &mut Source) -> Db {
    let mut d = Db { objs: Vec::new() };
    let k = g.int(1usize..=(3 + g.size().min(12)));
    for _ in 0..k {
        add(g, &mut d);
    }
    d
}

fn add(g: &mut Source, d: &mut Db) {
    let kind = some_kind(g);
    let n = g.int(0..count(kind));
    if d.objs.iter().any(|o| o.kind == kind && o.n == n) {
        return;
    }
    d.objs.push(obj(g, kind, n));
}

fn edit(g: &mut Source, d: &mut Db) {
    match g.int(0u8..10) {
        0..=1 => add(g, d),
        2 if !d.objs.is_empty() => {
            let i = g.int(0..d.objs.len());
            d.objs.remove(i);
        }
        _ if !d.objs.is_empty() => {
            // re-roll one field: the common case, a change to an existing object
            let i = g.int(0..d.objs.len());
            let o = &mut d.objs[i];
            let rs = ranges(o.kind);
            let f = g.int(0..rs.len());
            o.v[f] = g.int(0..rs[f]);
        }
        _ => add(g, d),
    }
}

#[derive(Clone, PartialEq)]
pub struct Pair {
    pub a: Db,
    pub b: Db,
    pub compact: bool,
}

impl std::fmt::Debug for Pair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "\n-- compact: {}\n-- A:\n{}-- B:\n{}", self.compact, render(&self.a), render(&self.b))
    }
}

pub fn pair(g: &mut Source) -> Pair {
    let a = db(g);
    let b = if g.bool_with(0.05) {
        db(g)
    } else {
        let mut b = a.clone();
        for _ in 0..g.int(1usize..=(1 + g.size().min(4))) {
            edit(g, &mut b);
        }
        b
    };
    let (a, b) = if g.bool() { (a, b) } else { (b, a) };
    Pair { a, b, compact: g.bool() }
}

// ------------------------------------------------------------------ shrink

fn key(o: &Obj) -> (Kind, u8) {
    (o.kind, o.n)
}

fn shrink_db(d: &Db) -> Vec<Db> {
    let mut out = Vec::new();
    for i in 0..d.objs.len() {
        let mut x = d.clone();
        x.objs.remove(i);
        out.push(x);
    }
    for i in 0..d.objs.len() {
        for f in 0..d.objs[i].v.len() {
            if d.objs[i].v[f] != 0 {
                let mut x = d.clone();
                x.objs[i].v[f] = 0;
                out.push(x);
            }
        }
    }
    out
}

pub fn shrink_pair(p: &Pair) -> Vec<Pair> {
    let mut out = Vec::new();
    // drop an object from both sides
    let keys: BTreeSet<(Kind, u8)> = p.a.objs.iter().chain(&p.b.objs).map(key).collect();
    for k in keys {
        let mut x = p.clone();
        x.a.objs.retain(|o| key(o) != k);
        x.b.objs.retain(|o| key(o) != k);
        out.push(x);
    }
    // zero a field on both sides of an object present in both
    for oa in &p.a.objs {
        if let Some(ob) = p.b.objs.iter().find(|o| key(o) == key(oa)) {
            for f in 0..oa.v.len() {
                if oa.v[f] != 0 || ob.v[f] != 0 {
                    let mut x = p.clone();
                    for o in x.a.objs.iter_mut().chain(x.b.objs.iter_mut()) {
                        if key(o) == key(oa) {
                            o.v[f] = 0;
                        }
                    }
                    out.push(x);
                }
            }
        }
    }
    for a in shrink_db(&p.a) {
        out.push(Pair { a, b: p.b.clone(), compact: p.compact });
    }
    for b in shrink_db(&p.b) {
        out.push(Pair { a: p.a.clone(), b, compact: p.compact });
    }
    if p.compact {
        out.push(Pair { compact: false, ..p.clone() });
    }
    out
}

/// Migrate A -> B through the proof loop; panics on a pg-delta failure.
pub fn check(p: &Pair) {
    check_outcome(crate::migrate(&render(&p.a), &render(&p.b), p.compact));
}

/// `check` with a real row in every source table.
pub fn check_rows(p: &Pair) {
    check_outcome(crate::migrate_rows(&render(&p.a), &render(&p.b), p.compact, "stock"));
}

fn check_outcome(o: crate::Outcome) {
    ephyra::classify(o.kind == "data_hazard", "data hazard (fails only with seeded rows)");
    let known = known_bug(&o);
    if let Some(k) = known {
        ephyra::classify(true, k);
    }
    match o.verdict.as_str() {
        "pass" => {}
        _ if known.is_some() => {}
        "invalid" => {
            ephyra::signature(crate::sig(&format!("generator-invalid {}", o.kind), &o.detail));
            panic!("generated SQL did not load ({}): {}", o.kind, o.detail);
        }
        _ => {
            ephyra::signature(crate::sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}

/// Failure families pinned in tests/obj_regressions.rs.
pub fn known_bug(o: &crate::Outcome) -> Option<&'static str> {
    let first = o.detail.lines().next().unwrap_or("");
    match o.kind.as_str() {
        "apply_error" if first.contains("cannot cast type") => Some("retype without a cast"),
        // intended: PostgreSQL cannot change an in-use composite attribute type
        "plan_throw" if first.contains("composite type") && first.contains("while the type is used by table columns") => Some("intended refusal: in-use composite"),
        "plan_throw" if first.contains("cannot replace an in-use range type") => Some("intended refusal: in-use range type"),
        "plan_throw" if first.contains("expected a scalar, got null") && std::env::var("PGDELTA_TEST_IMAGE").unwrap_or_default().contains(":14") => Some("PG 14 ICU collation"),
        "apply_error" if first.contains("cannot drop collation") => Some("collation re-create with a dependent column"),
        _ => None,
    }
}

pub fn pairs() -> impl Gen<Value = Pair> {
    (|g: &mut Source| pair(g)).with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

/// `pairs` without the kinds a non-superuser cannot create on Supabase
/// (event triggers, publications, foreign data, CREATE EXTENSION).
pub fn pairs_supabase() -> impl Gen<Value = Pair> {
    fn strip(d: &mut Db) {
        d.objs.retain(|o| !matches!(o.kind, Kind::EvtTrig | Kind::Pub | Kind::Fdw | Kind::Ext));
    }
    (|g: &mut Source| {
        let mut p = pair(g);
        strip(&mut p.a);
        strip(&mut p.b);
        p
    })
    .with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

/// `check` under the Supabase profile (worker started with EPHYRA_FLAVOR=supabase).
pub fn check_supabase(p: &Pair) {
    check_outcome(crate::migrate_flavor(&render(&p.a), &render(&p.b), p.compact, "supabase"));
}

/// `check_supabase` with a real row in every source table.
pub fn check_supabase_rows(p: &Pair) {
    check_outcome(crate::migrate_rows(&render(&p.a), &render(&p.b), p.compact, "supabase"));
}
