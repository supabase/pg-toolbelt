//! Generator of valid, acyclic PostgreSQL schemas as a list of DDL statements
//! in a valid execution order, each statement carrying the indices of the
//! earlier statements it needs.

use ephyra::Source;
use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub struct Stmt {
    pub sql: String,
    pub deps: Vec<usize>,
}

/// A schema plus the order and grouping pg-topo receives it in.
#[derive(Clone, PartialEq)]
pub struct Case {
    pub stmts: Vec<Stmt>,
    /// permutation of stmt indices: the input order
    pub order: Vec<usize>,
    /// breaks[k]: start a new input string after order[k]
    pub breaks: Vec<bool>,
}

impl Case {
    pub fn inputs(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut cur = String::new();
        for (k, &i) in self.order.iter().enumerate() {
            cur.push_str(&self.stmts[i].sql);
            cur.push_str(";\n");
            if self.breaks[k] {
                out.push(std::mem::take(&mut cur));
            }
        }
        if !cur.is_empty() {
            out.push(cur);
        }
        out
    }
    pub fn valid_order(&self) -> Vec<String> {
        self.stmts.iter().map(|s| s.sql.clone()).collect()
    }
    pub fn size(&self) -> u64 {
        (self.stmts.len() as u64) * 4
            + self.breaks.iter().filter(|b| **b).count() as u64
            + self.stmts.iter().map(|s| s.sql.len() as u64).sum::<u64>() / 1000
    }
}

impl fmt::Debug for Case {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Case ({} stmts) valid order:", self.stmts.len())?;
        for (i, s) in self.stmts.iter().enumerate() {
            writeln!(f, "  [{i}] {};", s.sql)?;
        }
        write!(f, "  inputs:")?;
        for (n, inp) in self.inputs().iter().enumerate() {
            write!(f, "\n  <input:{n}>\n    {}", inp.trim_end().replace('\n', "\n    "))?;
        }
        Ok(())
    }
}

/// Remove statement `i` and everything that transitively depends on it.
pub fn remove_closure(c: &Case, i: usize) -> Case {
    let n = c.stmts.len();
    let mut dead = vec![false; n];
    dead[i] = true;
    for j in i + 1..n {
        if c.stmts[j].deps.iter().any(|&d| dead[d]) {
            dead[j] = true;
        }
    }
    let mut map = vec![usize::MAX; n];
    let mut stmts = Vec::new();
    for j in 0..n {
        if !dead[j] {
            map[j] = stmts.len();
            let s = &c.stmts[j];
            stmts.push(Stmt { sql: s.sql.clone(), deps: s.deps.iter().map(|&d| map[d]).collect() });
        }
    }
    let mut order = Vec::new();
    let mut breaks = Vec::new();
    for (k, &j) in c.order.iter().enumerate() {
        if !dead[j] {
            order.push(map[j]);
            breaks.push(c.breaks[k]);
        } else if c.breaks[k] {
            if let Some(b) = breaks.last_mut() {
                *b = true;
            }
        }
    }
    Case { stmts, order, breaks }
}

pub fn shrink_case(c: &Case) -> Vec<Case> {
    let mut out = Vec::new();
    if c.breaks.iter().filter(|b| **b).count() > 0 {
        out.push(Case { breaks: vec![false; c.breaks.len()], ..c.clone() });
    }
    // remove from the roots first (largest cuts), then later statements
    for i in 0..c.stmts.len() {
        out.push(remove_closure(c, i));
    }
    for k in 0..c.breaks.len() {
        if c.breaks[k] {
            let mut b = c.breaks.clone();
            b[k] = false;
            out.push(Case { breaks: b, ..c.clone() });
        }
    }
    out
}

// ---------------------------------------------------------------- model

#[derive(Clone, Debug, PartialEq)]
pub enum Ty {
    Int,
    BigInt,
    Text,
    Bool,
    Numeric,
    Date,
    Jsonb,
    User(usize),
    Array(Box<Ty>),
    /// citext from the extension installed in schema .0 by stmt .1
    Citext(usize, usize),
}

#[derive(Clone, Debug)]
enum UKind {
    Enum(Vec<String>),
    Domain(Ty),
    Composite(Vec<(String, Ty)>),
    Range(Ty),
}

#[derive(Clone, Debug)]
struct UType {
    schema: usize,
    name: String,
    kind: UKind,
    stmt: usize,
}

#[derive(Clone, Debug)]
struct Schema {
    name: String,
    stmt: Option<usize>,
}

#[derive(Clone, Debug)]
struct Col {
    name: String,
    ty: Ty,
    stmt: usize,
    generated: bool,
    /// GENERATED ... AS IDENTITY
    ident: bool,
}

#[derive(Clone, Debug, PartialEq)]
enum RelKind {
    Table,
    Partitioned,
    View,
    MatView,
}

#[derive(Clone, Debug)]
struct Rel {
    schema: usize,
    name: String,
    kind: RelKind,
    cols: Vec<Col>,
    pk: Option<usize>,
    stmt: usize,
    part_next: i64,
    has_default_part: bool,
    /// a BEGIN ATOMIC `SELECT *` froze the column list
    frozen: bool,
    /// partitioned tables: how they are partitioned
    pkey: Option<PKey>,
    /// CREATE TABLE ... OF composite
    typed: bool,
    /// separately created table ATTACHed as a partition
    attached: bool,
}

#[derive(Clone, Debug)]
struct PKey {
    range: bool,
}

#[derive(Clone, Debug, PartialEq)]
enum FKind {
    Identity,
    Pred,
    Reader,
    Sfunc,
    Trigger,
    SetOf(usize),
    Proc,
    EventTrg,
    BinPred,
    Table,
    Diff,
    Other,
}

#[derive(Clone, Debug)]
struct Func {
    schema: usize,
    name: String,
    args: Vec<Ty>,
    ret: Ty,
    kind: FKind,
    stmt: usize,
}

#[derive(Clone, Debug)]
struct Named {
    name: String,
    stmt: usize,
    /// owning relation for indexes/policies/triggers/constraints, schema for sequences/collations
    owner: usize,
}

#[derive(Default)]
struct Model {
    schemas: Vec<Schema>,
    types: Vec<UType>,
    rels: Vec<Rel>,
    funcs: Vec<Func>,
    seqs: Vec<Named>,
    roles: Vec<Named>,
    indexes: Vec<Named>,
    policies: Vec<Named>,
    triggers: Vec<Named>,
    constraints: Vec<Named>,
    collations: Vec<Named>,
    aggs: Vec<Func>,
    citext: Option<(usize, usize)>,
    publications: Vec<Named>,
    ops: Vec<Named>,
    op_types: Vec<Ty>,
    rules: Vec<Named>,
}

pub struct Gen<'a> {
    g: &'a mut Source,
    m: Model,
    stmts: Vec<Stmt>,
    n: usize,
    /// PG17 runs matview queries with search_path = pg_catalog, so routine bodies qualify everything
    force_qual: bool,
    /// relation -> latest RENAME statement (Rel.stmt stays the creating statement)
    rel_alias: std::collections::HashMap<usize, usize>,
    /// an UPDATE fails on a table published with a column list or filter outside its replica identity
    has_update: bool,
}

type D = Vec<usize>;

/// Known pg-topo bugs the generator steers around unless PGTOPO_UNMASK names them.
pub fn masked(bug: &str) -> bool {
    !std::env::var("PGTOPO_UNMASK").unwrap_or_default().split(',').any(|b| b == bug || b == "all")
}

fn strip_array(t: &Ty) -> &Ty {
    match t {
        Ty::Array(i) => strip_array(i),
        t => t,
    }
}

fn is_simple(s: &str) -> bool {
    let mut ch = s.chars();
    matches!(ch.next(), Some('a'..='z' | '_')) && ch.all(|c| matches!(c, 'a'..='z' | '0'..='9' | '_'))
}

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn lit_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

impl<'a> Gen<'a> {
    pub fn new(g: &'a mut Source) -> Self {
        let mut m = Model::default();
        m.schemas.push(Schema { name: "public".into(), stmt: None });
        Gen { g, m, stmts: Vec::new(), n: 0, force_qual: false, rel_alias: Default::default(), has_update: false }
    }

    fn push(&mut self, sql: String, mut deps: D) -> usize {
        // a column of the statement being built records that statement's own index
        let me = self.stmts.len();
        deps.retain(|&d| d != me);
        deps.sort_unstable();
        deps.dedup();
        // deps must point backwards: shrinking and reaches_rows walk them as a DAG
        assert!(deps.iter().all(|&d| d < self.stmts.len()), "forward dependency {deps:?} for statement {}: {sql}", self.stmts.len());
        self.stmts.push(Stmt { sql, deps });
        self.stmts.len() - 1
    }

    fn fresh(&mut self, prefix: &str) -> String {
        self.n += 1;
        let n = self.n;
        match *self.g.weighted(&[(14, 0), (4, 1), (2, 2)]) {
            0 => format!("{prefix}{n}"),
            1 => format!("{}{n}", prefix.to_uppercase()),
            _ => format!("{prefix} {n}.x"),
        }
    }

    fn ident(&mut self, actual: &str) -> String {
        if is_simple(actual) {
            match *self.g.weighted(&[(6, 0), (2, 1), (2, 2)]) {
                0 => actual.to_string(),
                1 => actual.to_uppercase(),
                _ => quote(actual),
            }
        } else {
            quote(actual)
        }
    }

    fn schema_ref(&mut self, s: usize, d: &mut D) -> String {
        if let Some(st) = self.m.schemas[s].stmt {
            d.push(st);
        }
        let n = self.m.schemas[s].name.clone();
        self.ident(&n)
    }

    fn qname(&mut self, s: usize, name: &str, d: &mut D) -> String {
        let n = self.ident(name);
        if s == 0 && !self.force_qual && self.g.bool_with(0.5) {
            return n;
        }
        let sc = self.schema_ref(s, d);
        format!("{sc}.{n}")
    }

    fn pick_schema(&mut self) -> usize {
        self.g.index(self.m.schemas.len())
    }

    // ------------------------------------------------------------ types

    fn ty_name(&mut self, t: &Ty, d: &mut D) -> String {
        let cat = |g: &mut Source, n: &str| if g.bool_with(0.15) { format!("pg_catalog.{n}") } else { n.to_string() };
        match t {
            Ty::Int => {
                let n = *self.g.pick(&["integer", "int", "int4"]);
                if n == "int4" { cat(self.g, n) } else { n.into() }
            }
            Ty::BigInt => {
                let n = *self.g.pick(&["bigint", "int8"]);
                if n == "int8" { cat(self.g, n) } else { n.into() }
            }
            Ty::Text => cat(self.g, "text"),
            Ty::Bool => {
                let n = *self.g.pick(&["boolean", "bool"]);
                if n == "bool" { cat(self.g, n) } else { n.into() }
            }
            Ty::Numeric => cat(self.g, "numeric"),
            Ty::Date => cat(self.g, "date"),
            Ty::Jsonb => cat(self.g, "jsonb"),
            Ty::User(i) => {
                let (s, n, st) = {
                    let u = &self.m.types[*i];
                    (u.schema, u.name.clone(), u.stmt)
                };
                d.push(st);
                self.qname(s, &n, d)
            }
            Ty::Array(inner) => format!("{}[]", self.ty_name(inner, d)),
            Ty::Citext(s, st) => {
                d.push(*st);
                let (s, st) = (*s, *st);
                let _ = st;
                if s == 0 && !self.force_qual && self.g.bool_with(0.5) {
                    "citext".into()
                } else {
                    format!("{}.citext", self.schema_ref(s, d))
                }
            }
        }
    }

    fn lit(&mut self, t: &Ty, d: &mut D) -> String {
        match t {
            Ty::Int => format!("{}::integer", self.g.int(0i32..=9)),
            Ty::BigInt => format!("{}::bigint", self.g.int(0i32..=9)),
            Ty::Text => "'x'::text".into(),
            Ty::Bool => "true".into(),
            Ty::Numeric => "1.5::numeric".into(),
            Ty::Date => "'2020-01-01'::date".into(),
            Ty::Jsonb => "'{}'::jsonb".into(),
            Ty::User(i) => {
                let kind = self.m.types[*i].kind.clone();
                let inner = match kind {
                    UKind::Enum(labels) => {
                        let l = self.g.pick(&labels).clone();
                        lit_str(&l)
                    }
                    UKind::Domain(base) => format!("({})", self.lit(&base, d)),
                    UKind::Composite(fields) => {
                        let parts: Vec<String> = fields.iter().map(|(_, t)| self.lit(t, d)).collect();
                        format!("ROW({})", parts.join(", "))
                    }
                    UKind::Range(base) => match base {
                        Ty::Date => "'[2020-01-01,2020-02-01)'".into(),
                        _ => "'[1,2)'".into(),
                    },
                };
                format!("{inner}::{}", self.ty_name(t, d))
            }
            Ty::Array(inner) => {
                let e = self.lit(inner, d);
                format!("ARRAY[{e}]::{}", self.ty_name(t, d))
            }
            Ty::Citext(..) => format!("'X'::{}", self.ty_name(t, d)),
        }
    }

    fn any_ty(&mut self) -> Ty {
        let base = [Ty::Int, Ty::BigInt, Ty::Text, Ty::Bool, Ty::Numeric, Ty::Date, Ty::Jsonb];
        let t = if !self.m.types.is_empty() && self.g.bool_with(0.5) {
            Ty::User(self.g.index(self.m.types.len()))
        } else if let (Some((s, st)), true) = (self.m.citext, self.g.bool_with(0.1)) {
            Ty::Citext(s, st)
        } else {
            self.g.pick(&base).clone()
        };
        if self.g.bool_with(0.1) { Ty::Array(Box::new(t)) } else { t }
    }

    fn keyable(&self, t: &Ty) -> bool {
        match t {
            Ty::Int | Ty::BigInt | Ty::Text | Ty::Date | Ty::Numeric => true,
            Ty::User(i) => match &self.m.types[*i].kind {
                UKind::Enum(_) => true,
                UKind::Domain(b) => !matches!(b, Ty::User(_)) && self.keyable(b),
                UKind::Composite(_) => false,
                UKind::Range(_) => true,
            },
            Ty::Citext(..) => true,
            _ => false,
        }
    }

