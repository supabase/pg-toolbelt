//! Model -> SQL. Every reference is resolved here; one that does not resolve
//! (or would make the statement invalid) is dropped rather than rendered.

use crate::model::*;
use std::fmt::Write;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum K {
    IntLike,
    Num,
    Text,
    Bool,
    Jsonb,
    Ts,
    Uuid,
    IntArr,
    TextArr,
    Enum,
    DomInt,
    DomText,
    DomNum,
    Composite,
}

struct R<'a> {
    db: &'a Db,
    out: String,
}

fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

impl<'a> R<'a> {
    fn schema_ok(&self, s: u8) -> bool {
        s == 0 || self.db.schemas.contains(&s)
    }
    fn tbl(&self, s: u8, n: u8) -> Option<&'a Table> {
        if !self.schema_ok(s) {
            return None;
        }
        self.db.table(s, n)
    }
    fn enum_(&self, n: u8) -> Option<&'a Enum> {
        self.db.enums.iter().find(|e| e.name == n && self.schema_ok(e.schema) && !e.labels.is_empty())
    }
    fn domain(&self, n: u8) -> Option<&'a Domain> {
        self.db.domains.iter().find(|d| d.name == n && self.schema_ok(d.schema))
    }
    fn composite(&self, n: u8) -> Option<&'a Composite> {
        self.db.composites.iter().find(|c| c.name == n && self.schema_ok(c.schema) && !c.attrs.is_empty())
    }
    fn seq(&self, n: u8) -> Option<&'a Seq> {
        self.db.seqs.iter().find(|x| x.name == n && self.schema_ok(x.schema))
    }
    fn func(&self, n: u8) -> Option<&'a Func> {
        self.db.funcs.iter().find(|f| f.name == n && self.schema_ok(f.schema))
    }
    fn pure_func(&self, n: u8, immutable: bool) -> Option<String> {
        let f = self.func(n)?;
        match f.body {
            FuncBody::PureSql(_) | FuncBody::PurePlpgsql(_) if !immutable || f.volatility == 0 => {
                Some(format!("{}.f{}", SCHEMAS[f.schema as usize], f.name))
            }
            _ => None,
        }
    }

    pub fn ty(&self, t: Ty) -> (String, K) {
        match t {
            Ty::Int => ("integer".into(), K::IntLike),
            Ty::BigInt => ("bigint".into(), K::IntLike),
            Ty::SmallInt => ("smallint".into(), K::IntLike),
            Ty::Text => ("text".into(), K::Text),
            Ty::Varchar(n) => (format!("character varying({})", n.max(1)), K::Text),
            Ty::Numeric(p, s) => {
                let p = p.clamp(2, 30);
                let s = s.min(p - 1);
                (format!("numeric({p},{s})"), K::Num)
            }
            Ty::Bool => ("boolean".into(), K::Bool),
            Ty::Jsonb => ("jsonb".into(), K::Jsonb),
            Ty::Timestamptz => ("timestamp with time zone".into(), K::Ts),
            Ty::Uuid => ("uuid".into(), K::Uuid),
            Ty::IntArr => ("integer[]".into(), K::IntArr),
            Ty::TextArr => ("text[]".into(), K::TextArr),
            Ty::Enum(n) => match self.enum_(n) {
                Some(e) => (format!("{}.e{}", SCHEMAS[e.schema as usize], e.name), K::Enum),
                None => ("text".into(), K::Text),
            },
            Ty::Composite(n) => match self.composite(n) {
                Some(c) => (format!("{}.c{}", SCHEMAS[c.schema as usize], c.name), K::Composite),
                None => ("text".into(), K::Text),
            },
            Ty::Domain(n) => match self.domain(n) {
                Some(d) => (
                    format!("{}.d{}", SCHEMAS[d.schema as usize], d.name),
                    match d.base {
                        0 => K::DomInt,
                        1 => K::DomText,
                        _ => K::DomNum,
                    },
                ),
                None => ("integer".into(), K::IntLike),
            },
        }
    }

    fn col(&self, t: &'a Table, c: u8) -> Option<&'a Column> {
        t.cols.iter().find(|x| x.name == c)
    }
    fn is_stored(c: &Column) -> bool {
        matches!(c.generated, Some(Generated::Stored { .. }))
    }
    /// The rendered generated clause, if valid.
    fn generated(&self, t: &Table, c: &Column) -> Option<String> {
        let (_, k) = self.ty(c.ty);
        match c.generated.as_ref()? {
            Generated::Identity { always } => {
                if matches!(c.ty, Ty::Int | Ty::BigInt | Ty::SmallInt) {
                    let opts = match c.ident_opts {
                        Some(k) => format!(" (START WITH {} INCREMENT BY {})", k as u32 + 1, 1 + k % 3),
                        None => String::new(),
                    };
                    Some(format!("GENERATED {} AS IDENTITY{opts}", if *always { "ALWAYS" } else { "BY DEFAULT" }))
                } else {
                    None
                }
            }
            Generated::Stored { from } => {
                if *from == c.name {
                    return None;
                }
                let src = self.col(t, *from)?;
                if src.generated.is_some() {
                    return None;
                }
                let (_, sk) = self.ty(src.ty);
                let expr = match (k, sk) {
                    (K::IntLike, K::IntLike) if matches!(c.ty, Ty::BigInt) || src.ty == Ty::SmallInt => format!("(c{} * 2)", from),
                    (K::Text, K::IntLike) | (K::Text, K::Text) if matches!(c.ty, Ty::Text) => format!("(c{}::text || '!')", from),
                    _ => return None,
                };
                Some(format!("GENERATED ALWAYS AS {expr} STORED"))
            }
        }
    }
    fn default(&self, c: &Column) -> Option<String> {
        let d = c.default.as_ref()?;
        let (ty, k) = self.ty(c.ty);
        let base = match k {
            K::DomInt => K::IntLike,
            K::DomText => K::Text,
            K::DomNum => K::Num,
            k => k,
        };
        Some(match (base, d) {
            (K::IntLike, Default::NextVal(n)) if matches!(c.ty, Ty::Int | Ty::BigInt) => match self.seq(*n) {
                Some(s) => format!("nextval('{}.q{}'::regclass)", SCHEMAS[s.schema as usize], s.name),
                None => "1".into(),
            },
            (K::IntLike | K::Num, Default::Const | Default::NextVal(_)) => "1".into(),
            // 42 does not fit numeric(p, s) with p - s < 2
            (K::IntLike | K::Num, Default::Alt) if !matches!(c.ty, Ty::Numeric(p, s) if p.clamp(2, 30) - s.min(p.clamp(2, 30) - 1) < 2) => "42".into(),
            (K::IntLike | K::Num, Default::Alt) => "1".into(),
            (K::IntLike | K::Num, Default::Func) => "abs(-7)".into(),
            // a default must fit varchar(n): ADD COLUMN evaluates it
            (K::Text, Default::Func) if !matches!(c.ty, Ty::Varchar(n) if n < 64) => "(CURRENT_USER)::text".into(),
            (K::Text, Default::Alt) if !matches!(c.ty, Ty::Varchar(n) if n < 4) => "'it''s'".into(),
            (K::Text, _) => "'x'".into(),
            (K::Bool, Default::Alt) => "false".into(),
            (K::Bool, Default::Func) => "(1 = 1)".into(),
            (K::Bool, _) => "true".into(),
            (K::Jsonb, Default::Alt) => "'[1]'::jsonb".into(),
            (K::Jsonb, Default::Func) => "jsonb_build_object('k', 1)".into(),
            (K::Jsonb, _) => "'{}'::jsonb".into(),
            (K::Ts, Default::Alt) => "'2020-01-01 00:00:00+00'::timestamp with time zone".into(),
            (K::Ts, Default::Func) => "CURRENT_TIMESTAMP".into(),
            (K::Ts, _) => "now()".into(),
            (K::Uuid, Default::Alt) => "'00000000-0000-0000-0000-000000000000'::uuid".into(),
            (K::Uuid, _) => "gen_random_uuid()".into(),
            (K::IntArr, Default::Alt) => "'{1,2}'::integer[]".into(),
            (K::IntArr, Default::Func) => "ARRAY[1]".into(),
            (K::IntArr, _) => "'{}'::integer[]".into(),
            (K::TextArr, Default::Alt) => "'{a}'::text[]".into(),
            (K::TextArr, Default::Func) => "ARRAY['x'::text]".into(),
            (K::TextArr, _) => "'{}'::text[]".into(),
            (K::Enum, d) => {
                let Ty::Enum(n) = c.ty else { unreachable!() };
                let e = self.enum_(n).unwrap();
                let l = if matches!(d, Default::Alt) { *e.labels.last().unwrap() } else { e.labels[0] };
                format!("'{}'::{ty}", LABELS[l as usize])
            }
            _ => return None,
        })
    }

    /// Columns usable in a key (exist, not stored-generated), deduplicated.
    fn key_cols(&self, t: &Table, cs: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for c in cs {
            if let Some(col) = self.col(t, *c) {
                if !Self::is_stored(col) && !out.contains(c) {
                    out.push(*c);
                }
            }
        }
        out
    }
    fn unique_on(&self, t: &Table, c: u8) -> bool {
        self.key_cols(t, &t.pk) == vec![c] || (!t.unique_deferrable && t.uniques.iter().any(|(_, u)| self.key_cols(t, u) == vec![c]))
    }

    fn rel(s: u8, prefix: char, n: u8) -> String {
        format!("{}.{prefix}{n}", SCHEMAS[s as usize])
    }

    fn check_expr(&self, t: &Table, ck: &Check) -> Option<String> {
        let col = self.col(t, ck.col)?;
        let (_, k) = self.ty(col.ty);
        let numeric = matches!(k, K::IntLike | K::Num | K::DomInt | K::DomNum);
        let fallback = format!("c{} IS NOT NULL", ck.col);
        Some(match &ck.kind {
            CheckKind::NotNull => fallback,
            CheckKind::Positive if numeric => format!("c{} > 0", ck.col),
            CheckKind::Positive if matches!(k, K::Text | K::DomText) => format!("length(c{}) > 0", ck.col),
            CheckKind::Positive => fallback,
            CheckKind::CallsFunc(f) => match self.pure_func(*f, false) {
                Some(fname) if k == K::IntLike && col.ty != Ty::BigInt => format!("{fname}(c{}) > '-1000000'::integer", ck.col),
                _ => fallback,
            },
            CheckKind::TwoCols(o) => match self.col(t, *o) {
                Some(oc) if *o != ck.col && numeric && matches!(self.ty(oc.ty).1, K::IntLike | K::Num) => {
                    format!("c{} <> c{}", ck.col, o)
                }
                _ => fallback,
            },
        })
    }

    fn privs(bits: u8, col_level: bool) -> String {
        let all = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
        let mut v: Vec<&str> = Vec::new();
        for (i, p) in all.iter().enumerate() {
            if bits & (1 << i) != 0 && (!col_level || matches!(*p, "SELECT" | "INSERT" | "UPDATE" | "REFERENCES")) {
                v.push(p);
            }
        }
        if v.is_empty() {
            v.push("SELECT");
        }
        v.join(", ")
    }

    fn view_outputs(&self, v: &View, done: &[(u8, u8, Vec<String>)]) -> Option<(String, Vec<String>, Vec<(String, K)>)> {
        // (from clause, selected cols, source col kinds)
        let (from, src_cols): (String, Vec<(String, K)>) = match &v.src {
            ViewSrc::Table(s, n) => {
                let t = self.tbl(*s, *n)?;
                (Self::rel(*s, 't', *n), t.cols.iter().map(|c| (format!("c{}", c.name), self.ty(c.ty).1)).collect())
            }
            ViewSrc::View(s, n) => {
                let (_, _, outs) = done.iter().find(|(ds, dn, _)| ds == s && dn == n)?;
                (Self::rel(*s, 'v', *n), outs.iter().map(|o| (o.clone(), K::Text)).collect())
            }
        };
        if src_cols.is_empty() {
            return None;
        }
        let mut sel: Vec<String> = Vec::new();
        for c in &v.cols {
            let name = format!("c{c}");
            if src_cols.iter().any(|(n, _)| *n == name) && !sel.contains(&name) {
                sel.push(name);
            }
        }
        if sel.is_empty() {
            sel.push(src_cols[0].0.clone());
        }
        Some((from, sel, src_cols))
    }

    fn render(&mut self) {
        let db = self.db;
        let mut o = String::new();
        for s in &db.schemas {
            if *s != 0 {
                let _ = writeln!(o, "CREATE SCHEMA {};", SCHEMAS[*s as usize]);
            }
        }
        for (s, c) in &db.schema_comments {
            if self.schema_ok(*s) {
                let _ = writeln!(o, "COMMENT ON SCHEMA {} IS {};", SCHEMAS[*s as usize], q(COMMENTS[*c as usize]));
            }
        }
        for e in &db.enums {
            if self.enum_(e.name).map(|x| std::ptr::eq(x, e)).unwrap_or(false) {
                let labels: Vec<String> = e.labels.iter().map(|l| q(LABELS[*l as usize])).collect();
                let _ = writeln!(o, "CREATE TYPE {} AS ENUM ({});", Self::rel(e.schema, 'e', e.name), labels.join(", "));
            }
        }
        for c in &db.composites {
            if self.composite(c.name).map(|x| std::ptr::eq(x, c)).unwrap_or(false) {
                let mut seen = Vec::new();
                let mut attrs = Vec::new();
                for (a, t) in &c.attrs {
                    if !seen.contains(a) {
                        seen.push(*a);
                        attrs.push(format!("a{a} {}", ["integer", "text", "boolean"][*t as usize % 3]));
                    }
                }
                let _ = writeln!(o, "CREATE TYPE {} AS ({});", Self::rel(c.schema, 'c', c.name), attrs.join(", "));
            }
        }
        for d in &db.domains {
            if self.domain(d.name).map(|x| std::ptr::eq(x, d)).unwrap_or(false) {
                let (base, ck, def) = match d.base {
                    0 => ("integer", "VALUE > '-100'::integer", "5"),
                    1 => ("text", "length(VALUE) < 100", "'d'::text"),
                    _ => ("numeric(10,2)", "VALUE <> 13.0", "2.5"),
                };
                let _ = write!(o, "CREATE DOMAIN {} AS {base}", Self::rel(d.schema, 'd', d.name));
                if d.default {
                    let _ = write!(o, " DEFAULT {def}");
                }
                if d.not_null {
                    let _ = write!(o, " NOT NULL");
                }
                if d.check {
                    let _ = write!(o, " CONSTRAINT d{}_check CHECK ({ck})", d.name);
                }
                let _ = writeln!(o, ";");
            }
        }
        for s in &db.seqs {
            if self.seq(s.name).map(|x| std::ptr::eq(x, s)).unwrap_or(false) {
                let inc = if s.increment == 0 { 1 } else { s.increment as i32 };
                let _ = write!(o, "CREATE SEQUENCE {} AS {} INCREMENT BY {inc}", Self::rel(s.schema, 'q', s.name), ["bigint", "integer", "smallint"][s.as_type as usize % 3]);
                if let (true, Some(m)) = (inc > 0, s.max) {
                    let _ = write!(o, " MAXVALUE {}", 200 + (m as u32 % 30000));
                }
                if inc > 0 {
                    let _ = write!(o, " START WITH {}", s.start as u32 + 1);
                }
                if s.cycle {
                    let _ = write!(o, " CYCLE");
                }
                let _ = writeln!(o, ";");
            }
        }
        let live_funcs: Vec<&Func> = db.funcs.iter().filter(|f| self.func(f.name).map(|x| std::ptr::eq(x, *f)).unwrap_or(false)).collect();
        let func_head = |f: &Func| -> String {
            let vol = ["IMMUTABLE", "STABLE", "VOLATILE"][f.volatility as usize % 3];
            let mut s = format!("{vol}");
            if f.strict {
                s += " STRICT";
            }
            if f.security_definer {
                s += " SECURITY DEFINER";
            }
            if f.search_path {
                s += " SET search_path TO 'pg_catalog'";
            }
            s
        };
        for f in &live_funcs {
            let name = Self::rel(f.schema, 'f', f.name);
            match f.body {
                FuncBody::PureSql(k) => {
                    let _ = writeln!(o, "CREATE FUNCTION {name}(x integer) RETURNS integer LANGUAGE sql {} AS $$ SELECT x + {k} $$;", func_head(f));
                }
                FuncBody::PurePlpgsql(k) => {
                    let _ = writeln!(o, "CREATE FUNCTION {name}(x integer) RETURNS integer LANGUAGE plpgsql {} AS $$ BEGIN RETURN x + {k}; END $$;", func_head(f));
                }
                FuncBody::Trigger(k) => {
                    let body = if k % 2 == 0 { "RETURN COALESCE(NEW, OLD);" } else { "RAISE NOTICE 'trig'; RETURN COALESCE(NEW, OLD);" };
                    let _ = writeln!(o, "CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql {} AS $$ BEGIN {body} END $$;", func_head(f));
                }
                FuncBody::Atomic(..) => {}
            }
        }
        // tables
        let tables: Vec<&Table> = db.tables.iter().filter(|t| self.tbl(t.schema, t.name).map(|x| std::ptr::eq(x, *t)).unwrap_or(false)).collect();
        for t in &tables {
            let mut parts: Vec<String> = Vec::new();
            let mut seen = Vec::new();
            for c in &t.cols {
                if seen.contains(&c.name) {
                    continue;
                }
                seen.push(c.name);
                let (ty, k) = self.ty(c.ty);
                let mut s = format!("c{} {ty}", c.name);
                if c.collate_c && matches!(k, K::Text) {
                    s += " COLLATE \"C\"";
                }
                let gen = self.generated(t, c);
                match &gen {
                    Some(g) => {
                        s += " ";
                        s += g;
                    }
                    None => {
                        if let Some(d) = self.default(c) {
                            s += " DEFAULT ";
                            s += &d;
                        }
                    }
                }
                if c.not_null {
                    s += " NOT NULL";
                }
                parts.push(s);
            }
            let pk = self.key_cols(t, &t.pk);
            if !pk.is_empty() {
                parts.push(format!("CONSTRAINT t{}_pkey PRIMARY KEY ({})", t.name, pk.iter().map(|c| format!("c{c}")).collect::<Vec<_>>().join(", ")));
            }
            let mut names = Vec::new();
            for (n, u) in &t.uniques {
                let u = self.key_cols(t, u);
                if u.is_empty() || names.contains(n) {
                    continue;
                }
                names.push(*n);
                parts.push(format!(
                    "CONSTRAINT t{}_u{n} UNIQUE ({}){}",
                    t.name,
                    u.iter().map(|c| format!("c{c}")).collect::<Vec<_>>().join(", "),
                    if t.unique_deferrable { " DEFERRABLE INITIALLY DEFERRED" } else { "" }
                ));
            }
            let mut names = Vec::new();
            for ck in &t.checks {
                if names.contains(&ck.name) {
                    continue;
                }
                if let Some(e) = self.check_expr(t, ck) {
                    names.push(ck.name);
                    parts.push(format!("CONSTRAINT t{}_ck{} CHECK ({e}){}", t.name, ck.name, if ck.no_inherit { " NO INHERIT" } else { "" }));
                }
            }
            let mut with = String::new();
            if let Some(ff) = t.fillfactor {
                with = format!(" WITH (fillfactor='{}')", 50 + ff % 51);
            }
            let _ = writeln!(
                o,
                "CREATE {}TABLE {} ({}){with};",
                if t.unlogged { "UNLOGGED " } else { "" },
                Self::rel(t.schema, 't', t.name),
                parts.join(", ")
            );
        }
        for t in &tables {
            let tn = Self::rel(t.schema, 't', t.name);
            let mut seen = Vec::new();
            for c in &t.cols {
                if seen.contains(&c.name) {
                    continue;
                }
                seen.push(c.name);
                let (_, k) = self.ty(c.ty);
                if let Some(st) = c.storage {
                    if matches!(k, K::Text | K::Num | K::Jsonb | K::IntArr | K::TextArr | K::DomText | K::DomNum | K::Composite) {
                        let _ = writeln!(o, "ALTER TABLE {tn} ALTER COLUMN c{} SET STORAGE {};", c.name, ["EXTERNAL", "MAIN", "EXTENDED"][st as usize % 3]);
                    }
                }
                if let Some(n) = c.stats_target {
                    let _ = writeln!(o, "ALTER TABLE {tn} ALTER COLUMN c{} SET STATISTICS {};", c.name, n % 2000);
                }
            }
            let mut names = Vec::new();
            for (n, cs) in &t.stats {
                let mut cols: Vec<u8> = Vec::new();
                for c in cs {
                    if self.col(t, *c).is_some() && !cols.contains(c) {
                        cols.push(*c);
                    }
                }
                if cols.len() < 2 || names.contains(n) {
                    continue;
                }
                names.push(*n);
                let _ = writeln!(
                    o,
                    "CREATE STATISTICS {}.t{}_st{n} ON {} FROM {tn};",
                    SCHEMAS[t.schema as usize],
                    t.name,
                    cols.iter().map(|c| format!("c{c}")).collect::<Vec<_>>().join(", ")
                );
            }
        }
        // foreign keys
        for t in &tables {
            let mut names = Vec::new();
            for fk in &t.fks {
                if names.contains(&fk.name) {
                    continue;
                }
                let Some(col) = self.col(t, fk.col) else { continue };
                if Self::is_stored(col) {
                    continue;
                }
                let Some(tt) = self.tbl(fk.target.0, fk.target.1) else { continue };
                let Some(tc) = self.col(tt, fk.target_col) else { continue };
                if self.ty(col.ty).0 != self.ty(tc.ty).0 || !self.unique_on(tt, fk.target_col) {
                    continue;
                }
                if !t.unlogged && tt.unlogged {
                    continue;
                }
                // SET NULL / SET DEFAULT cannot touch a generated column
                let action = ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT", "SET DEFAULT"][fk.on_delete as usize % 5];
                let action = if col.generated.is_some() && action.starts_with("SET") { "NO ACTION" } else { action };
                names.push(fk.name);
                let _ = writeln!(
                    o,
                    "ALTER TABLE {} ADD CONSTRAINT t{}_fk{} FOREIGN KEY (c{}) REFERENCES {}(c{}) ON DELETE {action}{}{};",
                    Self::rel(t.schema, 't', t.name),
                    t.name,
                    fk.name,
                    fk.col,
                    Self::rel(fk.target.0, 't', fk.target.1),
                    fk.target_col,
                    if fk.deferrable { " DEFERRABLE INITIALLY DEFERRED" } else { "" },
                    if fk.not_valid { " NOT VALID" } else { "" },
                );
            }
        }
        for s in &db.seqs {
            if !self.seq(s.name).map(|x| std::ptr::eq(x, s)).unwrap_or(false) {
                continue;
            }
            if let Some((ts, tn, tc)) = s.owned_by {
                if ts == s.schema {
                    if let Some(t) = self.tbl(ts, tn) {
                        if self.col(t, tc).is_some() {
                            let _ = writeln!(o, "ALTER SEQUENCE {} OWNED BY {}.c{tc};", Self::rel(s.schema, 'q', s.name), Self::rel(ts, 't', tn));
                        }
                    }
                }
            }
        }
        for f in &live_funcs {
            if let FuncBody::Atomic(s, n) = f.body {
                if self.tbl(s, n).is_some() {
                    let _ = writeln!(
                        o,
                        "CREATE FUNCTION {}() RETURNS bigint LANGUAGE sql {}\nBEGIN ATOMIC\n SELECT count(*) AS count FROM {};\nEND;",
                        Self::rel(f.schema, 'f', f.name),
                        func_head(f),
                        Self::rel(s, 't', n)
                    );
                }
            }
        }
        // indexes
        for t in &tables {
            let mut names = Vec::new();
            for ix in &t.indexes {
                if names.contains(&ix.name) {
                    continue;
                }
                let mut keys = Vec::new();
                for k in &ix.keys {
                    let s = match k {
                        IndexKey::Col(c) => self.col(t, *c).map(|_| format!("c{c}")),
                        IndexKey::Lower(c) => self.col(t, *c).filter(|col| self.ty(col.ty).1 == K::Text).map(|_| format!("lower(c{c})")),
                        IndexKey::Func(f, c) => match (self.pure_func(*f, true), self.col(t, *c)) {
                            (Some(fname), Some(col)) if col.ty == Ty::Int => Some(format!("{fname}(c{c})")),
                            _ => None,
                        },
                    };
                    if let Some(s) = s {
                        if !keys.contains(&s) {
                            keys.push(s);
                        }
                    }
                }
                if keys.is_empty() {
                    continue;
                }
                if ix.desc {
                    keys[0] += " DESC";
                }
                names.push(ix.name);
                let mut s = format!(
                    "CREATE {}INDEX t{}_i{} ON {} ({})",
                    if ix.unique { "UNIQUE " } else { "" },
                    t.name,
                    ix.name,
                    Self::rel(t.schema, 't', t.name),
                    keys.join(", ")
                );
                if let Some(c) = ix.include {
                    if self.col(t, c).is_some() && !keys.iter().any(|k| k == &format!("c{c}") || k == &format!("c{c} DESC")) {
                        s += &format!(" INCLUDE (c{c})");
                    }
                }
                if let Some(c) = ix.partial {
                    if self.col(t, c).is_some() {
                        s += &format!(" WHERE (c{c} IS NOT NULL)");
                    }
                }
                let _ = writeln!(o, "{s};");
            }
        }
        // views
        let mut done: Vec<(u8, u8, Vec<String>)> = Vec::new();
        for v in &db.views {
            if !self.schema_ok(v.schema) || done.iter().any(|(s, n, _)| *s == v.schema && *n == v.name) {
                continue;
            }
            if db.views.iter().find(|x| x.schema == v.schema && x.name == v.name).map(|x| !std::ptr::eq(x, v)).unwrap_or(true) {
                continue;
            }
            let Some((from, mut sel, src)) = self.view_outputs(v, &done) else { continue };
            let mut select = sel.clone();
            if let Some(f) = v.calls_func {
                if let Some(fname) = self.pure_func(f, false) {
                    select.push(format!("{fname}(1) AS fx"));
                    sel.push("fx".into());
                }
            }
            let mut s = format!(
                "CREATE {}VIEW {}{} AS SELECT {} FROM {}",
                if v.materialized { "MATERIALIZED " } else { "" },
                Self::rel(v.schema, 'v', v.name),
                if v.security_barrier && !v.materialized { " WITH (security_barrier='true')" } else { "" },
                select.join(", "),
                from
            );
            if let Some(c) = v.filter {
                let name = format!("c{c}");
                if let Some((_, k)) = src.iter().find(|(n, _)| *n == name) {
                    if *k == K::IntLike {
                        s += &format!(" WHERE {name} > 0");
                    } else {
                        s += &format!(" WHERE {name} IS NOT NULL");
                    }
                }
            }
            let _ = writeln!(o, "{s};");
            if let (true, Some(c)) = (v.materialized, v.mv_index) {
                let name = format!("c{c}");
                if sel.contains(&name) {
                    let _ = writeln!(o, "CREATE INDEX v{}_mi ON {} ({name});", v.name, Self::rel(v.schema, 'v', v.name));
                }
            }
            let kind = if v.materialized { "MATERIALIZED VIEW" } else { "VIEW" };
            if let Some(c) = v.comment {
                let _ = writeln!(o, "COMMENT ON {kind} {} IS {};", Self::rel(v.schema, 'v', v.name), q(COMMENTS[c as usize]));
            }
            for g in &v.grants {
                let _ = writeln!(o, "GRANT {} ON {} TO {};", Self::privs(g.privs & 1, false), Self::rel(v.schema, 'v', v.name), ROLES[g.role as usize]);
            }
            done.push((v.schema, v.name, sel));
        }
        // triggers, rls, policies, comments, grants
        for t in &tables {
            let tn = Self::rel(t.schema, 't', t.name);
            let mut names = Vec::new();
            for tr in &t.triggers {
                if names.contains(&tr.name) {
                    continue;
                }
                let Some(f) = self.func(tr.func) else { continue };
                if !matches!(f.body, FuncBody::Trigger(_)) {
                    continue;
                }
                names.push(tr.name);
                let mut ev = Vec::new();
                if tr.events & 1 != 0 || tr.events & 7 == 0 {
                    ev.push("INSERT");
                }
                let mut update = "UPDATE".to_string();
                if let Some(c) = tr.of_col {
                    if self.col(t, c).map(|col| !Self::is_stored(col)).unwrap_or(false) {
                        update = format!("UPDATE OF c{c}");
                    }
                }
                if tr.events & 2 != 0 {
                    ev.push(&update);
                }
                if tr.events & 4 != 0 {
                    ev.push("DELETE");
                }
                let when = match tr.when_col {
                    _ if tr.statement => String::new(),
                    Some(c) if !ev.contains(&"DELETE") && self.col(t, c).is_some() && !(tr.before && self.col(t, c).map(Self::is_stored).unwrap_or(false)) => {
                        format!(" WHEN ((new.c{c} IS NOT NULL))")
                    }
                    _ => String::new(),
                };
                let _ = writeln!(
                    o,
                    "CREATE TRIGGER t{}_tr{} {} {} ON {tn} FOR EACH {}{when} EXECUTE FUNCTION {}();",
                    t.name,
                    tr.name,
                    if tr.before { "BEFORE" } else { "AFTER" },
                    ev.join(" OR "),
                    if tr.statement { "STATEMENT" } else { "ROW" },
                    Self::rel(f.schema, 'f', f.name)
                );
                if tr.disabled {
                    let _ = writeln!(o, "ALTER TABLE {tn} DISABLE TRIGGER t{}_tr{};", t.name, tr.name);
                }
            }
            if t.rls >= 1 {
                let _ = writeln!(o, "ALTER TABLE {tn} ENABLE ROW LEVEL SECURITY;");
            }
            if t.rls >= 2 {
                let _ = writeln!(o, "ALTER TABLE {tn} FORCE ROW LEVEL SECURITY;");
            }
            let mut names = Vec::new();
            for p in &t.policies {
                if names.contains(&p.name) {
                    continue;
                }
                names.push(p.name);
                let cmd = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"][p.cmd as usize % 5];
                let expr = match p.using_col {
                    Some(c) if self.col(t, c).is_some() => format!("(c{c} IS NOT NULL)"),
                    _ => "true".into(),
                };
                let clause = if cmd == "INSERT" { format!("WITH CHECK ({expr})") } else { format!("USING ({expr})") };
                let _ = writeln!(
                    o,
                    "CREATE POLICY p{} ON {tn} AS {} FOR {cmd} TO {} {clause};",
                    p.name,
                    if p.permissive { "PERMISSIVE" } else { "RESTRICTIVE" },
                    ROLES[p.to_role as usize % ROLES.len()].to_lowercase().replace("public", "PUBLIC")
                );
            }
            if t.replica_full {
                let _ = writeln!(o, "ALTER TABLE {tn} REPLICA IDENTITY FULL;");
            }
            if let Some(c) = t.comment {
                let _ = writeln!(o, "COMMENT ON TABLE {tn} IS {};", q(COMMENTS[c as usize]));
            }
            let mut seen = Vec::new();
            for c in &t.cols {
                if seen.contains(&c.name) {
                    continue;
                }
                seen.push(c.name);
                if let Some(cm) = c.comment {
                    let _ = writeln!(o, "COMMENT ON COLUMN {tn}.c{} IS {};", c.name, q(COMMENTS[cm as usize]));
                }
            }
            for g in &t.grants {
                match g.col {
                    Some(c) if self.col(t, c).is_some() => {
                        let _ = writeln!(o, "GRANT {} (c{c}) ON {tn} TO {};", Self::privs(g.privs, true), ROLES[g.role as usize]);
                    }
                    Some(_) => {}
                    None => {
                        let _ = writeln!(o, "GRANT {} ON {tn} TO {};", Self::privs(g.privs, false), ROLES[g.role as usize]);
                    }
                }
            }
        }
        for f in &live_funcs {
            let rendered = match f.body {
                FuncBody::Atomic(s, n) => self.tbl(s, n).is_some(),
                _ => true,
            };
            if !rendered {
                continue;
            }
            let sig = match f.body {
                FuncBody::PureSql(_) | FuncBody::PurePlpgsql(_) => format!("{}(integer)", Self::rel(f.schema, 'f', f.name)),
                _ => format!("{}()", Self::rel(f.schema, 'f', f.name)),
            };
            if f.revoke_public {
                let _ = writeln!(o, "REVOKE ALL ON FUNCTION {sig} FROM PUBLIC;");
            }
            if let Some(c) = f.comment {
                let _ = writeln!(o, "COMMENT ON FUNCTION {sig} IS {};", q(COMMENTS[c as usize]));
            }
        }
        self.out = o;
    }
}

pub fn render(db: &Db) -> String {
    let mut r = R { db, out: String::new() };
    r.render();
    r.out
}