    fn gen_type(&mut self) {
        let s = self.pick_schema();
        let name = self.fresh("ty");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let (sql, kind) = match *self.g.weighted(&[(3, 0), (3, 1), (2, 2), (1, 3)]) {
            3 => {
                let base = self.g.pick(&[Ty::Int, Ty::Date, Ty::Numeric]).clone();
                let bn = self.ty_name(&base, &mut d);
                let mut diff = String::new();
                if self.g.bool_with(0.5) {
                    let f = match self.pick_func(|f| f.kind == FKind::Diff && f.args[0] == base) {
                        Some(f) if self.g.bool_with(0.5) => f,
                        _ => self.make_diff_func(&base),
                    };
                    let fq = self.func_ref_name(f, &mut d);
                    diff = format!(", subtype_diff = {fq}");
                }
                (format!("CREATE TYPE {q} AS RANGE (subtype = {bn}{diff})"), UKind::Range(base))
            }
            0 => {
                let k = self.g.int(1usize..=3);
                let labels: Vec<String> = (0..k).map(|j| if self.g.bool_with(0.2) { format!("L'{j}") } else { format!("l{j}") }).collect();
                let ls: Vec<String> = labels.iter().map(|l| lit_str(l)).collect();
                (format!("CREATE TYPE {q} AS ENUM ({})", ls.join(", ")), UKind::Enum(labels))
            }
            1 => {
                let mut base = self.g.pick(&[Ty::Int, Ty::BigInt, Ty::Text, Ty::Numeric, Ty::Date]).clone();
                if !self.m.types.is_empty() && self.g.bool_with(0.3) {
                    base = Ty::User(self.g.index(self.m.types.len()));
                }
                let bn = self.ty_name(&base, &mut d);
                let mut sql = format!("CREATE DOMAIN {q} AS {bn}");
                if self.g.bool_with(0.5) {
                    if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [base.clone()]) {
                        let c = self.func_ref_name(f, &mut d);
                        sql.push_str(&format!(" CHECK ({c}(VALUE))"));
                    } else {
                        sql.push_str(" CHECK (VALUE IS NOT NULL)");
                    }
                }
                if self.g.bool_with(0.3) {
                    let l = self.lit(&base, &mut d);
                    sql.push_str(&format!(" DEFAULT {l}"));
                }
                (sql, UKind::Domain(base))
            }
            _ => {
                let k = self.g.int(1usize..=3);
                let mut fields = Vec::new();
                let mut parts = Vec::new();
                for j in 0..k {
                    let mut t = self.any_ty();
                    if masked("composite") {
                        t = self.g.pick(&[Ty::Int, Ty::Text, Ty::Jsonb, Ty::Date]).clone();
                    }
                    let fname = format!("f{j}");
                    let tn = self.ty_name(&t, &mut d);
                    let fi = self.ident(&fname);
                    parts.push(format!("{fi} {tn}"));
                    fields.push((fname, t));
                }
                (format!("CREATE TYPE {q} AS ({})", parts.join(", ")), UKind::Composite(fields))
            }
        };
        let st = self.push(sql, d);
        self.m.types.push(UType { schema: s, name, kind, stmt: st });
    }

    // ------------------------------------------------------------ functions

    fn pick_func(&mut self, pred: impl Fn(&Func) -> bool) -> Option<usize> {
        let c: Vec<usize> = (0..self.m.funcs.len()).filter(|&i| pred(&self.m.funcs[i])).collect();
        if c.is_empty() { None } else { Some(c[self.g.index(c.len())]) }
    }

    fn func_ref_name(&mut self, f: usize, d: &mut D) -> String {
        let (s, n, st) = {
            let f = &self.m.funcs[f];
            (f.schema, f.name.clone(), f.stmt)
        };
        d.push(st);
        self.qname(s, &n, d)
    }

    fn func_sig(&mut self, f: usize, d: &mut D) -> String {
        let args = self.m.funcs[f].args.clone();
        let name = self.func_ref_name(f, d);
        let a: Vec<String> = args.iter().map(|t| self.ty_name(t, d)).collect();
        format!("{name}({})", a.join(", "))
    }

    /// call expression with typed literal args
    fn call(&mut self, f: usize, args: Vec<String>, d: &mut D) -> String {
        let name = self.func_ref_name(f, d);
        format!("{name}({})", args.join(", "))
    }

    fn body(&mut self, sql_expr: &str, plpgsql_ret: &str, decl: Option<String>) -> (String, &'static str) {
        let w_ret = if masked("sqlbody") { 0 } else { 3 };
        match *self.g.weighted(&[(4, 0), (1, 1), (w_ret, 2), (3, 3)]) {
            0 => (format!("AS $$ SELECT {sql_expr} $$"), "sql"),
            1 => (format!("AS {}", lit_str(&format!("SELECT {sql_expr}"))), "sql"),
            2 => (format!("RETURN {sql_expr}"), "sql"),
            _ => {
                let decl = decl.map(|d| format!("DECLARE {d}; ")).unwrap_or_default();
                (format!("AS $fn$ {decl}BEGIN RETURN {plpgsql_ret}; END $fn$"), "plpgsql")
            }
        }
    }

    fn plpgsql_decl(&mut self, d: &mut D) -> Option<String> {
        if masked("plpgsql_decl") || !self.g.bool_with(0.5) {
            return None;
        }
        match *self.g.weighted(&[(2, 0), (1, 1), (1, 2)]) {
            0 if !self.m.types.is_empty() => {
                let t = Ty::User(self.g.index(self.m.types.len()));
                Some(format!("v_ {}", self.ty_name(&t, d)))
            }
            1 if !self.m.rels.is_empty() => {
                let r = self.g.index(self.m.rels.len());
                let q = self.rel_ref(r, d);
                Some(format!("v_ {q}%ROWTYPE"))
            }
            2 if !self.m.rels.is_empty() => {
                let r = self.g.index(self.m.rels.len());
                if self.m.rels[r].cols.is_empty() {
                    return None;
                }
                let ci = self.g.index(self.m.rels[r].cols.len());
                let q = self.rel_ref(r, d);
                let c = self.col_ref(r, ci, d);
                Some(format!("v_ {q}.{c}%TYPE"))
            }
            _ => None,
        }
    }

    /// f(a t, b t) RETURNS double precision, usable as a range subtype_diff
    fn make_diff_func(&mut self, base: &Ty) -> usize {
        let fq = self.force_qual;
        self.force_qual = true;
        let s = self.pick_schema();
        let name = self.fresh("fn");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let tn = self.ty_name(base, &mut d);
        let tn2 = self.ty_name(base, &mut d);
        let sql = format!("CREATE FUNCTION {q}(a {tn}, b {tn2}) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$ SELECT (a - b)::double precision $$");
        let st = self.push(sql, d);
        self.force_qual = fq;
        self.m.funcs.push(Func { schema: s, name, args: vec![base.clone(), base.clone()], ret: Ty::Numeric, kind: FKind::Diff, stmt: st });
        self.m.funcs.len() - 1
    }

    fn make_simple_func(&mut self, sql_of: impl FnOnce(&mut Self, &str, &mut D) -> String, args: Vec<Ty>, ret: Ty, kind: FKind) -> usize {
        let fq = self.force_qual;
        self.force_qual = true;
        let s = self.pick_schema();
        let name = self.fresh("fn");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let sql = sql_of(self, &q, &mut d);
        let st = self.push(sql, d);
        self.force_qual = fq;
        self.m.funcs.push(Func { schema: s, name, args, ret, kind, stmt: st });
        self.m.funcs.len() - 1
    }

    fn make_identity_func(&mut self, t: &Ty) -> usize {
        let t2 = t.clone();
        self.make_simple_func(
            move |this, q, d| {
                let tn = this.ty_name(&t2, d);
                let rn = this.ty_name(&t2, d);
                format!("CREATE FUNCTION {q}(a {tn}) RETURNS {rn} LANGUAGE sql IMMUTABLE AS $$ SELECT a $$")
            },
            vec![t.clone()],
            t.clone(),
            FKind::Identity,
        )
    }

    fn make_pred_func(&mut self, t: &Ty) -> usize {
        let t2 = t.clone();
        self.make_simple_func(
            move |this, q, d| {
                let tn = this.ty_name(&t2, d);
                format!("CREATE FUNCTION {q}(a {tn}) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT a IS NOT NULL $$")
            },
            vec![t.clone()],
            Ty::Bool,
            FKind::Pred,
        )
    }

    /// make sure an identity (or predicate) function over `t` exists, sometimes creating one
    fn ensure_func(&mut self, pred: bool, t: &Ty) {
        let kind = if pred { FKind::Pred } else { FKind::Identity };
        if self.m.funcs.iter().all(|f| !(f.kind == kind && f.args == [t.clone()])) && self.g.bool_with(0.6) {
            if pred { self.make_pred_func(t) } else { self.make_identity_func(t) };
        }
    }

    fn make_trigger_func(&mut self) -> usize {
        self.make_simple_func(|_, q, _| format!("CREATE FUNCTION {q}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"), vec![], Ty::Bool, FKind::Trigger)
    }

    fn make_proc(&mut self) -> usize {
        self.make_simple_func(|_, q, _| format!("CREATE PROCEDURE {q}() LANGUAGE sql AS $$ SELECT 1 $$"), vec![], Ty::Bool, FKind::Proc)
    }

    fn gen_func(&mut self) {
        // unqualified body references are pg-topo bug N16; such bodies also break PG17
        // matviews, which the properties discard as generator-invalid
        self.force_qual = masked("body_unqual") || self.g.bool_with(0.5);
        self.gen_func_inner();
        self.force_qual = false;
    }

    fn gen_func_inner(&mut self) {
        let s = self.pick_schema();
        let mut d = D::new();
        // overload an existing name sometimes
        let reuse = if self.g.bool_with(0.15) && !self.m.funcs.is_empty() {
            let i = self.g.index(self.m.funcs.len());
            if self.m.funcs[i].kind == FKind::Identity { Some((self.m.funcs[i].schema, self.m.funcs[i].name.clone(), self.m.funcs[i].args.clone())) } else { None }
        } else {
            None
        };
        let kind = *self.g.weighted(&[(5, 0), (4, 1), (2, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8), (1, 9), (1, 10), (1, 11)]);
        let (s, name) = match &reuse {
            Some((rs, rn, _)) if kind == 0 => (*rs, rn.clone()),
            _ => (s, self.fresh("fn")),
        };
        let q = self.qname(s, &name, &mut d);
        match kind {
            // identity / chained transform: f(a t) returns t
            0 => {
                let t = self.any_ty();
                let (s, name) = if self.m.funcs.iter().any(|f| f.schema == s && f.name == name && (f.args == [t.clone()] || (masked("arraysig") && f.args.len() == 1 && strip_array(&f.args[0]) == strip_array(&t)))) {
                    let s2 = self.pick_schema();
                    (s2, self.fresh("fn"))
                } else {
                    (s, name)
                };
                let q = if reuse.is_some() { let mut d2 = D::new(); let q = self.qname(s, &name, &mut d2); d.extend(d2); q } else { q };
                let tn = self.ty_name(&t, &mut d);
                let rn = self.ty_name(&t, &mut d);
                let inner = match self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()]) {
                    Some(g) if self.g.bool_with(0.6) => self.call(g, vec!["a".into()], &mut d),
                    _ => "a".into(),
                };
                let default = if self.g.bool_with(0.15) {
                    format!(" DEFAULT {}", self.lit(&t, &mut d))
                } else if !masked("default_arg") && self.g.bool_with(0.25) {
                    match self.pick_func(|f| f.kind == FKind::Identity && f.ret == t) {
                        Some(g) => {
                            let args = self.m.funcs[g].args.clone();
                            let l: Vec<String> = args.iter().map(|a| self.lit(a, &mut d)).collect();
                            format!(" DEFAULT {}", self.call(g, l, &mut d))
                        }
                        None => String::new(),
                    }
                } else {
                    String::new()
                };
                let decl = self.plpgsql_decl(&mut d);
                let (body, lang) = self.body(&inner, &inner, decl.clone());
                if lang == "sql" && decl.is_some() {
                    // decl deps only apply to plpgsql; harmless extra deps
                }
                let sql = format!("CREATE FUNCTION {q}(a {tn}{default}) RETURNS {rn} LANGUAGE {lang} IMMUTABLE {body}");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![t.clone()], ret: t, kind: FKind::Identity, stmt: st });
            }
            // predicate: f(a t) returns boolean
            1 => {
                let t = self.any_ty();
                let tn = self.ty_name(&t, &mut d);
                let inner = match *self.g.weighted(&[(3, 0), (2, 1), (2, 2)]) {
                    1 => match self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                        Some(g) => self.call(g, vec!["a".into()], &mut d),
                        None => "a IS NOT NULL".into(),
                    },
                    2 => match self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()]) {
                        Some(g) => format!("{} IS NOT NULL", self.call(g, vec!["a".into()], &mut d)),
                        None => "a IS NOT NULL".into(),
                    },
                    _ => "a IS NOT NULL".into(),
                };
                let decl = self.plpgsql_decl(&mut d);
                let (body, lang) = self.body(&inner, &inner, decl);
                let sql = format!("CREATE FUNCTION {q}(a {tn}) RETURNS boolean LANGUAGE {lang} IMMUTABLE {body}");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![t], ret: Ty::Bool, kind: FKind::Pred, stmt: st });
            }
            // reader: f() returns bigint reading a relation
            2 => {
                if self.m.rels.is_empty() {
                    return;
                }
                let r = self.g.index(self.m.rels.len());
                let rq = self.rel_ref(r, &mut d);
                let ws = if masked("sqlbody") { 0 } else { 1 };
                let sql = match *self.g.weighted(&[(3, 0), (2 * ws, 1), (ws, 2)]) {
                    0 => format!("CREATE FUNCTION {q}() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT count(*) FROM {rq} $$"),
                    1 => format!("CREATE FUNCTION {q}() RETURNS bigint LANGUAGE sql STABLE BEGIN ATOMIC SELECT count(*) FROM {rq}; END"),
                    _ => format!("CREATE FUNCTION {q}() RETURNS bigint LANGUAGE sql STABLE RETURN (SELECT count(*) FROM {rq})"),
                };
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::BigInt, kind: FKind::Reader, stmt: st });
            }
            // aggregate state function f(a t, b t) returns t
            3 => {
                let t = self.any_ty();
                let tn = self.ty_name(&t, &mut d);
                let tn2 = self.ty_name(&t, &mut d);
                let rn = self.ty_name(&t, &mut d);
                let sql = format!("CREATE FUNCTION {q}(a {tn}, b {tn2}) RETURNS {rn} LANGUAGE sql IMMUTABLE AS $$ SELECT a $$");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![t.clone(), t.clone()], ret: t, kind: FKind::Sfunc, stmt: st });
            }
            // trigger function
            4 => {
                let decl = self.plpgsql_decl(&mut d).map(|x| format!("DECLARE {x}; ")).unwrap_or_default();
                let sql = format!("CREATE FUNCTION {q}() RETURNS trigger LANGUAGE plpgsql AS $$ {decl}BEGIN RETURN NEW; END $$");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::Bool, kind: FKind::Trigger, stmt: st });
            }
            // setof relation
            5 => {
                if self.m.rels.is_empty() {
                    return;
                }
                let r = self.g.index(self.m.rels.len());
                let rq = self.rel_ref(r, &mut d);
                let rq2 = self.rel_ref(r, &mut d);
                self.m.rels[r].frozen = true;
                let sql = if masked("sqlbody") || self.g.bool_with(0.5) {
                    format!("CREATE FUNCTION {q}() RETURNS SETOF {rq} LANGUAGE sql STABLE AS $$ SELECT * FROM {rq2} $$")
                } else {
                    format!("CREATE FUNCTION {q}() RETURNS SETOF {rq} LANGUAGE sql STABLE BEGIN ATOMIC SELECT * FROM {rq2}; END")
                };
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::Bool, kind: FKind::SetOf(r), stmt: st });
            }
            7 => {
                let sql = format!("CREATE FUNCTION {q}() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN NULL; END $$");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::Bool, kind: FKind::EventTrg, stmt: st });
            }
            8 => {
                let t = self.any_ty();
                let tn = self.ty_name(&t, &mut d);
                let tn2 = self.ty_name(&t, &mut d);
                let sql = format!("CREATE FUNCTION {q}(a {tn}, b {tn2}) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT b IS NOT NULL $$");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![t.clone(), t], ret: Ty::Bool, kind: FKind::BinPred, stmt: st });
            }
            9 => {
                let t = self.any_ty();
                let tn = self.ty_name(&t, &mut d);
                let l = self.lit(&t, &mut d);
                let sql = if self.g.bool_with(0.5) {
                    format!("CREATE FUNCTION {q}() RETURNS TABLE (x {tn}) LANGUAGE sql STABLE AS $$ SELECT {l} $$")
                } else {
                    format!("CREATE FUNCTION {q}(OUT x {tn}) LANGUAGE sql STABLE AS $$ SELECT {l} $$")
                };
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: t, kind: FKind::Table, stmt: st });
            }
            10 => {
                let t = self.g.pick(&[Ty::Int, Ty::Date, Ty::Numeric]).clone();
                self.make_diff_func(&t);
            }
            // SQL function casting NULL to a view's row type
            11 => {
                if masked("rowtype_cast") {
                    return;
                }
                let views: Vec<usize> = (0..self.m.rels.len()).filter(|&x| self.m.rels[x].kind == RelKind::View && !self.m.rels[x].cols.is_empty()).collect();
                if views.is_empty() {
                    return;
                }
                let r = views[self.g.index(views.len())];
                let c = self.g.index(self.m.rels[r].cols.len());
                let t = self.m.rels[r].cols[c].ty.clone();
                let rq = self.rel_ref(r, &mut d);
                let cr = self.col_ref(r, c, &mut d);
                let rn = self.ty_name(&t, &mut d);
                let sql = format!("CREATE FUNCTION {q}() RETURNS {rn} LANGUAGE sql STABLE AS $$ SELECT (NULL::{rq}).{cr} $$");
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: t, kind: FKind::Other, stmt: st });
            }
            // procedure calling a function (or, in plpgsql, another procedure)
            _ => {
                if self.g.bool_with(0.4) {
                    if self.m.funcs.iter().all(|f| f.kind != FKind::Proc) {
                        self.make_proc();
                    }
                    if let Some(p) = self.pick_func(|f| f.kind == FKind::Proc) {
                        let c = self.call(p, vec![], &mut d);
                        let sql = format!("CREATE PROCEDURE {q}() LANGUAGE plpgsql AS $$ BEGIN CALL {c}; END $$");
                        let st = self.push(sql, d);
                        self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::Bool, kind: FKind::Proc, stmt: st });
                        return;
                    }
                }
                let Some(f) = self.pick_func(|f| matches!(f.kind, FKind::Identity | FKind::Pred | FKind::Reader)) else { return };
                let args = self.m.funcs[f].args.clone();
                let lits: Vec<String> = args.iter().map(|t| self.lit(t, &mut d)).collect();
                let c = self.call(f, lits, &mut d);
                let sql = if !masked("sqlbody") && self.g.bool_with(0.5) {
                    format!("CREATE PROCEDURE {q}() LANGUAGE sql BEGIN ATOMIC SELECT {c}; END")
                } else {
                    format!("CREATE PROCEDURE {q}() LANGUAGE sql AS $$ SELECT {c} $$")
                };
                let st = self.push(sql, d);
                self.m.funcs.push(Func { schema: s, name, args: vec![], ret: Ty::Bool, kind: FKind::Proc, stmt: st });
            }
        }
    }

    // ------------------------------------------------------------ relations

    fn rel_ref(&mut self, r: usize, d: &mut D) -> String {
        let (s, n, st) = {
            let r = &self.m.rels[r];
            (r.schema, r.name.clone(), r.stmt)
        };
        d.push(st);
        if let Some(&a) = self.rel_alias.get(&r) {
            d.push(a);
        }
        self.qname(s, &n, d)
    }

    fn col_ref(&mut self, r: usize, c: usize, d: &mut D) -> String {
        let col = &self.m.rels[r].cols[c];
        d.push(col.stmt);
        let n = col.name.clone();
        self.ident(&n)
    }

    /// Column definition text (without the name); may add deps.
    fn col_options(&mut self, t: &Ty, cname: &str, siblings: &[Col], allow_pk: bool, d: &mut D) -> (String, bool, bool) {
        let mut opts = String::new();
        let mut generated = false;
        let mut is_pk = false;
        // generated column from a sibling through an identity function
        if self.g.bool_with(0.15) {
            let sib: Vec<usize> = (0..siblings.len()).filter(|&i| !siblings[i].generated).collect();
            if !sib.is_empty() {
                let si = sib[self.g.index(sib.len())];
                let st = siblings[si].ty.clone();
                if let Some(f) = self.pick_func(|f| f.kind == FKind::Identity && f.args == [st.clone()] && f.ret == *t) {
                    let sn = self.ident(&siblings[si].name.clone());
                    d.push(siblings[si].stmt);
                    let c = self.call(f, vec![sn], d);
                    opts.push_str(&format!(" GENERATED ALWAYS AS ({c}) STORED"));
                    generated = true;
                }
            }
        }
        if !generated && self.g.bool_with(0.3) {
            match *self.g.weighted(&[(2, 0), (2, 1), (1, 2), (1, 3)]) {
                1 => {
                    if let Some(f) = self.pick_func(|f| f.kind == FKind::Identity && f.ret == *t) {
                        let args = self.m.funcs[f].args.clone();
                        let l: Vec<String> = args.iter().map(|a| self.lit(a, d)).collect();
                        let c = self.call(f, l, d);
                        opts.push_str(&format!(" DEFAULT {c}"));
                    }
                }
                2 if *t == Ty::BigInt => {
                    if let Some(f) = self.pick_func(|f| f.kind == FKind::Reader) {
                        let c = self.call(f, vec![], d);
                        opts.push_str(&format!(" DEFAULT {c}"));
                    }
                }
                3 if matches!(t, Ty::Int | Ty::BigInt) && self.m.seqs.iter().any(|q| !masked("regclass_case") || (is_simple(&q.name) && is_simple(&self.m.schemas[q.owner].name))) => {
                    let ok: Vec<usize> = (0..self.m.seqs.len())
                        .filter(|&i| !masked("regclass_case") || (is_simple(&self.m.seqs[i].name) && is_simple(&self.m.schemas[self.m.seqs[i].owner].name)))
                        .collect();
                    let si = ok[self.g.index(ok.len())];
                    let (sn, owner, st) = (self.m.seqs[si].name.clone(), self.m.seqs[si].owner, self.m.seqs[si].stmt);
                    d.push(st);
                    let sc = self.schema_ref(owner, d);
                    let inner = if is_simple(&sn) { sn.clone() } else { quote(&sn) };
                    let sq = if is_simple(&self.m.schemas[owner].name) { self.m.schemas[owner].name.clone() } else { quote(&self.m.schemas[owner].name) };
                    let _ = sc;
                    let expr = if self.g.bool_with(0.5) {
                        format!("nextval({}::regclass)", lit_str(&format!("{sq}.{inner}")))
                    } else {
                        format!("nextval({})", lit_str(&format!("{sq}.{inner}")))
                    };
                    opts.push_str(&format!(" DEFAULT {expr}"));
                }
                _ => {
                    let l = self.lit(t, d);
                    opts.push_str(&format!(" DEFAULT {l}"));
                }
            }
        }
        if allow_pk && self.keyable(t) && self.g.bool_with(0.6) {
            opts.push_str(" PRIMARY KEY");
            is_pk = true;
        } else if self.keyable(t) && self.g.bool_with(0.3) {
            // inline FK
            let cands: Vec<usize> = (0..self.m.rels.len())
                .filter(|&r| self.m.rels[r].kind == RelKind::Table && self.m.rels[r].pk.map(|p| self.m.rels[r].cols[p].ty == *t).unwrap_or(false))
                .collect();
            if !cands.is_empty() {
                let r = cands[self.g.index(cands.len())];
                let rq = self.rel_ref(r, d);
                let p = self.m.rels[r].pk.unwrap();
                let pc = self.col_ref(r, p, d);
                opts.push_str(&format!(" REFERENCES {rq} ({pc})"));
            }
        }
        if !generated && self.g.bool_with(0.2) {
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                let ci = self.ident(cname);
                let c = self.call(f, vec![ci], d);
                opts.push_str(&format!(" CHECK ({c})"));
            }
        }
        if *t == Ty::Text && !self.m.collations.is_empty() && self.g.bool_with(0.3) {
            let ci = self.g.index(self.m.collations.len());
            let (cn, owner, st) = (self.m.collations[ci].name.clone(), self.m.collations[ci].owner, self.m.collations[ci].stmt);
            d.push(st);
            let q = self.qname(owner, &cn, d);
            // COLLATE must precede constraints
            opts = format!(" COLLATE {q}{opts}");
        }
        (opts, generated, is_pk)
    }

    fn gen_table(&mut self) {
        let s = self.pick_schema();
        let name = self.fresh("t");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let st_idx = self.stmts.len();
        let partitioned = self.g.bool_with(0.15);
        let k = self.g.int(1usize..=4);
        let mut cols: Vec<Col> = Vec::new();
        let mut parts = Vec::new();
        let mut pk = None;
        for j in 0..k {
            let mut t = self.any_ty();
            if partitioned && j == 0 {
                t = self.g.pick(&[Ty::Int, Ty::Text]).clone();
            }
            let cname = format!("c{j}");
            let ci = self.ident(&cname);
            let tn = self.ty_name(&t, &mut d);
            let (mut opts, generated, is_pk) = if partitioned {
                (String::new(), false, false)
            } else {
                self.col_options(&t, &cname, &cols, pk.is_none(), &mut d)
            };
            let mut ident = false;
            if !partitioned && opts.is_empty() && matches!(t, Ty::Int | Ty::BigInt) && self.g.bool_with(0.12) {
                opts = format!(" GENERATED {} AS IDENTITY", if self.g.bool_with(0.5) { "ALWAYS" } else { "BY DEFAULT" });
                ident = true;
            }
            if is_pk {
                pk = Some(j);
            }
            parts.push(format!("{ci} {tn}{opts}"));
            cols.push(Col { name: cname, ty: t, stmt: st_idx, generated, ident });
        }
        // exclusion constraint
        let mut excl_name = None;
        if !partitioned && self.g.bool_with(0.12) {
            // citext: `=` resolves through search_path to text's operator, not citext_ops
            let ks: Vec<usize> = (0..cols.len()).filter(|&i| self.keyable(&cols[i].ty) && !matches!(cols[i].ty, Ty::Citext(..))).collect();
            if !ks.is_empty() {
                let c = ks[self.g.index(ks.len())];
                let t = cols[c].ty.clone();
                let ci = self.ident(&cols[c].name.clone());
                let unmasked = !masked("exclude_expr");
                if unmasked {
                    self.ensure_func(false, &t);
                    self.ensure_func(true, &t);
                }
                let body = match *self.g.weighted(&[(2, 0), (if unmasked { 2 } else { 0 }, 1), (if unmasked { 2 } else { 0 }, 2)]) {
                    1 => match self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()] && f.ret == t) {
                        Some(f) => {
                            let c = self.call(f, vec![ci.clone()], &mut d);
                            format!("{c} WITH =)")
                        }
                        None => format!("{ci} WITH =)"),
                    },
                    2 => match self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                        Some(f) => {
                            let c = self.call(f, vec![ci.clone()], &mut d);
                            format!("{ci} WITH =) WHERE ({c})")
                        }
                        None => format!("{ci} WITH =)"),
                    },
                    _ => format!("{ci} WITH =)"),
                };
                let n = self.fresh("ex");
                let ni = self.ident(&n);
                parts.push(format!("CONSTRAINT {ni} EXCLUDE USING btree ({body}"));
                excl_name = Some(n);
            }
        }
        let mut sql = format!("CREATE TABLE {q} ({})", parts.join(", "));
        let mut pkey = None;
        if partitioned {
            let (clause, k) = self.part_spec(&cols, &mut d);
            sql.push_str(&clause);
            pkey = Some(k);
        }
        let st = self.push(sql, d);
        // helper functions created on demand shift the table's index
        for c in cols.iter_mut() {
            if c.stmt == st_idx {
                c.stmt = st;
            }
        }
        self.m.rels.push(Rel {
            schema: s,
            name,
            kind: if partitioned { RelKind::Partitioned } else { RelKind::Table },
            cols,
            pk,
            stmt: st,
            part_next: 0,
            has_default_part: false,
            frozen: false, pkey, typed: false, attached: false,
        });
        if let Some(n) = excl_name {
            self.m.constraints.push(Named { name: n, stmt: st, owner: self.m.rels.len() - 1 });
        }
    }

    /// `PARTITION BY ...` clause (list or range, sometimes over an immutable function of c0)
    fn part_spec(&mut self, cols: &[Col], d: &mut D) -> (String, PKey) {
        let t = cols[0].ty.clone();
        let range = self.g.bool_with(0.3);
        let c0 = self.ident("c0");
        let mut key = c0.clone();
        if !masked("partkey_expr") && self.g.bool_with(0.4) {
            self.ensure_func(false, &t);
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()] && f.ret == t) {
                key = self.call(f, vec![c0], d);
            }
        }
        (format!(" PARTITION BY {} ({key})", if range { "RANGE" } else { "LIST" }), PKey { range })
    }

    fn part_val(&mut self, t: &Ty, n: i64, d: &mut D) -> String {
        let (plain, typed) = if *t == Ty::Int { (format!("{n}"), format!("{n}::integer")) } else { (format!("'v{n:04}'"), format!("'v{n:04}'::text")) };
        if !masked("partkey_expr") && self.g.bool_with(0.35) {
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()] && f.ret == *t) {
                return self.call(f, vec![typed], d);
            }
        }
        plain
    }

    fn part_bound(&mut self, p: usize, d: &mut D) -> String {
        if !self.m.rels[p].has_default_part && self.g.bool_with(0.2) {
            self.m.rels[p].has_default_part = true;
            return "DEFAULT".to_string();
        }
        self.m.rels[p].part_next += 1;
        let v = self.m.rels[p].part_next;
        let t = self.m.rels[p].cols[0].ty.clone();
        if self.m.rels[p].pkey.as_ref().map(|k| k.range).unwrap_or(false) {
            let lo = self.part_val(&t, v, d);
            let hi = self.part_val(&t, v + 1, d);
            format!("FOR VALUES FROM ({lo}) TO ({hi})")
        } else {
            let x = self.part_val(&t, v, d);
            format!("FOR VALUES IN ({x})")
        }
    }

    fn gen_partition(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::Partitioned).collect();
        if cands.is_empty() {
            return;
        }
        let p = cands[self.g.index(cands.len())];
        let s = self.pick_schema();
        let name = self.fresh("p");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let pq = self.rel_ref(p, &mut d);
        // partition columns must exist on parent (incl. ALTER TABLE ADD COLUMN)
        for c in self.m.rels[p].cols.clone() {
            d.push(c.stmt);
        }
        let bound = self.part_bound(p, &mut d);
        // multi-level partitioning
        let (sub, sub_key) = if self.g.bool_with(0.2) {
            let cols = self.m.rels[p].cols.clone();
            let (c, k) = self.part_spec(&cols, &mut d);
            (c, Some(k))
        } else {
            (String::new(), None)
        };
        let sql = format!("CREATE TABLE {q} PARTITION OF {pq} {bound}{sub}");
        let st = self.push(sql, d);
        let cols = self.m.rels[p].cols.iter().map(|c| Col { stmt: st, ..c.clone() }).collect();
        let kind = if sub_key.is_some() { RelKind::Partitioned } else { RelKind::Table };
        self.m.rels.push(Rel { schema: s, name, kind, cols, pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: sub_key, typed: false, attached: false });
    }

    /// a separately created compatible table, then ALTER TABLE p ATTACH PARTITION
    fn gen_attach(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::Partitioned && self.m.rels[r].pkey.is_some()).collect();
        if cands.is_empty() {
            return;
        }
        let p = cands[self.g.index(cands.len())];
        let s = self.pick_schema();
        let name = self.fresh("at");
        let mut d1 = D::new();
        let q = self.qname(s, &name, &mut d1);
        let pcols = self.m.rels[p].cols.clone();
        let mut parts = Vec::new();
        for c in &pcols {
            let ci = self.ident(&c.name);
            let tn = self.ty_name(&c.ty, &mut d1);
            parts.push(format!("{ci} {tn}"));
        }
        let st1 = self.push(format!("CREATE TABLE {q} ({})", parts.join(", ")), d1);
        let mut d2 = vec![st1];
        for c in &pcols {
            d2.push(c.stmt);
        }
        let pq = self.rel_ref(p, &mut d2);
        let bound = self.part_bound(p, &mut d2);
        self.push(format!("ALTER TABLE {pq} ATTACH PARTITION {q} {bound}"), d2);
        let cols = pcols.iter().map(|c| Col { stmt: st1, generated: false, ident: false, ..c.clone() }).collect();
        self.m.rels.push(Rel { schema: s, name, kind: RelKind::Table, cols, pk: None, stmt: st1, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: true });
    }

    fn gen_alter_table(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned)).collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let is_plain = self.m.rels[r].kind == RelKind::Table;
        match *self.g.weighted(&[(4, 0), (3, 1), (2, 2), (2, 3), (1, 4)]) {
            0 if self.m.rels[r].kind == RelKind::Table && !self.is_partition(r) && !self.m.rels[r].frozen && !self.m.rels[r].typed && !self.populated(r) => {
                let t = self.any_ty();
                let cname = { self.n += 1; format!("ac{}", self.n) };
                let ci = self.ident(&cname);
                let tn = self.ty_name(&t, &mut d);
                let sibs = self.m.rels[r].cols.clone();
                let (opts, generated, is_pk) = self.col_options(&t, &cname, &sibs, self.m.rels[r].pk.is_none(), &mut d);
                let sql = format!("ALTER TABLE {rq} ADD COLUMN {ci} {tn}{opts}");
                let st = self.push(sql, d);
                if is_pk {
                    self.m.rels[r].pk = Some(self.m.rels[r].cols.len());
                }
                self.m.rels[r].cols.push(Col { name: cname, ty: t, stmt: st, generated, ident: false });
            }
            1 if is_plain && !self.populated(r) => {
                // FK constraint
                let c = self.pick_col_alter(r);
                let t = self.m.rels[r].cols[c].ty.clone();
                let tgt: Vec<usize> = (0..self.m.rels.len())
                    .filter(|&x| self.m.rels[x].kind == RelKind::Table && self.m.rels[x].pk.map(|p| self.m.rels[x].cols[p].ty == t).unwrap_or(false))
                    .collect();
                if tgt.is_empty() {
                    return;
                }
                let x = tgt[self.g.index(tgt.len())];
                let cr = self.col_ref(r, c, &mut d);
                let xq = self.rel_ref(x, &mut d);
                let p = self.m.rels[x].pk.unwrap();
                let pc = self.col_ref(x, p, &mut d);
                let cn = self.fresh("fk");
                let cni = self.ident(&cn);
                let sql = format!("ALTER TABLE {rq} ADD CONSTRAINT {cni} FOREIGN KEY ({cr}) REFERENCES {xq} ({pc})");
                let st = self.push(sql, d);
                self.m.constraints.push(Named { name: cn, stmt: st, owner: r });
            }
            2 => {
                let c = self.pick_col_alter(r);
                let t = self.m.rels[r].cols[c].ty.clone();
                let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) else { return };
                let cr = self.col_ref(r, c, &mut d);
                let call = self.call(f, vec![cr], &mut d);
                let cn = self.fresh("ck");
                let cni = self.ident(&cn);
                let sql = format!("ALTER TABLE {rq} ADD CONSTRAINT {cni} CHECK ({call})");
                let st = self.push(sql, d);
                self.m.constraints.push(Named { name: cn, stmt: st, owner: r });
            }
            3 => {
                let sql = format!("ALTER TABLE {rq} ENABLE ROW LEVEL SECURITY");
                self.push(sql, d);
            }
            _ => {
                let c = self.pick_col_alter(r);
                if self.m.rels[r].cols[c].generated || self.m.rels[r].cols[c].ident {
                    return;
                }
                let t = self.m.rels[r].cols[c].ty.clone();
                let cr = self.col_ref(r, c, &mut d);
                let def = match self.pick_func(|f| f.kind == FKind::Identity && f.ret == t) {
                    Some(f) => {
                        let args = self.m.funcs[f].args.clone();
                        let l: Vec<String> = args.iter().map(|a| self.lit(a, &mut d)).collect();
                        self.call(f, l, &mut d)
                    }
                    None => self.lit(&t, &mut d),
                };
                let sql = format!("ALTER TABLE {rq} ALTER COLUMN {cr} SET DEFAULT {def}");
                self.push(sql, d);
            }
        }
    }

    /// a column for an ALTER statement: with "addcol" masked, never one added by ALTER TABLE ADD COLUMN
    fn pick_col_alter(&mut self, r: usize) -> usize {
        let rel = &self.m.rels[r];
        let c: Vec<usize> = (0..rel.cols.len()).filter(|&i| !masked("addcol") || rel.cols[i].stmt == rel.stmt).collect();
        c[self.g.index(c.len())]
    }

    fn is_partition(&self, r: usize) -> bool {
        // partitions are created by gen_partition; their cols' stmt == rel stmt and kind Table with no own pk
        let rel = &self.m.rels[r];
        rel.attached || self.stmts[rel.stmt].sql.contains(" PARTITION OF ")
    }

    fn gen_index(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::MatView | RelKind::Partitioned)).collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let n = self.m.rels[r].cols.len();
        let c = self.g.index(n);
        let t = self.m.rels[r].cols[c].ty.clone();
        let cr = self.col_ref(r, c, &mut d);
        let key = match self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()]) {
            Some(f) if self.g.bool_with(0.5) => format!("({})", self.call(f, vec![cr.clone()], &mut d)),
            _ => cr.clone(),
        };
        let mut sql_where = String::new();
        if self.m.rels[r].kind != RelKind::Partitioned && self.g.bool_with(0.3) {
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                sql_where = format!(" WHERE {}", self.call(f, vec![cr], &mut d));
            }
        }
        let name = self.fresh("ix");
        let ni = self.ident(&name);
        let sql = format!("CREATE INDEX {ni} ON {rq} ({key}){sql_where}");
        let st = self.push(sql, d);
        self.m.indexes.push(Named { name, stmt: st, owner: r });
    }

    fn gen_view(&mut self, mat: bool) {
        if self.m.rels.is_empty() {
            return;
        }
        let s = self.pick_schema();
        let name = self.fresh(if mat { "mv" } else { "v" });
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let r = self.g.index(self.m.rels.len());
        let from = self.rel_ref(r, &mut d);
        let mut sel = Vec::new();
        let mut cols = Vec::new();
        let st_idx = self.stmts.len();
        let n = self.m.rels[r].cols.len();
        let k = self.g.int(1usize..=n.min(3));
        for j in 0..k {
            let c = self.g.index(n);
            let t = self.m.rels[r].cols[c].ty.clone();
            let cr = self.col_ref(r, c, &mut d);
            let alias = format!("o{j}");
            let ai = self.ident(&alias);
            let e = match self.pick_func(|f| f.kind == FKind::Identity && f.args == [t.clone()]) {
                Some(f) if self.g.bool_with(0.4) => self.call(f, vec![format!("r1.{cr}")], &mut d),
                _ => format!("r1.{cr}"),
            };
            sel.push(format!("{e} AS {ai}"));
            cols.push(Col { name: alias, ty: t, stmt: st_idx, generated: false, ident: false });
        }
        if self.g.bool_with(0.2) {
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Reader) {
                let c = self.call(f, vec![], &mut d);
                let ai = self.ident("cnt");
                sel.push(format!("{c} AS {ai}"));
                cols.push(Col { name: "cnt".into(), ty: Ty::BigInt, stmt: st_idx, generated: false, ident: false });
            }
        }
        let mut from_clause = format!("{from} AS r1");
        if self.g.bool_with(0.2) {
            if let Some(f) = self.pick_func(|f| matches!(f.kind, FKind::SetOf(_))) {
                let c = self.call(f, vec![], &mut d);
                from_clause.push_str(&format!(" CROSS JOIN {c} AS r2"));
            } else {
                let r2 = self.g.index(self.m.rels.len());
                let f2 = self.rel_ref(r2, &mut d);
                from_clause.push_str(&format!(" CROSS JOIN {f2} AS r2"));
            }
        }
        let mut wh = String::new();
        if self.g.bool_with(0.3) {
            let c = self.g.index(n);
            let t = self.m.rels[r].cols[c].ty.clone();
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                let cr = self.col_ref(r, c, &mut d);
                wh = format!(" WHERE {}", self.call(f, vec![format!("r1.{cr}")], &mut d));
            }
        }
        let mut conds: Vec<String> = Vec::new();
        if let Some(w) = wh.strip_prefix(" WHERE ") {
            conds.push(w.to_string());
        }
        let mut with = String::new();
        // scalar subquery in select list
        if self.g.bool_with(0.15) {
            let r3 = self.g.index(self.m.rels.len());
            let f3 = self.rel_ref(r3, &mut d);
            let ai = self.ident("sq");
            sel.push(format!("(SELECT count(*) FROM {f3}) AS {ai}"));
            cols.push(Col { name: "sq".into(), ty: Ty::BigInt, stmt: st_idx, generated: false, ident: false });
        }
        // cast a column to a domain over its type
        if self.g.bool_with(0.2) {
            let c = self.g.index(n);
            let t = self.m.rels[r].cols[c].ty.clone();
            let doms: Vec<usize> = (0..self.m.types.len()).filter(|&i| matches!(&self.m.types[i].kind, UKind::Domain(b) if *b == t)).collect();
            if !doms.is_empty() {
                let di = doms[self.g.index(doms.len())];
                let cr = self.col_ref(r, c, &mut d);
                let tn = self.ty_name(&Ty::User(di), &mut d);
                let ai = self.ident("dc");
                sel.push(format!("CAST(r1.{cr} AS {tn}) AS {ai}"));
                cols.push(Col { name: "dc".into(), ty: Ty::User(di), stmt: st_idx, generated: false, ident: false });
            }
        }
        // CASE over a function call
        if self.g.bool_with(0.15) {
            let c = self.g.index(n);
            let t = self.m.rels[r].cols[c].ty.clone();
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                let cr = self.col_ref(r, c, &mut d);
                let call = self.call(f, vec![format!("r1.{cr}")], &mut d);
                let ai = self.ident("cw");
                sel.push(format!("CASE WHEN {call} THEN 1 ELSE 0 END AS {ai}"));
                cols.push(Col { name: "cw".into(), ty: Ty::Int, stmt: st_idx, generated: false, ident: false });
            }
        }
        if self.g.bool_with(0.15) {
            let r3 = self.g.index(self.m.rels.len());
            let f3 = self.rel_ref(r3, &mut d);
            conds.push(format!("EXISTS (SELECT 1 FROM {f3} AS r3)"));
        }
        if self.g.bool_with(0.15) {
            // r1.c IN (SELECT same-typed column FROM other relation)
            let c = self.g.index(n);
            let t = self.m.rels[r].cols[c].ty.clone();
            let cands: Vec<(usize, usize)> = (0..self.m.rels.len())
                .flat_map(|x| (0..self.m.rels[x].cols.len()).map(move |y| (x, y)))
                .filter(|&(x, y)| self.m.rels[x].cols[y].ty == t && self.keyable(&t))
                .collect();
            if !cands.is_empty() {
                let (x, y) = cands[self.g.index(cands.len())];
                let cr = self.col_ref(r, c, &mut d);
                let fx = self.rel_ref(x, &mut d);
                let cy = self.col_ref(x, y, &mut d);
                conds.push(format!("r1.{cr} IN (SELECT r4.{cy} FROM {fx} AS r4)"));
            }
        }
        if !self.m.ops.is_empty() && self.g.bool_with(0.2) {
            let oi = self.g.index(self.m.ops.len());
            let (on, os, st, ot) = (self.m.ops[oi].name.clone(), self.m.ops[oi].owner, self.m.ops[oi].stmt, self.m.op_types[oi].clone());
            let cs: Vec<usize> = (0..n).filter(|&c| self.m.rels[r].cols[c].ty == ot).collect();
            if !cs.is_empty() {
                let c = cs[self.g.index(cs.len())];
                d.push(st);
                let sc = self.schema_ref(os, &mut d);
                let cr = self.col_ref(r, c, &mut d);
                conds.push(format!("r1.{cr} OPERATOR({sc}.{on}) r1.{cr}"));
            }
        }
        if self.g.bool_with(0.1) {
            let r5 = self.g.index(self.m.rels.len());
            let f5 = self.rel_ref(r5, &mut d);
            with = format!("WITH w AS (SELECT * FROM {f5}) ");
            from_clause.push_str(" CROSS JOIN w");
        }
        if !masked("rowtype_cast") && self.g.bool_with(0.25) {
            let vs: Vec<usize> = (0..self.m.rels.len()).filter(|&x| self.m.rels[x].kind == RelKind::View && !self.m.rels[x].cols.is_empty()).collect();
            if !vs.is_empty() {
                let x = vs[self.g.index(vs.len())];
                let vq = self.rel_ref(x, &mut d);
                if self.g.bool_with(0.5) {
                    let y = self.g.index(self.m.rels[x].cols.len());
                    let t = self.m.rels[x].cols[y].ty.clone();
                    let cy = self.col_ref(x, y, &mut d);
                    let ai = self.ident("rc");
                    sel.push(format!("(NULL::{vq}).{cy} AS {ai}"));
                    cols.push(Col { name: "rc".into(), ty: t, stmt: st_idx, generated: false, ident: false });
                } else {
                    conds.push(format!("NULL::{vq} IS NULL"));
                }
            }
        }
        if !masked("type_cast_hidden") && self.g.bool_with(0.25) {
            let ts: Vec<usize> = (0..self.m.types.len()).filter(|&i| matches!(self.m.types[i].kind, UKind::Enum(_) | UKind::Domain(_))).collect();
            if !ts.is_empty() {
                let i = ts[self.g.index(ts.len())];
                let l = match self.m.types[i].kind.clone() {
                    UKind::Enum(labels) => lit_str(&self.g.pick(&labels).clone()),
                    UKind::Domain(base) => self.lit(&base, &mut d),
                    _ => unreachable!(),
                };
                let tn = self.ty_name(&Ty::User(i), &mut d);
                let ai = self.ident("ec");
                sel.push(format!("CAST({l} AS {tn}) AS {ai}"));
                cols.push(Col { name: "ec".into(), ty: Ty::User(i), stmt: st_idx, generated: false, ident: false });
            }
        }
        let wh = if conds.is_empty() { String::new() } else { format!(" WHERE {}", conds.join(" AND ")) };
        let kw = if mat { "MATERIALIZED VIEW" } else { "VIEW" };
        let sql = format!("CREATE {kw} {q} AS {with}SELECT {} FROM {from_clause}{wh}", sel.join(", "));
        let st = self.push(sql, d);
        self.m.rels.push(Rel {
            schema: s,
            name,
            kind: if mat { RelKind::MatView } else { RelKind::View },
            cols,
            pk: None,
            stmt: st,
            part_next: 0,
            has_default_part: false,
            frozen: false, pkey: None, typed: false, attached: false,
        });
    }

    fn gen_sequence(&mut self) {
        let s = self.pick_schema();
        let name = self.fresh("seq");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let st = self.push(format!("CREATE SEQUENCE {q}"), d);
        self.m.seqs.push(Named { name, stmt: st, owner: s });
    }

    fn gen_seq_owned(&mut self) {
        if self.m.seqs.is_empty() {
            return;
        }
        let si = self.g.index(self.m.seqs.len());
        let s = self.m.seqs[si].owner;
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::Table && self.m.rels[r].schema == s).collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let (sn, st) = (self.m.seqs[si].name.clone(), self.m.seqs[si].stmt);
        d.push(st);
        let sq = self.qname(s, &sn, &mut d);
        let fq = self.force_qual;
        self.force_qual = masked("ownedby");
        let rq = self.rel_ref(r, &mut d);
        self.force_qual = fq;
        let c = self.pick_col_alter(r);
        let cr = self.col_ref(r, c, &mut d);
        self.push(format!("ALTER SEQUENCE {sq} OWNED BY {rq}.{cr}"), d);
    }

    fn gen_trigger(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned)).collect();
        if cands.is_empty() {
            return;
        }
        if self.m.funcs.iter().all(|f| f.kind != FKind::Trigger) {
            self.make_trigger_func();
        }
        let Some(f) = self.pick_func(|f| f.kind == FKind::Trigger) else { return };
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let fq = self.call(f, vec![], &mut d);
        let name = self.fresh("trg");
        let ni = self.ident(&name);
        let mut when = (*self.g.pick(&["BEFORE INSERT", "AFTER UPDATE", "BEFORE INSERT OR UPDATE"])).to_string();
        if when == "AFTER UPDATE" && self.g.bool_with(0.5) {
            let c = self.g.index(self.m.rels[r].cols.len());
            let cr = self.col_ref(r, c, &mut d);
            when = format!("AFTER UPDATE OF {cr}");
        }
        let mut cond = String::new();
        if self.g.bool_with(0.3) {
            let c = self.g.index(self.m.rels[r].cols.len());
            let t = self.m.rels[r].cols[c].ty.clone();
            self.ensure_func(true, &t);
            if let Some(f) = self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                let cr = self.col_ref(r, c, &mut d);
                cond = format!(" WHEN ({})", self.call(f, vec![format!("NEW.{cr}")], &mut d));
            }
        }
        let st = self.push(format!("CREATE TRIGGER {ni} {when} ON {rq} FOR EACH ROW{cond} EXECUTE FUNCTION {fq}"), d);
        self.m.triggers.push(Named { name, stmt: st, owner: r });
    }

    fn gen_policy(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned)).collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let c = self.g.index(self.m.rels[r].cols.len());
        let t = self.m.rels[r].cols[c].ty.clone();
        let using = if self.g.bool_with(0.3) {
            // subselect over another table/view, optionally through a predicate function
            let r2 = self.g.index(self.m.rels.len());
            let f2 = self.rel_ref(r2, &mut d);
            let c2 = self.g.index(self.m.rels[r2].cols.len());
            let t2 = self.m.rels[r2].cols[c2].ty.clone();
            match self.pick_func(|f| f.kind == FKind::Pred && f.args == [t2.clone()]) {
                Some(f) => {
                    let cr = self.col_ref(r2, c2, &mut d);
                    let call = self.call(f, vec![format!("px.{cr}")], &mut d);
                    format!("EXISTS (SELECT 1 FROM {f2} AS px WHERE {call})")
                }
                None => format!("EXISTS (SELECT 1 FROM {f2} AS px)"),
            }
        } else {
            match self.pick_func(|f| f.kind == FKind::Pred && f.args == [t.clone()]) {
                Some(f) => {
                    let cr = self.col_ref(r, c, &mut d);
                    self.call(f, vec![cr], &mut d)
                }
                None => "true".into(),
            }
        };
        let restrictive = if self.g.bool_with(0.25) { " AS RESTRICTIVE" } else { "" };
        let to = if !self.m.roles.is_empty() && self.g.bool_with(0.5) {
            let ri = self.g.index(self.m.roles.len());
            let (rn, st) = (self.m.roles[ri].name.clone(), self.m.roles[ri].stmt);
            d.push(st);
            format!(" TO {}", self.ident(&rn))
        } else {
            String::new()
        };
        let mut check = String::new();
        if self.g.bool_with(0.3) {
            let r2 = self.g.index(self.m.rels.len());
            let f2 = self.rel_ref(r2, &mut d);
            check = format!(" WITH CHECK (EXISTS (SELECT 1 FROM {f2}))");
        }
        let name = self.fresh("pol");
        let ni = self.ident(&name);
        let st = self.push(format!("CREATE POLICY {ni} ON {rq}{restrictive}{to} USING ({using}){check}"), d);
        self.m.policies.push(Named { name, stmt: st, owner: r });
    }

    fn gen_role(&mut self) {
        let name = self.fresh("role_");
        let ni = self.ident(&name);
        let st = self.push(format!("CREATE ROLE {ni}"), D::new());
        self.m.roles.push(Named { name, stmt: st, owner: 0 });
    }

    fn pick_role(&mut self, d: &mut D) -> Option<String> {
        if self.m.roles.is_empty() {
            return None;
        }
        let ri = self.g.index(self.m.roles.len());
        let (rn, st) = (self.m.roles[ri].name.clone(), self.m.roles[ri].stmt);
        d.push(st);
        Some(self.ident(&rn))
    }

    fn gen_collation(&mut self) {
        let s = self.pick_schema();
        let name = self.fresh("coll");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let from = if self.g.bool_with(0.5) { "FROM \"C\"".to_string() } else { "(provider = libc, locale = 'C')".to_string() };
        let st = self.push(format!("CREATE COLLATION {q} {from}"), d);
        self.m.collations.push(Named { name, stmt: st, owner: s });
    }

    fn gen_aggregate(&mut self) {
        let Some(f) = self.pick_func(|f| f.kind == FKind::Sfunc) else { return };
        let s = self.pick_schema();
        let name = self.fresh("agg");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let t = self.m.funcs[f].ret.clone();
        let tn = self.ty_name(&t, &mut d);
        let tn2 = self.ty_name(&t, &mut d);
        let sf = self.func_ref_name(f, &mut d);
        let mut extra = String::new();
        if self.g.bool_with(0.4) {
            if self.m.funcs.iter().all(|g| !(g.kind == FKind::Identity && g.args == [t.clone()] && g.ret == t)) {
                self.make_identity_func(&t);
            }
            if let Some(g) = self.pick_func(|g| g.kind == FKind::Identity && g.args == [t.clone()] && g.ret == t) {
                extra.push_str(&format!(", FINALFUNC = {}", self.func_ref_name(g, &mut d)));
            }
        }
        if self.g.bool_with(0.4) {
            if let Some(g) = self.pick_func(|g| g.kind == FKind::Sfunc && g.args == [t.clone(), t.clone()]) {
                extra.push_str(&format!(", COMBINEFUNC = {}", self.func_ref_name(g, &mut d)));
            }
        }
        let st = self.push(format!("CREATE AGGREGATE {q}({tn}) (SFUNC = {sf}, STYPE = {tn2}{extra})"), d);
        self.m.aggs.push(Func { schema: s, name, args: vec![t.clone()], ret: t, kind: FKind::Sfunc, stmt: st });
    }

    fn gen_schema(&mut self) {
        let name = self.fresh("s");
        let ni = self.ident(&name);
        let mut d = D::new();
        let auth = if self.g.bool_with(0.2) { self.pick_role(&mut d).map(|r| format!(" AUTHORIZATION {r}")).unwrap_or_default() } else { String::new() };
        let st = self.push(format!("CREATE SCHEMA {ni}{auth}"), d);
        self.m.schemas.push(Schema { name, stmt: Some(st) });
    }

    /// COMMENT / GRANT / ALTER OWNER on some existing object
    fn gen_meta(&mut self) {
        let mut d = D::new();
        // pick object
        let obj: Option<(String, String)> = match *self.g.weighted(&[(4, 0), (3, 1), (2, 2), (1, 3), (1, 4), (1, 5), (1, 6), (1, 7), (1, 8), (1, 9), (1, 10), (1, 11), (1, 12), (1, 13)]) {
            0 if !self.m.rels.is_empty() => {
                let r = self.g.index(self.m.rels.len());
                let kw = match self.m.rels[r].kind {
                    RelKind::View => "VIEW",
                    RelKind::MatView => "MATERIALIZED VIEW",
                    _ => "TABLE",
                };
                Some((kw.into(), self.rel_ref(r, &mut d)))
            }
            1 if !self.m.funcs.is_empty() => {
                let f = self.g.index(self.m.funcs.len());
                let kw = if self.m.funcs[f].kind == FKind::Proc { "PROCEDURE" } else { "FUNCTION" };
                Some((kw.into(), self.func_sig(f, &mut d)))
            }
            2 if !self.m.types.is_empty() => {
                let t = Ty::User(self.g.index(self.m.types.len()));
                let kw = if let Ty::User(i) = t { if matches!(self.m.types[i].kind, UKind::Domain(_)) { "DOMAIN" } else { "TYPE" } } else { "TYPE" };
                Some((kw.into(), self.ty_name(&t, &mut d)))
            }
            3 if self.m.schemas.len() > 1 => {
                let s = 1 + self.g.index(self.m.schemas.len() - 1);
                Some(("SCHEMA".into(), self.schema_ref(s, &mut d)))
            }
            4 if !self.m.seqs.is_empty() => {
                let si = self.g.index(self.m.seqs.len());
                let (n, o, st) = (self.m.seqs[si].name.clone(), self.m.seqs[si].owner, self.m.seqs[si].stmt);
                d.push(st);
                Some(("SEQUENCE".into(), self.qname(o, &n, &mut d)))
            }
            5 if !self.m.indexes.is_empty() => {
                let i = self.g.index(self.m.indexes.len());
                let (n, r, st) = (self.m.indexes[i].name.clone(), self.m.indexes[i].owner, self.m.indexes[i].stmt);
                d.push(st);
                let s = self.m.rels[r].schema;
                Some(("INDEX".into(), self.qname(s, &n, &mut d)))
            }
            6 if !self.m.policies.is_empty() => {
                let i = self.g.index(self.m.policies.len());
                let (n, r, st) = (self.m.policies[i].name.clone(), self.m.policies[i].owner, self.m.policies[i].stmt);
                d.push(st);
                let rq = self.rel_ref(r, &mut d);
                let ni = self.ident(&n);
                Some(("POLICY".into(), format!("{ni} ON {rq}")))
            }
            7 if !self.m.triggers.is_empty() => {
                let i = self.g.index(self.m.triggers.len());
                let (n, r, st) = (self.m.triggers[i].name.clone(), self.m.triggers[i].owner, self.m.triggers[i].stmt);
                d.push(st);
                let rq = self.rel_ref(r, &mut d);
                let ni = self.ident(&n);
                Some(("TRIGGER".into(), format!("{ni} ON {rq}")))
            }
            8 if !self.m.constraints.is_empty() => {
                let i = self.g.index(self.m.constraints.len());
                let (n, r, st) = (self.m.constraints[i].name.clone(), self.m.constraints[i].owner, self.m.constraints[i].stmt);
                d.push(st);
                let rq = self.rel_ref(r, &mut d);
                let ni = self.ident(&n);
                Some(("CONSTRAINT".into(), format!("{ni} ON {rq}")))
            }
            9 if !self.m.rels.is_empty() => {
                let r = self.g.index(self.m.rels.len());
                let c = self.g.index(self.m.rels[r].cols.len());
                let rq = self.rel_ref(r, &mut d);
                let cr = self.col_ref(r, c, &mut d);
                Some(("COLUMN".into(), format!("{rq}.{cr}")))
            }
            10 if !self.m.aggs.is_empty() => {
                let a = self.g.index(self.m.aggs.len());
                let (s, n, st, t) = (self.m.aggs[a].schema, self.m.aggs[a].name.clone(), self.m.aggs[a].stmt, self.m.aggs[a].ret.clone());
                d.push(st);
                let q = self.qname(s, &n, &mut d);
                let tn = self.ty_name(&t, &mut d);
                Some(("AGGREGATE".into(), format!("{q}({tn})")))
            }
            11 if !self.m.rules.is_empty() => {
                let i = self.g.index(self.m.rules.len());
                let (n, r, st) = (self.m.rules[i].name.clone(), self.m.rules[i].owner, self.m.rules[i].stmt);
                d.push(st);
                let rq = self.rel_ref(r, &mut d);
                let ni = self.ident(&n);
                Some(("RULE".into(), format!("{ni} ON {rq}")))
            }
            12 if !self.m.collations.is_empty() => {
                let i = self.g.index(self.m.collations.len());
                let (n, o, st) = (self.m.collations[i].name.clone(), self.m.collations[i].owner, self.m.collations[i].stmt);
                d.push(st);
                Some(("COLLATION".into(), self.qname(o, &n, &mut d)))
            }
            13 if !self.m.publications.is_empty() => {
                let i = self.g.index(self.m.publications.len());
                let (n, st) = (self.m.publications[i].name.clone(), self.m.publications[i].stmt);
                d.push(st);
                Some(("PUBLICATION".into(), self.ident(&n)))
            }
            _ => None,
        };
        let Some((kw, target)) = obj else { return };
        let action = *self.g.weighted(&[(3, 0), (2, 1), (1, 2)]);
        let sql = match action {
            1 => {
                let role = if self.g.bool_with(0.2) {
                    "PUBLIC".to_string()
                } else {
                    let Some(role) = self.pick_role(&mut d) else { return };
                    role
                };
                let (privs, on) = match kw.as_str() {
                    "TABLE" | "VIEW" | "MATERIALIZED VIEW" => ("SELECT", format!("TABLE {target}")),
                    "FUNCTION" => ("EXECUTE", format!("FUNCTION {target}")),
                    "PROCEDURE" => ("EXECUTE", format!("PROCEDURE {target}")),
                    "TYPE" => ("USAGE", format!("TYPE {target}")),
                    "DOMAIN" => ("USAGE", format!("DOMAIN {target}")),
                    "SCHEMA" => ("USAGE", format!("SCHEMA {target}")),
                    "SEQUENCE" => ("USAGE", format!("SEQUENCE {target}")),
                    "COLUMN" => {
                        let (t, c) = target.rsplit_once('.').unwrap();
                        return {
                            let sql = format!("GRANT SELECT ({c}) ON TABLE {t} TO {role}");
                            self.push(sql, d);
                        };
                    }
                    _ => return,
                };
                if role == "PUBLIC" && self.g.bool_with(0.5) {
                    format!("REVOKE ALL ON {on} FROM PUBLIC")
                } else if self.g.bool_with(0.3) {
                    format!("REVOKE {privs} ON {on} FROM {role}")
                } else {
                    format!("GRANT {privs} ON {on} TO {role}")
                }
            }
            2 => {
                let Some(role) = self.pick_role(&mut d) else { return };
                match kw.as_str() {
                    // tables/sequences excluded: OWNED BY needs equal owners
                    "FUNCTION" | "PROCEDURE" | "TYPE" | "DOMAIN" | "SCHEMA" | "AGGREGATE" => {
                        format!("ALTER {kw} {target} OWNER TO {role}")
                    }
                    _ => return,
                }
            }
            _ => format!("COMMENT ON {kw} {target} IS {}", lit_str("it's a comment")),
        };
        self.push(sql, d);
    }

    fn gen_default_privs(&mut self) {
        let mut d = D::new();
        let Some(r1) = self.pick_role(&mut d) else { return };
        let Some(r2) = self.pick_role(&mut d) else { return };
        let s = self.pick_schema();
        let sc = self.schema_ref(s, &mut d);
        let what = *self.g.pick(&["SELECT ON TABLES", "EXECUTE ON FUNCTIONS", "USAGE ON TYPES", "USAGE ON SEQUENCES"]);
        let in_schema = if self.g.bool_with(0.7) { format!(" IN SCHEMA {sc}") } else { String::new() };
        if in_schema.is_empty() {
            d.retain(|_| true);
        }
        self.push(format!("ALTER DEFAULT PRIVILEGES FOR ROLE {r1}{in_schema} GRANT {what} TO {r2}"), d);
    }

    fn gen_inherits(&mut self) {
        // ADD COLUMN ... IDENTITY fails once the table has children, so an ordering the input may permute
        let cands: Vec<usize> = (0..self.m.rels.len())
            .filter(|&r| self.m.rels[r].kind == RelKind::Table && !self.is_partition(r) && !self.m.rels[r].cols.iter().any(|c| c.ident && c.stmt != self.m.rels[r].stmt))
            .collect();
        if cands.is_empty() {
            return;
        }
        let p = cands[self.g.index(cands.len())];
        let s = self.pick_schema();
        let name = self.fresh("ch");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let pq = self.rel_ref(p, &mut d);
        for c in self.m.rels[p].cols.clone() {
            d.push(c.stmt);
        }
        let st_idx = self.stmts.len();
        let t = self.any_ty();
        let tn = self.ty_name(&t, &mut d);
        let cname = format!("x{}", self.n);
        let ci = self.ident(&cname);
        let st = self.push(format!("CREATE TABLE {q} ({ci} {tn}) INHERITS ({pq})"), d);
        debug_assert_eq!(st, st_idx);
        let pstmt = self.m.rels[p].stmt;
        let mut cols: Vec<Col> = self.m.rels[p]
            .cols
            .iter()
            .filter(|c| !masked("addcol") || c.stmt == pstmt)
            .map(|c| Col { stmt: st, generated: false, ident: false, ..c.clone() })
            .collect();
        cols.push(Col { name: cname, ty: t, stmt: st, generated: false, ident: false });
        // a later ADD COLUMN on the parent would change the child's row type
        self.m.rels[p].frozen = true;
        self.m.rels.push(Rel { schema: s, name, kind: RelKind::Table, cols, pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
    }

    fn gen_extension(&mut self) {
        if self.m.citext.is_some() {
            return;
        }
        let s = self.pick_schema();
        let mut d = D::new();
        let sql = if s == 0 && self.g.bool_with(0.5) {
            "CREATE EXTENSION citext".to_string()
        } else {
            format!("CREATE EXTENSION citext WITH SCHEMA {}", self.schema_ref(s, &mut d))
        };
        let st = self.push(sql, d);
        self.m.citext = Some((s, st));
    }

    fn gen_publication(&mut self) {
        if self.has_update {
            return;
        }
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned)).collect();
        let name = self.fresh("pub");
        let ni = self.ident(&name);
        let mut d = D::new();
        let plain: Vec<usize> = cands.iter().copied().filter(|&r| self.m.rels[r].kind == RelKind::Table && self.m.rels[r].cols.iter().any(|c| !c.generated)).collect();
        let target = if self.m.schemas.len() > 1 && self.g.bool_with(0.3) {
            let s = 1 + self.g.index(self.m.schemas.len() - 1);
            format!("FOR TABLES IN SCHEMA {}", self.schema_ref(s, &mut d))
        } else if !plain.is_empty() && self.g.bool_with(0.35) {
            // column list (generated columns are not allowed in one)
            let r = plain[self.g.index(plain.len())];
            let ok: Vec<usize> = (0..self.m.rels[r].cols.len()).filter(|&i| !self.m.rels[r].cols[i].generated).collect();
            let k = self.g.int(1usize..=ok.len().min(2));
            let mut picked: Vec<usize> = Vec::new();
            for _ in 0..k {
                let c = ok[self.g.index(ok.len())];
                if !picked.contains(&c) {
                    picked.push(c);
                }
            }
            let rq = self.rel_ref(r, &mut d);
            let names: Vec<String> = picked.iter().map(|&c| self.col_ref(r, c, &mut d)).collect();
            format!("FOR TABLE {rq} ({})", names.join(", "))
        } else if !cands.is_empty() {
            let k = self.g.int(1usize..=cands.len().min(2));
            let mut picked: Vec<usize> = Vec::new();
            for _ in 0..k {
                let r = cands[self.g.index(cands.len())];
                if !picked.contains(&r) {
                    picked.push(r);
                }
            }
            let names: Vec<String> = picked.iter().map(|&r| self.rel_ref(r, &mut d)).collect();
            format!("FOR TABLE {}", names.join(", "))
        } else {
            return;
        };
        let st = self.push(format!("CREATE PUBLICATION {ni} {target}"), d);
        self.m.publications.push(Named { name, stmt: st, owner: 0 });
    }

    fn gen_event_trigger(&mut self) {
        let Some(f) = self.pick_func(|f| f.kind == FKind::EventTrg) else { return };
        let mut d = D::new();
        let fq = self.call(f, vec![], &mut d);
        let name = self.fresh("evt");
        let ni = self.ident(&name);
        let ev = *self.g.pick(&["ddl_command_end", "sql_drop"]);
        self.push(format!("CREATE EVENT TRIGGER {ni} ON {ev} EXECUTE FUNCTION {fq}"), d);
    }

    fn gen_operator(&mut self) {
        // CREATE OPERATOR is UNKNOWN_STATEMENT_CLASS in pg-topo (diagnosed, not silent)
        if masked("operator") {
            return;
        }
        let Some(f) = self.pick_func(|f| f.kind == FKind::BinPred) else { return };
        let s = self.pick_schema();
        let mut d = D::new();
        let t = self.m.funcs[f].args[0].clone();
        let mut k = self.n;
        self.n += 1;
        let mut op = String::from("#");
        loop {
            op.push(['@', '&', '|', '~'][k % 4]);
            k /= 4;
            if k == 0 {
                break;
            }
        }
        let sc = self.schema_ref(s, &mut d);
        let tn = self.ty_name(&t, &mut d);
        let tn2 = self.ty_name(&t, &mut d);
        let fq = self.func_ref_name(f, &mut d);
        let st = self.push(format!("CREATE OPERATOR {sc}.{op} (LEFTARG = {tn}, RIGHTARG = {tn2}, FUNCTION = {fq})"), d);
        self.m.ops.push(Named { name: op, stmt: st, owner: s });
        self.m.op_types.push(t);
    }

    pub fn build(mut self, steps: usize) -> Vec<Stmt> {
        for _ in 0..steps {
            let a = *self.g.weighted(&[
                (2, 0),  // schema
                (3, 1),  // type
                (5, 2),  // function
                (5, 3),  // table
                (3, 4),  // alter table
                (2, 5),  // index
                (3, 6),  // view
                (1, 7),  // matview
                (1, 8),  // sequence
                (1, 9),  // seq owned
                (1, 10), // trigger
                (1, 11), // policy
                (2, 12), // role
                (3, 13), // meta
                (1, 14), // collation
                (1, 15), // aggregate
                (1, 16), // partition
                (1, 17), // default privs
                (1, 18), // inherits
                (1, 19), // extension
                (1, 20), // publication
                (1, 21), // event trigger
                (1, 22), // operator
                (1, 23), // like
                (1, 24), // unique index (+ alters)
                (1, 25), // typed table
                (1, 26), // instead-of trigger
                (1, 27), // rule
                (1, 28), // recursive view
                (1, 29), // attach partition
                (1, 30), // add identity
                (1, 31), // ctas
                (1, 32), // join view + matview
                (1, 33), // schema with elements
                (if masked("rename") { 0 } else { 3 }, 34),
                (if masked("search_path") { 0 } else { 1 }, 35),
                (if masked("unknown_stmt") { 0 } else { 2 }, 36),
                (2, 37), // top-level SELECT / UPDATE, ALTER PUBLICATION, FDW, DO, subscription
            ]);
            match a {
                0 => self.gen_schema(),
                1 => self.gen_type(),
                2 => self.gen_func(),
                3 => self.gen_table(),
                4 => self.gen_alter_table(),
                5 => self.gen_index(),
                6 => self.gen_view(false),
                7 => self.gen_view(true),
                8 => self.gen_sequence(),
                9 => self.gen_seq_owned(),
                10 => self.gen_trigger(),
                11 => self.gen_policy(),
                12 => self.gen_role(),
                13 => self.gen_meta(),
                14 => self.gen_collation(),
                15 => self.gen_aggregate(),
                16 => self.gen_partition(),
                17 => self.gen_default_privs(),
                18 => self.gen_inherits(),
                19 => self.gen_extension(),
                20 => self.gen_publication(),
                21 => self.gen_event_trigger(),
                22 => self.gen_operator(),
                23 => self.gen_like(),
                24 => self.gen_unique_index(),
                25 => self.gen_typed(),
                26 => self.gen_instead_trigger(),
                27 => self.gen_rule(),
                28 => self.gen_recursive_view(),
                29 => self.gen_attach(),
                30 => self.gen_add_identity(),
                31 => self.gen_join(0),
                32 => self.gen_join(2),
                33 => self.gen_schema_elts(),
                34 => self.gen_rename(),
                35 => self.gen_search_path(),
                36 => self.gen_unknown_stmt(),
                _ => self.gen_misc_stmt(),
            }
        }
        self.stmts
    }
}

// ---------------------------------------------------------------- extra constructs

impl<'a> Gen<'a> {
    /// statement `i` reads (transitively) a recursive view, which is the only source of rows
    fn reaches_rows(&self, i: usize) -> bool {
        self.stmts[i].sql.starts_with("CREATE RECURSIVE VIEW") || self.stmts[i].deps.iter().any(|&d| self.reaches_rows(d))
    }

    /// a CREATE TABLE AS that was filled with rows: later constraints/NOT NULL columns could fail
    fn populated(&self, r: usize) -> bool {
        let sql = &self.stmts[self.m.rels[r].stmt].sql;
        sql.contains(" AS SELECT ") && !sql.ends_with("WITH NO DATA") && self.reaches_rows(self.m.rels[r].stmt)
    }

    fn push_cols_deps(&self, r: usize, d: &mut D) {
        for c in &self.m.rels[r].cols {
            d.push(c.stmt);
        }
    }

    /// CREATE TABLE t2 (LIKE t1 [INCLUDING ...])
    fn gen_like(&mut self) {
        if masked("like") {
            return;
        }
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned | RelKind::View)).collect();
        if cands.is_empty() {
            return;
        }
        let src = cands[self.g.index(cands.len())];
        let s = self.pick_schema();
        let name = self.fresh("lk");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let sq = self.rel_ref(src, &mut d);
        self.push_cols_deps(src, &mut d);
        let (opts, keep_pk, keep_gen, keep_ident) = match *self.g.weighted(&[(2, 0), (3, 1), (2, 2)]) {
            0 => ("", false, false, false),
            1 => (" INCLUDING ALL", true, true, true),
            _ => (" INCLUDING DEFAULTS INCLUDING INDEXES INCLUDING CONSTRAINTS", true, false, false),
        };
        let st = self.push(format!("CREATE TABLE {q} (LIKE {sq}{opts})"), d);
        let pk = if keep_pk && self.m.rels[src].kind == RelKind::Table { self.m.rels[src].pk } else { None };
        let cols = self.m.rels[src]
            .cols
            .iter()
            .map(|c| Col { stmt: st, generated: c.generated && keep_gen, ident: c.ident && keep_ident, ..c.clone() })
            .collect();
        self.m.rels.push(Rel { schema: s, name, kind: RelKind::Table, cols, pk, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
    }

    /// CREATE TABLE t OF composite
    fn gen_typed(&mut self) {
        let cands: Vec<usize> = (0..self.m.types.len()).filter(|&i| matches!(self.m.types[i].kind, UKind::Composite(_))).collect();
        if cands.is_empty() {
            return;
        }
        let ti = cands[self.g.index(cands.len())];
        let s = self.pick_schema();
        let name = self.fresh("tt");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let tn = self.ty_name(&Ty::User(ti), &mut d);
        let UKind::Composite(fields) = self.m.types[ti].kind.clone() else { return };
        let st = self.push(format!("CREATE TABLE {q} OF {tn}"), d);
        let cols = fields.into_iter().map(|(n, t)| Col { name: n, ty: t, stmt: st, generated: false, ident: false }).collect();
        self.m.rels.push(Rel { schema: s, name, kind: RelKind::Table, cols, pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: true, attached: false });
    }

    /// CREATE UNIQUE INDEX, then CLUSTER ON / REPLICA IDENTITY USING INDEX / ADD CONSTRAINT USING INDEX
    fn gen_unique_index(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::Table && !self.populated(r)).collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let cs: Vec<usize> = {
            let rel = &self.m.rels[r];
            // a unique index on the PK column duplicates its key (pg-topo bug N20)
            (0..rel.cols.len())
                .filter(|&i| self.keyable(&rel.cols[i].ty) && (!masked("addcol") || rel.cols[i].stmt == rel.stmt) && (!masked("dup_key") || rel.pk != Some(i)))
                .collect()
        };
        if cs.is_empty() {
            return;
        }
        let c = cs[self.g.index(cs.len())];
        let alters = !masked("index_alter");
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let cr = self.col_ref(r, c, &mut d);
        if alters && self.m.rels[r].pk != Some(c) {
            let nn = self.push(format!("ALTER TABLE {rq} ALTER COLUMN {cr} SET NOT NULL"), d.clone());
            d.push(nn);
        }
        let name = self.fresh("ux");
        let ni = self.ident(&name);
        let st = self.push(format!("CREATE UNIQUE INDEX {ni} ON {rq} ({cr})"), d.clone());
        self.m.indexes.push(Named { name: name.clone(), stmt: st, owner: r });
        if !alters {
            return;
        }
        let mut d2 = d;
        d2.push(st);
        if self.g.bool_with(0.5) {
            let ix = self.ident(&name);
            self.push(format!("ALTER TABLE {rq} CLUSTER ON {ix}"), d2.clone());
        }
        if self.g.bool_with(0.5) {
            let ix = self.ident(&name);
            self.push(format!("ALTER TABLE {rq} REPLICA IDENTITY USING INDEX {ix}"), d2.clone());
        }
        if self.g.bool_with(0.5) {
            let (a, b) = (self.ident(&name), self.ident(&name));
            let cst = self.push(format!("ALTER TABLE {rq} ADD CONSTRAINT {a} UNIQUE USING INDEX {b}"), d2);
            self.m.constraints.push(Named { name, stmt: cst, owner: r });
        }
    }

    fn gen_instead_trigger(&mut self) {
        let views: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::View).collect();
        if views.is_empty() {
            return;
        }
        if self.g.bool_with(0.5) || self.m.funcs.iter().all(|f| f.kind != FKind::Trigger) {
            self.make_trigger_func();
        }
        let Some(f) = self.pick_func(|f| f.kind == FKind::Trigger) else { return };
        if views.is_empty() {
            return;
        }
        let r = views[self.g.index(views.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let fq = self.call(f, vec![], &mut d);
        let name = self.fresh("trg");
        let ni = self.ident(&name);
        let ev = *self.g.pick(&["INSERT", "UPDATE", "DELETE", "INSERT OR UPDATE"]);
        let st = self.push(format!("CREATE TRIGGER {ni} INSTEAD OF {ev} ON {rq} FOR EACH ROW EXECUTE FUNCTION {fq}"), d);
        self.m.triggers.push(Named { name, stmt: st, owner: r });
    }

    /// CREATE RULE ... AS ON INSERT TO view DO INSTEAD INSERT INTO table ...
    fn gen_rule(&mut self) {
        let views: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::View && !self.m.rels[r].cols.is_empty()).collect();
        if views.is_empty() {
            return;
        }
        let r = views[self.g.index(views.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let name = self.fresh("rl");
        let ni = self.ident(&name);
        let sql = if self.g.bool_with(0.25) {
            let ev = *self.g.pick(&["UPDATE", "DELETE"]);
            format!("CREATE RULE {ni} AS ON {ev} TO {rq} DO INSTEAD NOTHING")
        } else {
            let tabs: Vec<usize> = (0..self.m.rels.len()).filter(|&x| self.m.rels[x].kind == RelKind::Table).collect();
            if tabs.is_empty() {
                return;
            }
            let x = tabs[self.g.index(tabs.len())];
            let xq = self.rel_ref(x, &mut d);
            let pairs: Vec<(usize, usize)> = (0..self.m.rels[r].cols.len())
                .flat_map(|vi| (0..self.m.rels[x].cols.len()).map(move |ti| (vi, ti)))
                .filter(|&(vi, ti)| {
                    let (vc, tc) = (&self.m.rels[r].cols[vi], &self.m.rels[x].cols[ti]);
                    vc.ty == tc.ty && !tc.generated && !tc.ident
                })
                .collect();
            if pairs.is_empty() {
                format!("CREATE RULE {ni} AS ON INSERT TO {rq} DO INSTEAD INSERT INTO {xq} DEFAULT VALUES")
            } else {
                let (vi, ti) = pairs[self.g.index(pairs.len())];
                let vc = self.col_ref(r, vi, &mut d);
                let tc = self.col_ref(x, ti, &mut d);
                format!("CREATE RULE {ni} AS ON INSERT TO {rq} DO INSTEAD INSERT INTO {xq} ({tc}) VALUES (NEW.{vc})")
            }
        };
        let st = self.push(sql, d);
        self.m.rules.push(Named { name, stmt: st, owner: r });
    }

    /// CREATE RECURSIVE VIEW v (n) AS ... UNION ALL ... FROM v
    fn gen_recursive_view(&mut self) {
        let s = self.pick_schema();
        let name = self.fresh("rv");
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        let self_ref = self.ident(&name);
        let ci = self.ident("n");
        let ints: Vec<(usize, usize)> = (0..self.m.rels.len())
            .flat_map(|r| (0..self.m.rels[r].cols.len()).map(move |c| (r, c)))
            .filter(|&(r, c)| self.m.rels[r].cols[c].ty == Ty::Int)
            .collect();
        let base = if !ints.is_empty() && self.g.bool_with(0.5) {
            let (r, c) = ints[self.g.index(ints.len())];
            let rq = self.rel_ref(r, &mut d);
            let cr = self.col_ref(r, c, &mut d);
            format!("SELECT x.{cr} FROM {rq} AS x")
        } else {
            "SELECT 1".to_string()
        };
        let step_expr = match self.pick_func(|f| f.kind == FKind::Identity && f.args == [Ty::Int]) {
            Some(f) if self.g.bool_with(0.4) => self.call(f, vec!["n".into()], &mut d),
            _ => "n".into(),
        };
        let st_idx = self.stmts.len();
        let st = self.push(format!("CREATE RECURSIVE VIEW {q} ({ci}) AS {base} UNION ALL SELECT {step_expr} + 1 FROM {self_ref} WHERE n < 3"), d);
        debug_assert_eq!(st, st_idx);
        let cols = vec![Col { name: "n".into(), ty: Ty::Int, stmt: st, generated: false, ident: false }];
        self.m.rels.push(Rel { schema: s, name, kind: RelKind::View, cols, pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
    }

    /// ADD COLUMN ... integer NOT NULL, then ALTER COLUMN ... ADD GENERATED ... AS IDENTITY
    fn gen_add_identity(&mut self) {
        let cands: Vec<usize> = (0..self.m.rels.len())
            .filter(|&r| {
                let rel = &self.m.rels[r];
                rel.kind == RelKind::Table && !self.is_partition(r) && !rel.frozen && !rel.typed && !self.populated(r) && !self.stmts[rel.stmt].sql.contains(" INHERITS (")
            })
            .collect();
        if cands.is_empty() {
            return;
        }
        let r = cands[self.g.index(cands.len())];
        let mut d = D::new();
        let rq = self.rel_ref(r, &mut d);
        let t = self.g.pick(&[Ty::Int, Ty::BigInt]).clone();
        let tn = self.ty_name(&t, &mut d);
        let cname = { self.n += 1; format!("ac{}", self.n) };
        let ci = self.ident(&cname);
        let how = if self.g.bool_with(0.5) { "ALWAYS" } else { "BY DEFAULT" };
        let st = if masked("identity_alter") {
            // one statement: ALTER COLUMN on a column added by ADD COLUMN loses its producer in pg-topo
            self.push(format!("ALTER TABLE {rq} ADD COLUMN {ci} {tn} GENERATED {how} AS IDENTITY"), d)
        } else {
            let a = self.push(format!("ALTER TABLE {rq} ADD COLUMN {ci} {tn} NOT NULL"), d.clone());
            d.push(a);
            let ci2 = self.ident(&cname);
            self.push(format!("ALTER TABLE {rq} ALTER COLUMN {ci2} ADD GENERATED {how} AS IDENTITY"), d)
        };
        self.m.rels[r].cols.push(Col { name: cname, ty: t, stmt: st, generated: false, ident: true });
    }

    /// FROM clause + select list over two relations
    fn join_parts(&mut self, d: &mut D, orig_only: bool) -> (Vec<String>, Vec<Col>, String) {
        let ok = |m: &Model, r: usize, c: usize| !orig_only || m.rels[r].cols[c].stmt == m.rels[r].stmt;
        let r1 = self.g.index(self.m.rels.len());
        let r2 = self.g.index(self.m.rels.len());
        let q1 = self.rel_ref(r1, d);
        let q2 = self.rel_ref(r2, d);
        let mut sel = Vec::new();
        let mut cols = Vec::new();
        let mut j = 0;
        for (alias, r) in [("a", r1), ("b", r2)] {
            let avail: Vec<usize> = (0..self.m.rels[r].cols.len()).filter(|&c| ok(&self.m, r, c)).collect();
            if avail.is_empty() {
                continue;
            }
            for _ in 0..self.g.int(1usize..=avail.len().min(2)) {
                let c = avail[self.g.index(avail.len())];
                let t = self.m.rels[r].cols[c].ty.clone();
                let cr = self.col_ref(r, c, d);
                let an = format!("o{j}");
                let ai = self.ident(&an);
                sel.push(format!("{alias}.{cr} AS {ai}"));
                cols.push(Col { name: an, ty: t, stmt: 0, generated: false, ident: false });
                j += 1;
            }
        }
        let pairs: Vec<(usize, usize)> = (0..self.m.rels[r1].cols.len())
            .flat_map(|x| (0..self.m.rels[r2].cols.len()).map(move |y| (x, y)))
            .filter(|&(x, y)| ok(&self.m, r1, x) && ok(&self.m, r2, y) && self.m.rels[r1].cols[x].ty == self.m.rels[r2].cols[y].ty && self.keyable(&self.m.rels[r1].cols[x].ty))
            .collect();
        let from = if !pairs.is_empty() && self.g.bool_with(0.6) {
            let (x, y) = pairs[self.g.index(pairs.len())];
            let cx = self.col_ref(r1, x, d);
            let cy = self.col_ref(r2, y, d);
            format!("{q1} AS a JOIN {q2} AS b ON (a.{cx} = b.{cy})")
        } else {
            format!("{q1} AS a CROSS JOIN {q2} AS b")
        };
        (sel, cols, from)
    }

    /// kind 0: CREATE TABLE AS over a join; kind 2: join view, then a materialized view over it
    fn gen_join(&mut self, kind: u8) {
        if self.m.rels.is_empty() {
            return;
        }
        let s = self.pick_schema();
        let name = self.fresh(if kind == 0 { "ct" } else { "jv" });
        let mut d = D::new();
        let q = self.qname(s, &name, &mut d);
        // CREATE TABLE AS loses producers of columns added by ALTER TABLE ADD COLUMN in pg-topo
        let (sel, mut cols, from) = self.join_parts(&mut d, kind == 0 && masked("ctas_addcol"));
        if sel.is_empty() {
            return;
        }
        let st_idx = self.stmts.len();
        let sql = if kind == 0 {
            let nodata = if self.g.bool_with(0.3) { " WITH NO DATA" } else { "" };
            format!("CREATE TABLE {q} AS SELECT {} FROM {from}{nodata}", sel.join(", "))
        } else {
            format!("CREATE VIEW {q} AS SELECT {} FROM {from}", sel.join(", "))
        };
        let st = self.push(sql, d);
        debug_assert_eq!(st, st_idx);
        for c in cols.iter_mut() {
            c.stmt = st;
        }
        let rkind = if kind == 0 { RelKind::Table } else { RelKind::View };
        self.m.rels.push(Rel { schema: s, name, kind: rkind, cols: cols.clone(), pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
        if kind != 2 {
            return;
        }
        // materialized view over the join view
        let v = self.m.rels.len() - 1;
        let ms = self.pick_schema();
        let mname = self.fresh("mv");
        let mut d = D::new();
        let mq = self.qname(ms, &mname, &mut d);
        let vq = self.rel_ref(v, &mut d);
        let mut msel = Vec::new();
        for c in &cols {
            let ci = self.ident(&c.name);
            msel.push(format!("v.{ci} AS {ci}"));
        }
        let mst = self.push(format!("CREATE MATERIALIZED VIEW {mq} AS SELECT {} FROM {vq} AS v", msel.join(", ")), d);
        let mcols = cols.iter().map(|c| Col { stmt: mst, ..c.clone() }).collect();
        self.m.rels.push(Rel { schema: ms, name: mname, kind: RelKind::MatView, cols: mcols, pk: None, stmt: mst, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
    }

    /// CREATE SCHEMA s CREATE TABLE ... CREATE VIEW ...
    fn gen_schema_elts(&mut self) {
        if masked("schema_elts") {
            return;
        }
        let name = self.fresh("s");
        let ni = self.ident(&name);
        let mut d = D::new();
        let sidx = self.m.schemas.len();
        let mut elems = String::new();
        let mut rels: Vec<(String, Vec<Col>, Option<usize>)> = Vec::new();
        for _ in 0..self.g.int(1usize..=2) {
            let tname = self.fresh("t");
            let ti = self.ident(&tname);
            let mut parts = Vec::new();
            let mut cols = Vec::new();
            let mut pk = None;
            for j in 0..self.g.int(1usize..=3) {
                let t = self.any_ty();
                let cname = format!("c{j}");
                let ci = self.ident(&cname);
                let tn = self.ty_name(&t, &mut d);
                let mut opt = "";
                if pk.is_none() && self.keyable(&t) && self.g.bool_with(0.5) {
                    opt = " PRIMARY KEY";
                    pk = Some(j);
                }
                parts.push(format!("{ci} {tn}{opt}"));
                cols.push(Col { name: cname, ty: t, stmt: 0, generated: false, ident: false });
            }
            elems.push_str(&format!(" CREATE TABLE {ti} ({})", parts.join(", ")));
            rels.push((tname, cols, pk));
        }
        // a view over the first table: bare name (resolved through the new schema) or qualified
        let (t0, c0, _) = rels[0].clone();
        let t0i = self.ident(&t0);
        let from = if self.g.bool_with(0.5) { t0i } else { format!("{ni}.{t0i}") };
        let vname = self.fresh("w");
        let vi = self.ident(&vname);
        let k = self.g.int(1usize..=c0.len().min(2));
        let mut sel = Vec::new();
        let mut vcols = Vec::new();
        for j in 0..k {
            let cr = self.ident(&c0[j].name);
            let an = format!("o{j}");
            let ai = self.ident(&an);
            sel.push(format!("x.{cr} AS {ai}"));
            vcols.push(Col { name: an, ty: c0[j].ty.clone(), stmt: 0, generated: false, ident: false });
        }
        elems.push_str(&format!(" CREATE VIEW {vi} AS SELECT {} FROM {from} AS x", sel.join(", ")));
        let st = self.push(format!("CREATE SCHEMA {ni}{elems}"), d);
        self.m.schemas.push(Schema { name, stmt: Some(st) });
        for (n, mut cols, pk) in rels {
            for c in cols.iter_mut() {
                c.stmt = st;
            }
            self.m.rels.push(Rel { schema: sidx, name: n, kind: RelKind::Table, cols, pk, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
        }
        for c in vcols.iter_mut() {
            c.stmt = st;
        }
        self.m.rels.push(Rel { schema: sidx, name: vname, kind: RelKind::View, cols: vcols, pk: None, stmt: st, part_next: 0, has_default_part: false, frozen: false, pkey: None, typed: false, attached: false });
    }
}

pub fn gen_case(g: &mut Source, max_steps: usize) -> Case {
    let steps = g.int(1usize..=max_steps);
    let stmts = Gen::new(g).build(steps);
    let n = stmts.len();
    // Fisher-Yates
    let mut order: Vec<usize> = (0..n).collect();
    match *g.weighted(&[(6, 0), (1, 1), (1, 2)]) {
        0 => {
            for i in (1..n).rev() {
                let j = g.int(0..=i);
                order.swap(i, j);
            }
        }
        1 => order.reverse(),
        _ => {}
    }
    let p = *g.pick(&[0.0, 0.1, 0.5, 1.0]);
    let breaks = (0..n).map(|_| g.bool_with(p)).collect();
    Case { stmts, order, breaks }
}

// ---------------------------------------------------------------- statements pg-topo does not classify

impl<'a> Gen<'a> {
    /// RenameStmt (UNKNOWN to pg-topo); the model follows the new name so later
    /// statements reference it and depend on the rename.
    fn gen_rename(&mut self) {
        match self.g.index(5) {
            0 if !self.m.rels.is_empty() => {
                let r = self.g.index(self.m.rels.len());
                let kw = match self.m.rels[r].kind {
                    RelKind::Table | RelKind::Partitioned => "TABLE",
                    RelKind::View => "VIEW",
                    RelKind::MatView => "MATERIALIZED VIEW",
                };
                let mut d = D::new();
                let q = self.rel_ref(r, &mut d);
                let new = self.fresh("rn");
                let ni = self.ident(&new);
                let st = self.push(format!("ALTER {kw} {q} RENAME TO {ni}"), d);
                self.m.rels[r].name = new;
                self.rel_alias.insert(r, st);
            }
            // column renames are left out: parts of the model keep copies of column names
            1 if false => {
                let cands: Vec<usize> = (0..self.m.rels.len())
                    .filter(|&r| {
                        let rel = &self.m.rels[r];
                        // inherited / partition / typed columns cannot be renamed on the child
                        let sql = &self.stmts[rel.stmt].sql;
                        // inherited children are only visible from the parent's side, so skip any parent too
                        let has_child = self.stmts.iter().any(|x| x.deps.contains(&rel.stmt) && (x.sql.contains("INHERITS") || x.sql.contains("PARTITION OF")));
                        !has_child && matches!(rel.kind, RelKind::Table | RelKind::Partitioned)
                            && !rel.cols.is_empty()
                            && !rel.attached
                            && !rel.typed
                            && sql.starts_with("CREATE TABLE")
                            && !sql.contains("PARTITION OF")
                            && !sql.contains("INHERITS")
                    })
                    .collect();
                if cands.is_empty() {
                    return;
                }
                let r = cands[self.g.index(cands.len())];
                let c = self.g.index(self.m.rels[r].cols.len());
                let mut d = D::new();
                let q = self.rel_ref(r, &mut d);
                let cr = self.col_ref(r, c, &mut d);
                let new = self.fresh("rc");
                let ni = self.ident(&new);
                let st = self.push(format!("ALTER TABLE {q} RENAME COLUMN {cr} TO {ni}"), d);
                self.m.rels[r].cols[c].name = new;
                self.m.rels[r].cols[c].stmt = st;
            }
            2 if !self.m.funcs.is_empty() => {
                let f = self.g.index(self.m.funcs.len());
                let kw = if self.m.funcs[f].kind == FKind::Proc { "PROCEDURE" } else { "FUNCTION" };
                let mut d = D::new();
                let sig = self.func_sig(f, &mut d);
                let new = self.fresh("rf");
                let ni = self.ident(&new);
                let st = self.push(format!("ALTER {kw} {sig} RENAME TO {ni}"), d);
                self.m.funcs[f].name = new;
                self.m.funcs[f].stmt = st;
            }
            3 if !self.m.types.is_empty() => {
                let t = self.g.index(self.m.types.len());
                let kw = if matches!(self.m.types[t].kind, UKind::Domain(_)) { "DOMAIN" } else { "TYPE" };
                let mut d = D::new();
                let q = self.ty_name(&Ty::User(t), &mut d);
                let new = self.fresh("rt");
                let ni = self.ident(&new);
                let st = self.push(format!("ALTER {kw} {q} RENAME TO {ni}"), d);
                self.m.types[t].name = new;
                self.m.types[t].stmt = st;
            }
            4 if self.m.schemas.len() > 1 => {
                let sc = 1 + self.g.index(self.m.schemas.len() - 1);
                let mut d = D::new();
                let q = self.schema_ref(sc, &mut d);
                let new = self.fresh("rs");
                let ni = self.ident(&new);
                let st = self.push(format!("ALTER SCHEMA {q} RENAME TO {ni}"), d);
                self.m.schemas[sc].name = new;
                self.m.schemas[sc].stmt = Some(st);
            }
            _ => {}
        }
    }

    /// SET search_path, an unqualified CREATE TABLE that lands in that schema, RESET.
    fn gen_search_path(&mut self) {
        if self.m.schemas.len() < 2 {
            return;
        }
        let sc = 1 + self.g.index(self.m.schemas.len() - 1);
        let mut d = D::new();
        let q = self.schema_ref(sc, &mut d);
        let set = self.push(format!("SET search_path = {q}, public"), d);
        let name = self.fresh("sp");
        let ni = self.ident(&name);
        let st = self.push(format!("CREATE TABLE {ni} (c0 int)"), vec![set]);
        self.push("RESET search_path".to_string(), vec![st]);
        self.m.rels.push(Rel {
            schema: sc,
            name,
            kind: RelKind::Table,
            cols: vec![Col { name: "c0".into(), ty: Ty::Int, stmt: st, generated: false, ident: false }],
            pk: None,
            stmt: st,
            part_next: 0,
            has_default_part: false,
            frozen: false,
            pkey: None,
            typed: false,
            attached: false,
        });
    }

    /// Common statements pg-topo reports as UNKNOWN_STATEMENT_CLASS.
    fn gen_unknown_stmt(&mut self) {
        match self.g.index(5) {
            0 if !self.m.funcs.is_empty() => {
                let f = self.g.index(self.m.funcs.len());
                let kw = if self.m.funcs[f].kind == FKind::Proc { "PROCEDURE" } else { "FUNCTION" };
                let mut d = D::new();
                let sig = self.func_sig(f, &mut d);
                let opt = *self.g.pick(&["SET search_path = ''", "SET search_path = public, pg_temp", "SECURITY DEFINER", "COST 50"]);
                self.push(format!("ALTER {kw} {sig} {opt}"), d);
            }
            1 => {
                let enums: Vec<usize> = (0..self.m.types.len()).filter(|&t| matches!(self.m.types[t].kind, UKind::Enum(_))).collect();
                if enums.is_empty() {
                    return;
                }
                let t = enums[self.g.index(enums.len())];
                let mut d = D::new();
                let q = self.ty_name(&Ty::User(t), &mut d);
                self.n += 1;
                let n = self.n;
                self.push(format!("ALTER TYPE {q} ADD VALUE 'added{n}'"), d);
            }
            2 => {
                let cands: Vec<usize> = (0..self.m.rels.len())
                    .filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::Partitioned) && self.m.rels[r].cols.len() >= 2)
                    .collect();
                if cands.is_empty() {
                    return;
                }
                let r = cands[self.g.index(cands.len())];
                let mut d = D::new();
                let q = self.rel_ref(r, &mut d);
                let a = self.col_ref(r, 0, &mut d);
                let b = self.col_ref(r, 1, &mut d);
                let sc = self.m.rels[r].schema;
                let name = self.fresh("st");
                let sn = self.qname(sc, &name, &mut d);
                self.push(format!("CREATE STATISTICS {sn} ON {a}, {b} FROM {q}"), d);
            }
            3 => {
                let doms: Vec<usize> = (0..self.m.types.len()).filter(|&t| matches!(self.m.types[t].kind, UKind::Domain(_))).collect();
                if doms.is_empty() {
                    return;
                }
                let t = doms[self.g.index(doms.len())];
                let mut d = D::new();
                let q = self.ty_name(&Ty::User(t), &mut d);
                let c = self.fresh("dc");
                let ci = self.ident(&c);
                self.push(format!("ALTER DOMAIN {q} ADD CONSTRAINT {ci} CHECK (VALUE IS NOT NULL OR VALUE IS NULL)"), d);
            }
            4 if !self.m.policies.is_empty() => {
                let p = self.g.index(self.m.policies.len());
                let (pn, pst, r) = (self.m.policies[p].name.clone(), self.m.policies[p].stmt, self.m.policies[p].owner);
                let mut d = vec![pst];
                let q = self.rel_ref(r, &mut d);
                let pi = self.ident(&pn);
                self.push(format!("ALTER POLICY {pi} ON {q} USING (true)"), d);
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------- statement classes the schema kinds above do not reach

impl<'a> Gen<'a> {
    fn gen_misc_stmt(&mut self) {
        match self.g.index(6) {
            // top-level SELECT calling a user function
            0 => {
                let Some(f) = self.pick_func(|f| matches!(f.kind, FKind::Identity | FKind::Pred) && f.args.len() == 1) else { return };
                let ty = self.m.funcs[f].args[0].clone();
                let mut d = D::new();
                let a = self.lit(&ty, &mut d);
                let call = self.call(f, vec![a], &mut d);
                self.push(format!("SELECT {call}"), d);
            }
            // UPDATE that touches no row; the table needs a replica identity in case it is published
            1 if self.m.publications.is_empty() => {
                let cands: Vec<usize> = (0..self.m.rels.len())
                    .filter(|&r| self.m.rels[r].kind == RelKind::Table && self.m.rels[r].pk.is_some())
                    .collect();
                if cands.is_empty() {
                    return;
                }
                let r = cands[self.g.index(cands.len())];
                let cols: Vec<usize> = (0..self.m.rels[r].cols.len()).filter(|&c| !self.m.rels[r].cols[c].generated && !self.m.rels[r].cols[c].ident).collect();
                if cols.is_empty() {
                    return;
                }
                let c = cols[self.g.index(cols.len())];
                let mut d = D::new();
                let q = self.rel_ref(r, &mut d);
                let cr = self.col_ref(r, c, &mut d);
                self.push(format!("UPDATE {q} SET {cr} = {cr} WHERE false"), d);
                self.has_update = true;
            }
            // ALTER PUBLICATION ... SET TABLE
            2 => {
                if self.m.publications.is_empty() {
                    return;
                }
                let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| self.m.rels[r].kind == RelKind::Table).collect();
                if cands.is_empty() {
                    return;
                }
                let p = self.g.index(self.m.publications.len());
                let r = cands[self.g.index(cands.len())];
                let (pn, pst) = (self.m.publications[p].name.clone(), self.m.publications[p].stmt);
                let mut d = vec![pst];
                let q = self.rel_ref(r, &mut d);
                let pi = self.ident(&pn);
                self.push(format!("ALTER PUBLICATION {pi} SET TABLE {q}"), d);
            }
            // FDW and server (no handler: those need C functions)
            3 => {
                let w = self.fresh("fdw");
                let wi = self.ident(&w);
                let ws = self.push(format!("CREATE FOREIGN DATA WRAPPER {wi}"), vec![]);
                let sv = self.fresh("srv");
                let (wi2, si) = (self.ident(&w), self.ident(&sv));
                self.push(format!("CREATE SERVER {si} FOREIGN DATA WRAPPER {wi2}"), vec![ws]);
            }
            // DO block reading a table: pg-topo bug N10 (DO is hoisted to bootstrap)
            4 if !masked("do_block") => {
                let cands: Vec<usize> = (0..self.m.rels.len()).filter(|&r| matches!(self.m.rels[r].kind, RelKind::Table | RelKind::View)).collect();
                if cands.is_empty() {
                    return;
                }
                let r = cands[self.g.index(cands.len())];
                let mut d = D::new();
                let fq = self.force_qual;
                self.force_qual = true;
                let q = self.rel_ref(r, &mut d);
                self.force_qual = fq;
                self.push(format!("DO $$ BEGIN PERFORM 1 FROM {q}; END $$"), d);
            }
            // subscription: pg-topo bug N25 (requires a local publication)
            5 if !masked("subscription") => {
                let sb = self.fresh("sub");
                let si = self.ident(&sb);
                self.n += 1;
                let n = self.n;
                self.push(format!("CREATE SUBSCRIPTION {si} CONNECTION 'dbname=nowhere' PUBLICATION remote_pub{n} WITH (connect = false)"), vec![]);
            }
            _ => {}
        }
    }
}

