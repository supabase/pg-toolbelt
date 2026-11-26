//! A second generator for what `gen` leaves out: declarative partitioning,
//! table inheritance, ownership, privileges and default privileges, and (the
//! Supabase flavor) the objects a Supabase project's own schema holds:
//! policies on `anon`/`authenticated` calling `auth.uid()`, grants to the API
//! roles, `supabase_realtime` publication membership, `extensions.*` defaults.
//!
//! Same rule as `model`/`render`: every relation is a name-keyed `Table`, and
//! the renderer drops any reference that does not resolve or that Postgres
//! would reject (a partition of a non-partitioned table, a second DEFAULT
//! partition, inheriting from a partitioned table, ...), so every value,
//! including every shrink candidate, renders to SQL that loads.

use ephyra::Source;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flavor {
    Stock,
    Supabase,
}

/// Roles grants and policies name. Index 3 is PUBLIC.
pub fn roles(f: Flavor) -> [&'static str; 4] {
    match f {
        Flavor::Stock => ["eph_owner", "eph_reader", "eph_writer", "PUBLIC"],
        Flavor::Supabase => ["anon", "authenticated", "service_role", "PUBLIC"],
    }
}

/// Owners an object can be given; 0 keeps the loading role. In a Supabase
/// project the user is `postgres`, which cannot give objects to the API roles
/// in `public` (no CREATE there), so the Supabase flavor keeps 0 only.
fn owner_name(f: Flavor, o: u8) -> Option<&'static str> {
    match (f, o) {
        (Flavor::Stock, 1) => Some("eph_owner"),
        (Flavor::Stock, 2) => Some("eph_writer"),
        _ => None,
    }
}

const SCHEMAS: [&str; 2] = ["public", "app"];
const NT: u8 = 7; // relation names per schema
const NC: u8 = 4; // extra column names
/// partition key on the `id` column
const ID: u8 = 255;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    Range,
    List,
    Hash,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Col {
    pub name: u8,
    /// 0 integer, 1 bigint, 2 text, 3 date, 4 numeric(10,2)
    pub ty: u8,
    pub not_null: bool,
    pub default: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PartOf {
    pub parent: u8,
    /// which bound: range/list value slot, hash remainder
    pub slot: u8,
    pub default: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub role: u8,
    /// bitmask: 1 SELECT, 2 INSERT, 4 UPDATE, 8 DELETE
    pub privs: u8,
    pub col: Option<u8>,
    pub with_grant: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub schema: u8,
    pub name: u8,
    /// `id bigint NOT NULL` always comes first and is not listed here
    pub cols: Vec<Col>,
    pub partitioned: Option<(Strategy, u8)>,
    pub part_of: Option<PartOf>,
    pub inherits: Vec<u8>,
    pub pk: bool,
    pub index: Option<u8>,
    pub unique: Option<u8>,
    /// (column, NO INHERIT)
    pub check: Option<(u8, bool)>,
    /// FK to another table's key, by name
    pub fk: Option<u8>,
    pub trigger: bool,
    pub rls: bool,
    /// (role, USING reads auth.uid() in the Supabase flavor)
    pub policy: Option<(u8, bool)>,
    pub owner: u8,
    pub grants: Vec<Grant>,
    pub comment: bool,
    pub realtime: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub schema: u8,
    pub name: u8,
    pub src: u8,
    pub owner: u8,
    pub grants: Vec<Grant>,
    pub security_invoker: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Seq {
    pub schema: u8,
    pub name: u8,
    pub owner: u8,
    /// (role, 1 USAGE / 2 SELECT / 4 UPDATE)
    pub grants: Vec<(u8, u8)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Func {
    pub schema: u8,
    pub name: u8,
    pub owner: u8,
    pub security_definer: bool,
    pub revoke_public: bool,
    pub execute: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DefPriv {
    /// FOR ROLE: 0 the loading role, else owner index
    pub for_owner: u8,
    pub schema: Option<u8>,
    /// 0 TABLES, 1 SEQUENCES, 2 FUNCTIONS
    pub objtype: u8,
    pub role: u8,
    pub revoke: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Db {
    pub flavor: Flavor,
    /// owner of schema `app`, and roles granted USAGE on it
    pub app_owner: u8,
    pub app_usage: Vec<u8>,
    pub tables: Vec<Table>,
    pub views: Vec<View>,
    pub seqs: Vec<Seq>,
    pub funcs: Vec<Func>,
    pub defprivs: Vec<DefPriv>,
    /// default privileges set before (true) or after the objects are created
    pub defprivs_first: bool,
    /// a child may redeclare the columns it inherits (merged columns); off
    /// for the declarative property, where every merge hits one known bug
    pub merge: bool,
}

impl Db {
    pub fn size(&self) -> u64 {
        let g = |v: &Vec<Grant>| v.iter().map(|g| 1 + g.col.is_some() as u64 + g.with_grant as u64).sum::<u64>();
        self.tables
            .iter()
            .map(|t| {
                2 + t.cols.iter().map(|c| 1 + c.not_null as u64 + c.default as u64 + (c.ty != 0) as u64).sum::<u64>()
                    + t.partitioned.is_some() as u64 * 2
                    + t.part_of.as_ref().map_or(0, |p| 2 + p.default as u64 + (p.slot != 0) as u64)
                    + t.inherits.len() as u64 * 2
                    + t.pk as u64
                    + t.index.is_some() as u64
                    + t.unique.is_some() as u64
                    + t.check.map_or(0, |c| 1 + c.1 as u64)
                    + t.fk.is_some() as u64
                    + t.trigger as u64
                    + t.rls as u64
                    + t.policy.map_or(0, |p| 1 + p.1 as u64)
                    + (t.owner != 0) as u64
                    + g(&t.grants)
                    + t.comment as u64
                    + t.realtime as u64
            })
            .sum::<u64>()
            + self.views.iter().map(|v| 2 + (v.owner != 0) as u64 + g(&v.grants) + v.security_invoker as u64).sum::<u64>()
            + self.seqs.iter().map(|s| 1 + (s.owner != 0) as u64 + s.grants.len() as u64).sum::<u64>()
            + self.funcs.iter().map(|f| 1 + (f.owner != 0) as u64 + f.security_definer as u64 + f.revoke_public as u64 + f.execute.len() as u64).sum::<u64>()
            + self.defprivs.iter().map(|d| 1 + d.schema.is_some() as u64 + (d.for_owner != 0) as u64 + d.revoke as u64).sum::<u64>()
            + (self.app_owner != 0) as u64
            + self.app_usage.len() as u64
    }
}

// ------------------------------------------------------------------ render

fn tname(n: u8) -> String {
    format!("t{n}")
}
fn cname(n: u8) -> String {
    format!("c{n}")
}
fn rel(s: u8, n: &str) -> String {
    format!("{}.{n}", SCHEMAS[s as usize])
}
fn tyname(t: u8) -> &'static str {
    ["integer", "bigint", "text", "date", "numeric(10,2)"][t as usize]
}
fn lit(t: u8, v: u32) -> String {
    match t {
        0 | 1 | 4 => format!("{v}"),
        2 => format!("'v{v:03}'"),
        _ => format!("'{}-01-01'", 2000 + v),
    }
}
fn role_sql(f: Flavor, r: u8) -> &'static str {
    roles(f)[r as usize % 4]
}
fn privs_sql(p: u8) -> Vec<&'static str> {
    [(1, "SELECT"), (2, "INSERT"), (4, "UPDATE"), (8, "DELETE")].iter().filter(|(b, _)| p & b != 0).map(|(_, s)| *s).collect()
}

/// A relation as the renderer will emit it, after dropping invalid parts.
struct Resolved<'a> {
    t: &'a Table,
    /// columns, `id` first: (name, type, not null, default)
    cols: Vec<(String, u8, bool, bool)>,
    partitioned: Option<(Strategy, String, u8)>,
    part_of: Option<(String, String)>,
    inherits: Vec<String>,
}

fn resolve(d: &Db) -> Vec<Resolved<'_>> {
    // last definition of a name wins; earlier duplicates are dropped
    let mut by: BTreeMap<(u8, u8), &Table> = BTreeMap::new();
    for t in &d.tables {
        by.insert((t.schema, t.name), t);
    }
    // a table is a valid partition when its parent is partitioned and itself
    // a valid relation; walk to a fixpoint in dependency order
    let mut out: Vec<Resolved> = Vec::new();
    let mut done: BTreeMap<(u8, u8), usize> = BTreeMap::new();
    let mut used_slots: BTreeSet<(u8, u8, u8)> = BTreeSet::new();
    let mut has_default: BTreeSet<(u8, u8)> = BTreeSet::new();
    let mut pending: Vec<&Table> = by.values().copied().collect();
    loop {
        let mut progressed = false;
        let mut rest = Vec::new();
        for t in pending {
            let ready = t.part_of.as_ref().map_or(true, |p| !by.contains_key(&(t.schema, p.parent)) || done.contains_key(&(t.schema, p.parent)))
                && t.inherits.iter().all(|p| !by.contains_key(&(t.schema, *p)) || done.contains_key(&(t.schema, *p)));
            if !ready {
                rest.push(t);
                continue;
            }
            progressed = true;
            let mut r = Resolved { t, cols: vec![("id".into(), 1, true, false)], partitioned: None, part_of: None, inherits: vec![] };
            // partition: columns come from the parent
            if let Some(p) = &t.part_of {
                if let Some(&pi) = done.get(&(t.schema, p.parent)) {
                    if let Some((strat, _, kty)) = out[pi].partitioned.clone() {
                        let ok = if p.default {
                            strat != Strategy::Hash && has_default.insert((t.schema, p.parent))
                        } else {
                            used_slots.insert((t.schema, p.parent, p.slot % 4))
                        };
                        if ok {
                            let s = p.slot as u32 % 4;
                            let bound = if p.default {
                                "DEFAULT".to_string()
                            } else {
                                match strat {
                                    Strategy::Range => format!("FOR VALUES FROM ({}) TO ({})", lit(kty, s * 100), lit(kty, s * 100 + 100)),
                                    Strategy::List => format!("FOR VALUES IN ({}, {})", lit(kty, s * 10), lit(kty, s * 10 + 1)),
                                    Strategy::Hash => format!("FOR VALUES WITH (MODULUS 4, REMAINDER {s})"),
                                }
                            };
                            r.cols = out[pi].cols.clone();
                            r.part_of = Some((rel(t.schema, &tname(p.parent)), bound));
                        }
                    }
                }
            }
            if r.part_of.is_none() {
                let mut seen: BTreeMap<String, u8> = BTreeMap::new();
                seen.insert("id".into(), 1);
                for p in &t.inherits {
                    let Some(&pi) = done.get(&(t.schema, *p)) else { continue };
                    let parent = &out[pi];
                    // only plain tables can be inheritance parents
                    if parent.partitioned.is_some() || parent.part_of.is_some() {
                        continue;
                    }
                    // a parent whose columns clash in type with what is merged so far is skipped
                    if parent.cols.iter().any(|(n, ty, _, _)| seen.get(n).is_some_and(|s| s != ty)) {
                        continue;
                    }
                    for (n, ty, _, _) in &parent.cols {
                        seen.insert(n.clone(), *ty);
                    }
                    r.inherits.push(rel(t.schema, &tname(*p)));
                }
                let mut names = BTreeSet::new();
                // inherited columns, so grandchildren see them
                for p in &r.inherits {
                    let pi = out.iter().position(|x| rel(x.t.schema, &tname(x.t.name)) == *p).unwrap();
                    for c in out[pi].cols.clone() {
                        if !r.cols.iter().any(|x| x.0 == c.0) {
                            r.cols.push(c);
                        }
                    }
                }
                for c in &t.cols {
                    let n = cname(c.name);
                    if seen.get(&n).is_some_and(|ty| *ty != c.ty) || !names.insert(n.clone()) {
                        continue;
                    }
                    if let Some(x) = r.cols.iter_mut().find(|x| x.0 == n) {
                        *x = (n, c.ty, c.not_null || x.2, c.default);
                    } else {
                        r.cols.push((n, c.ty, c.not_null, c.default));
                    }
                }
            }
            if r.inherits.is_empty() {
                if let Some((s, k)) = t.partitioned {
                    // a sub-partition is keyed on `id`, which every parent key contains
                    let kn = if r.part_of.is_some() || k == ID { "id".to_string() } else { cname(k) };
                    if let Some(c) = r.cols.iter().find(|c| c.0 == kn) {
                        r.partitioned = Some((s, kn, c.1));
                    }
                }
            }
            done.insert((t.schema, t.name), out.len());
            out.push(r);
        }
        pending = rest;
        if pending.is_empty() {
            break;
        }
        if !progressed {
            // a cycle: break it by dropping the first table's references
            let t = pending.remove(0);
            let mut r = Resolved { t, cols: vec![("id".into(), 1, true, false)], partitioned: None, part_of: None, inherits: vec![] };
            for c in &t.cols {
                if !r.cols.iter().any(|x| x.0 == cname(c.name)) {
                    r.cols.push((cname(c.name), c.ty, c.not_null, c.default));
                }
            }
            done.insert((t.schema, t.name), out.len());
            out.push(r);
        }
    }
    out
}

fn default_sql(f: Flavor, ty: u8) -> &'static str {
    match (f, ty) {
        (_, 0) | (_, 1) => "42",
        (Flavor::Supabase, 2) => "(extensions.uuid_generate_v4())::text",
        (_, 2) => "'x'",
        (_, 3) => "CURRENT_DATE",
        _ => "1.50",
    }
}

fn grants_sql(f: Flavor, out: &mut String, obj: &str, cols: &[(String, u8, bool, bool)], gs: &[Grant]) {
    for g in gs {
        let privs = privs_sql(g.privs.max(1));
        let col = g.col.and_then(|c| cols.iter().find(|x| x.0 == cname(c))).map(|x| x.0.clone());
        let privs: Vec<String> = match &col {
            // DELETE has no column form
            Some(c) => privs.iter().filter(|p| **p != "DELETE").map(|p| format!("{p} ({c})")).collect(),
            None => privs.iter().map(|p| p.to_string()).collect(),
        };
        if privs.is_empty() {
            continue;
        }
        let role = role_sql(f, g.role);
        let wg = if g.with_grant && role != "PUBLIC" { " WITH GRANT OPTION" } else { "" };
        let _ = writeln!(out, "GRANT {} ON {obj} TO {role}{wg};", privs.join(", "));
    }
}

pub fn render(d: &Db) -> String {
    let f = d.flavor;
    let mut out = String::new();
    let _ = writeln!(out, "CREATE SCHEMA app;");
    if let Some(o) = owner_name(f, d.app_owner) {
        let _ = writeln!(out, "ALTER SCHEMA app OWNER TO {o};");
    }
    for r in d.app_usage.iter().collect::<BTreeSet<_>>() {
        let _ = writeln!(out, "GRANT USAGE ON SCHEMA app TO {};", role_sql(f, *r));
    }
    let _ = writeln!(
        out,
        "CREATE FUNCTION public.eph_trg() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;"
    );
    let defprivs = |out: &mut String| {
        let mut seen = BTreeSet::new();
        for p in &d.defprivs {
            if !seen.insert((p.for_owner, p.schema, p.objtype, p.role)) {
                continue;
            }
            let for_role = owner_name(f, p.for_owner).map(|o| format!(" FOR ROLE {o}")).unwrap_or_default();
            let ins = p.schema.map(|s| format!(" IN SCHEMA {}", SCHEMAS[s as usize])).unwrap_or_default();
            let (privs, kind) = match p.objtype {
                0 => ("SELECT, INSERT", "TABLES"),
                1 => ("USAGE", "SEQUENCES"),
                _ => ("EXECUTE", "FUNCTIONS"),
            };
            let role = role_sql(f, p.role);
            let body = if p.revoke { format!("REVOKE {privs} ON {kind} FROM {role}") } else { format!("GRANT {privs} ON {kind} TO {role}") };
            let _ = writeln!(out, "ALTER DEFAULT PRIVILEGES{for_role}{ins} {body};");
        }
    };
    if d.defprivs_first {
        defprivs(&mut out);
    }
    let rs = resolve(d);
    let names: BTreeMap<(u8, u8), usize> = rs.iter().enumerate().map(|(i, r)| ((r.t.schema, r.t.name), i)).collect();
    // relations
    for r in &rs {
        let t = r.t;
        let me = rel(t.schema, &tname(t.name));
        if let Some((parent, bound)) = &r.part_of {
            let _ = write!(out, "CREATE TABLE {me} PARTITION OF {parent} {bound}");
        } else {
            let mut defs: Vec<String> = Vec::new();
            for (i, (n, ty, nn, def)) in r.cols.iter().enumerate() {
                // inherited columns are declared by the parent
                if i > 0 && !r.inherits.is_empty() && t.cols.iter().all(|c| cname(c.name) != *n) {
                    continue;
                }
                if !d.merge && r.inherits.iter().any(|p| rs.iter().any(|x| rel(x.t.schema, &tname(x.t.name)) == *p && x.cols.iter().any(|c| c.0 == *n))) {
                    continue;
                }
                let mut s = format!("{n} {}", tyname(*ty));
                if *nn {
                    s += " NOT NULL";
                }
                if *def {
                    s += &format!(" DEFAULT {}", default_sql(f, *ty));
                }
                defs.push(s);
            }
            let _ = write!(out, "CREATE TABLE {me} ({})", defs.join(", "));
            if !r.inherits.is_empty() {
                let _ = write!(out, " INHERITS ({})", r.inherits.join(", "));
            }
        }
        if let Some((s, k, _)) = &r.partitioned {
            let by = match s {
                Strategy::Range => "RANGE",
                Strategy::List => "LIST",
                Strategy::Hash => "HASH",
            };
            let _ = write!(out, " PARTITION BY {by} ({k})");
        }
        let _ = writeln!(out, ";");
    }
    // constraints, indexes and the rest, once every relation exists
    let key_cols = |r: &Resolved| -> Vec<String> {
        let mut v = vec!["id".to_string()];
        if let Some((_, k, _)) = &r.partitioned {
            if k != "id" {
                v.push(k.clone());
            }
        }
        v
    };
    let has_col = |r: &Resolved, c: u8| r.cols.iter().any(|x| x.0 == cname(c));
    for r in &rs {
        let t = r.t;
        let me = rel(t.schema, &tname(t.name));
        // a partition inherits the parent's key; its own would clash
        if t.pk && r.part_of.is_none() {
            let _ = writeln!(out, "ALTER TABLE {me} ADD CONSTRAINT {}_pk PRIMARY KEY ({});", tname(t.name), key_cols(r).join(", "));
        }
        if let Some(c) = t.unique.filter(|c| has_col(r, *c)) {
            // on a partitioned table a unique key must hold every partition key
            // below it; `id` is the sub-partition key
            let mut cols = vec![cname(c)];
            let extra = if r.partitioned.is_some() { key_cols(r) } else { vec![] };
            for k in extra {
                if !cols.contains(&k) {
                    cols.push(k);
                }
            }
            let _ = writeln!(out, "ALTER TABLE {me} ADD CONSTRAINT {}_uq UNIQUE ({});", tname(t.name), cols.join(", "));
        }
    }
    for r in &rs {
        let t = r.t;
        let me = rel(t.schema, &tname(t.name));
        let is_part = r.part_of.is_some();
        if let Some((c, no_inherit)) = t.check.filter(|c| has_col(r, c.0)) {
            let ni = if no_inherit && r.partitioned.is_none() && !is_part { " NO INHERIT" } else { "" };
            let _ = writeln!(out, "ALTER TABLE {me} ADD CONSTRAINT {}_ck CHECK ({} IS NOT NULL){ni};", tname(t.name), cname(c));
        }
        if let Some(c) = t.index.filter(|c| has_col(r, *c)) {
            let _ = writeln!(out, "CREATE INDEX {}_ix ON {me} ({});", tname(t.name), cname(c));
        }
        if let Some(target) = t.fk.and_then(|n| names.get(&(t.schema, n))).map(|i| &rs[*i]) {
            // references the target's primary key, when the columns line up
            let tk = key_cols(target);
            let ok = target.t.pk
                && target.part_of.is_none()
                && tk.iter().all(|k| r.cols.iter().any(|c| c.0 == *k && target.cols.iter().any(|tc| tc.0 == *k && tc.1 == c.1)));
            if ok {
                let _ = writeln!(
                    out,
                    "ALTER TABLE {me} ADD CONSTRAINT {}_fk FOREIGN KEY ({}) REFERENCES {} ({});",
                    tname(t.name),
                    tk.join(", "),
                    rel(target.t.schema, &tname(target.t.name)),
                    tk.join(", ")
                );
            }
        }
        if t.trigger {
            let _ = writeln!(out, "CREATE TRIGGER {}_tg AFTER INSERT ON {me} FOR EACH ROW EXECUTE FUNCTION public.eph_trg();", tname(t.name));
        }
        if t.rls {
            let _ = writeln!(out, "ALTER TABLE {me} ENABLE ROW LEVEL SECURITY;");
        }
        if let Some((role, auth)) = t.policy {
            let using = if auth && f == Flavor::Supabase { "((SELECT auth.uid()) IS NOT NULL)" } else { "(id > 0)" };
            let _ = writeln!(out, "CREATE POLICY {}_pol ON {me} FOR SELECT TO {} USING {using};", tname(t.name), role_sql(f, role));
        }
        if t.comment {
            let _ = writeln!(out, "COMMENT ON TABLE {me} IS 'rel {}';", t.name);
        }
        if let Some(o) = owner_name(f, t.owner) {
            let _ = writeln!(out, "ALTER TABLE {me} OWNER TO {o};");
        }
        grants_sql(f, &mut out, &me, &r.cols, &t.grants);
        // ADD TABLE without ONLY also adds inheritance children; adding a
        // child of a member again is an error
        let parent_in_pub = {
            let mut stack: Vec<&String> = r.inherits.iter().collect();
            let mut found = false;
            while let Some(p) = stack.pop() {
                let Some(x) = rs.iter().find(|x| rel(x.t.schema, &tname(x.t.name)) == *p) else { continue };
                if x.t.realtime {
                    found = true;
                    break;
                }
                stack.extend(x.inherits.iter());
            }
            found
        };
        if t.realtime && f == Flavor::Supabase && !parent_in_pub {
            let _ = writeln!(out, "ALTER PUBLICATION supabase_realtime ADD TABLE {me};");
        }
    }
    let mut vseen = BTreeSet::new();
    for v in &d.views {
        let Some(src) = names.get(&(v.schema, v.src)).map(|i| &rs[*i]) else { continue };
        if !vseen.insert((v.schema, v.name)) {
            continue;
        }
        let me = rel(v.schema, &format!("v{}", v.name));
        // security_invoker is PG 15+
        let pg14 = std::env::var("PGDELTA_TEST_IMAGE").unwrap_or_default().contains(":14");
        let si = if v.security_invoker && !pg14 { " WITH (security_invoker = true)" } else { "" };
        let _ = writeln!(out, "CREATE VIEW {me}{si} AS SELECT id FROM {};", rel(src.t.schema, &tname(src.t.name)));
        if let Some(o) = owner_name(f, v.owner) {
            let _ = writeln!(out, "ALTER VIEW {me} OWNER TO {o};");
        }
        grants_sql(f, &mut out, &me, &[("id".into(), 1, true, false)], &v.grants);
    }
    let mut sseen = BTreeSet::new();
    for s in &d.seqs {
        if !sseen.insert((s.schema, s.name)) {
            continue;
        }
        let me = rel(s.schema, &format!("q{}", s.name));
        let _ = writeln!(out, "CREATE SEQUENCE {me};");
        if let Some(o) = owner_name(f, s.owner) {
            let _ = writeln!(out, "ALTER SEQUENCE {me} OWNER TO {o};");
        }
        for (r, p) in &s.grants {
            let ps: Vec<&str> = [(1, "USAGE"), (2, "SELECT"), (4, "UPDATE")].iter().filter(|(b, _)| p & b != 0).map(|(_, s)| *s).collect();
            if !ps.is_empty() {
                let _ = writeln!(out, "GRANT {} ON SEQUENCE {me} TO {};", ps.join(", "), role_sql(f, *r));
            }
        }
    }
    let mut fseen = BTreeSet::new();
    for fun in &d.funcs {
        if !fseen.insert((fun.schema, fun.name)) {
            continue;
        }
        let me = rel(fun.schema, &format!("f{}", fun.name));
        let sd = if fun.security_definer { " SECURITY DEFINER" } else { "" };
        let _ = writeln!(out, "CREATE FUNCTION {me}() RETURNS integer LANGUAGE sql{sd} AS 'SELECT {}';", fun.name);
        if let Some(o) = owner_name(f, fun.owner) {
            let _ = writeln!(out, "ALTER FUNCTION {me}() OWNER TO {o};");
        }
        if fun.revoke_public {
            let _ = writeln!(out, "REVOKE EXECUTE ON FUNCTION {me}() FROM PUBLIC;");
        }
        for r in fun.execute.iter().collect::<BTreeSet<_>>() {
            let _ = writeln!(out, "GRANT EXECUTE ON FUNCTION {me}() TO {};", role_sql(f, *r));
        }
    }
    if !d.defprivs_first {
        defprivs(&mut out);
    }
    out
}

// ------------------------------------------------------------------ generation

fn opt<T>(g: &mut Source, p: f64, f: impl FnOnce(&mut Source) -> T) -> Option<T> {
    if g.bool_with(p) {
        Some(f(g))
    } else {
        None
    }
}

fn col(g: &mut Source, name: u8) -> Col {
    Col { name, ty: g.int(0u8..=4), not_null: g.bool_with(0.25), default: g.bool_with(0.3) }
}

fn grant(g: &mut Source) -> Grant {
    Grant { role: g.int(0u8..=3), privs: g.int(1u8..=15), col: opt(g, 0.2, |g| g.int(0..NC)), with_grant: g.bool_with(0.15) }
}

fn grants(g: &mut Source) -> Vec<Grant> {
    let n = g.int(0usize..=2);
    (0..n).map(|_| grant(g)).collect()
}

fn strategy(g: &mut Source) -> Strategy {
    *g.pick(&[Strategy::Range, Strategy::List, Strategy::Hash])
}

fn owner(g: &mut Source) -> u8 {
    if g.bool_with(0.3) {
        g.int(1u8..=2)
    } else {
        0
    }
}

fn table(g: &mut Source, f: Flavor, schema: u8, name: u8) -> Table {
    let n = g.int(1u8..=NC);
    let mut cols: Vec<Col> = (0..n).map(|i| col(g, i)).collect();
    let partitioned = opt(g, 0.35, |g| (strategy(g), g.int(0..n)));
    if let Some((_, k)) = partitioned {
        // the key must be NOT NULL to be in a primary key
        cols[k as usize].not_null = true;
    }
    Table {
        schema,
        name,
        cols,
        partitioned,
        part_of: None,
        inherits: vec![],
        pk: g.bool_with(0.6),
        index: opt(g, 0.3, |g| g.int(0..NC)),
        unique: opt(g, 0.15, |g| g.int(0..NC)),
        check: opt(g, 0.25, |g| (g.int(0..NC), g.bool())),
        fk: opt(g, 0.15, |g| g.int(0..NT)),
        trigger: g.bool_with(0.2),
        rls: g.bool_with(0.3),
        policy: opt(g, 0.3, |g| (g.int(0u8..=3), g.bool())),
        owner: owner(g),
        grants: grants(g),
        comment: g.bool_with(0.15),
        realtime: f == Flavor::Supabase && g.bool_with(0.25),
    }
}

fn partition(g: &mut Source, f: Flavor, parent: &Table, name: u8) -> Table {
    let mut t = table(g, f, parent.schema, name);
    t.cols = parent.cols.clone();
    t.partitioned = if g.bool_with(0.15) { Some((Strategy::Hash, ID)) } else { None };
    t.part_of = Some(PartOf { parent: parent.name, slot: g.int(0u8..=3), default: g.bool_with(0.15) });
    t.pk = false;
    t
}

pub fn db(g: &mut Source, f: Flavor) -> Db {
    let mut d = Db {
        flavor: f,
        app_owner: owner(g),
        app_usage: (0..g.int(0usize..=2)).map(|_| g.int(0u8..=3)).collect(),
        tables: vec![],
        views: vec![],
        seqs: vec![],
        funcs: vec![],
        defprivs: vec![],
        defprivs_first: g.bool(),
        merge: true,
    };
    let nt = g.int(1usize..=4);
    for i in 0..nt {
        let s = g.int(0u8..=1);
        let t = table(g, f, s, i as u8);
        d.tables.push(t);
    }
    // children: partitions of partitioned tables, inheritance children of plain ones
    let mut next = nt as u8;
    for i in 0..nt {
        if next >= NT {
            break;
        }
        let p = d.tables[i].clone();
        let kids = g.int(0u8..=2);
        for _ in 0..kids {
            if next >= NT {
                break;
            }
            let c = if p.partitioned.is_some() {
                partition(g, f, &p, next)
            } else {
                let mut c = table(g, f, p.schema, next);
                c.partitioned = None;
                c.inherits = vec![p.name];
                c
            };
            d.tables.push(c);
            next += 1;
        }
    }
    for i in 0..g.int(0u8..=2) {
        d.views.push(View { schema: g.int(0u8..=1), name: i, src: g.int(0..NT), owner: owner(g), grants: grants(g), security_invoker: g.bool_with(0.3) });
    }
    for i in 0..g.int(0u8..=1) {
        d.seqs.push(Seq { schema: g.int(0u8..=1), name: i, owner: owner(g), grants: (0..g.int(0usize..=2)).map(|_| (g.int(0u8..=3), g.int(1u8..=7))).collect() });
    }
    for i in 0..g.int(0u8..=2) {
        d.funcs.push(Func {
            schema: g.int(0u8..=1),
            name: i,
            owner: owner(g),
            security_definer: g.bool_with(0.3),
            revoke_public: g.bool_with(0.4),
            execute: (0..g.int(0usize..=2)).map(|_| g.int(0u8..=2)).collect(),
        });
    }
    for _ in 0..g.int(0u8..=2) {
        d.defprivs.push(defpriv(g, f));
    }
    d
}

fn defpriv(g: &mut Source, f: Flavor) -> DefPriv {
    DefPriv {
        for_owner: if f == Flavor::Stock { owner(g) } else { 0 },
        schema: opt(g, 0.5, |g| g.int(0u8..=1)),
        objtype: g.int(0u8..=2),
        role: g.int(0u8..=3),
        revoke: g.bool_with(0.2),
    }
}

fn edit(g: &mut Source, d: &mut Db) {
    let f = d.flavor;
    let nt = d.tables.len();
    let pick = |g: &mut Source, d: &Db| if d.tables.is_empty() { None } else { Some(g.index(d.tables.len())) };
    match g.int(0u8..=24) {
        // partitioning
        0 => {
            // add a partition to a partitioned table
            let parents: Vec<usize> = (0..nt).filter(|i| d.tables[*i].partitioned.is_some()).collect();
            let used: BTreeSet<(u8, u8)> = d.tables.iter().map(|t| (t.schema, t.name)).collect();
            if let (false, Some(name)) = (parents.is_empty(), (0..NT).find(|n| !used.contains(&(0, *n)) && !used.contains(&(1, *n)))) {
                let p = d.tables[parents[g.index(parents.len())]].clone();
                let c = partition(g, f, &p, name);
                d.tables.push(c);
            }
        }
        1 => {
            // move a partition to another bound, or to/from DEFAULT
            if let Some(i) = pick(g, d) {
                if let Some(p) = d.tables[i].part_of.as_mut() {
                    if g.bool() {
                        p.slot = (p.slot + 1 + g.int(0u8..=2)) % 4;
                    } else {
                        p.default ^= true;
                    }
                }
            }
        }
        2 => {
            // detach a partition into a standalone table with the same columns
            if let Some(i) = pick(g, d) {
                d.tables[i].part_of = None;
            }
        }
        3 => {
            // attach a plain table as a partition: it takes the parent's columns
            let parents: Vec<usize> = (0..nt).filter(|i| d.tables[*i].partitioned.is_some()).collect();
            if let (false, Some(i)) = (parents.is_empty(), pick(g, d)) {
                let p = d.tables[parents[g.index(parents.len())]].clone();
                let t = &mut d.tables[i];
                if t.name != p.name && t.partitioned.is_none() {
                    t.schema = p.schema;
                    t.cols = p.cols.clone();
                    t.inherits.clear();
                    t.part_of = Some(PartOf { parent: p.name, slot: g.int(0u8..=3), default: false });
                }
            }
        }
        4 => {
            // change the strategy or the key, or partition/unpartition a table
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                let n = t.cols.len() as u8;
                t.partitioned = match t.partitioned {
                    Some((s, k)) if g.bool() => Some(if g.bool() { (strategy(g), k) } else { (s, g.int(0..n)) }),
                    Some(_) => None,
                    None => Some((strategy(g), g.int(0..n))),
                };
                // a kept key may be ID, or past a column that was dropped since
                if let Some(c) = t.partitioned.and_then(|(_, k)| t.cols.get_mut(k as usize)) {
                    c.not_null = true;
                }
            }
        }
        5 => {
            // sub-partition a partition by hash
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                if t.part_of.is_some() {
                    t.partitioned = if t.partitioned.is_some() { None } else { Some((Strategy::Hash, ID)) };
                }
            }
        }
        // columns: on a parent they propagate to partitions / children
        6 => {
            if let Some(i) = pick(g, d) {
                let used: BTreeSet<u8> = d.tables[i].cols.iter().map(|c| c.name).collect();
                if let Some(n) = (0..NC).find(|n| !used.contains(n)) {
                    let c = col(g, n);
                    let name = d.tables[i].name;
                    let schema = d.tables[i].schema;
                    d.tables[i].cols.push(c.clone());
                    for t in d.tables.iter_mut().filter(|t| t.schema == schema && t.part_of.as_ref().is_some_and(|p| p.parent == name)) {
                        t.cols.push(c.clone());
                    }
                }
            }
        }
        7 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                if t.cols.len() > 1 {
                    let k = g.index(t.cols.len());
                    let gone = t.cols.remove(k).name;
                    if t.partitioned.is_some_and(|(_, key)| key == gone) {
                        t.partitioned = None;
                    }
                }
            }
        }
        8 => {
            // retype a column (the partition key included)
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                let k = g.index(t.cols.len());
                t.cols[k].ty = (t.cols[k].ty + 1 + g.int(0u8..=3)) % 5;
            }
        }
        9 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                let k = g.index(t.cols.len());
                if g.bool() {
                    t.cols[k].not_null ^= true;
                } else {
                    t.cols[k].default ^= true;
                }
            }
        }
        // inheritance
        10 => {
            if let (Some(i), Some(j)) = (pick(g, d), pick(g, d)) {
                let pn = d.tables[j].name;
                let t = &mut d.tables[i];
                if let Some(k) = t.inherits.iter().position(|x| *x == pn) {
                    t.inherits.remove(k);
                } else if t.name != pn && t.part_of.is_none() {
                    t.inherits.push(pn);
                }
            }
        }
        11 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                t.check = match t.check {
                    Some((c, ni)) if g.bool() => Some((c, !ni)),
                    Some(_) => None,
                    None => Some((g.int(0..NC), g.bool())),
                };
            }
        }
        // ownership
        12 => {
            if let Some(i) = pick(g, d) {
                d.tables[i].owner = (d.tables[i].owner + 1) % 3;
            }
        }
        13 => d.app_owner = (d.app_owner + 1) % 3,
        14 => {
            if !d.views.is_empty() {
                let k = g.index(d.views.len());
                let v = &mut d.views[k];
                match g.int(0u8..=2) {
                    0 => v.owner = (v.owner + 1) % 3,
                    1 => v.security_invoker ^= true,
                    _ => v.grants = grants(g),
                }
            } else {
                d.views.push(View { schema: g.int(0u8..=1), name: 0, src: g.int(0..NT), owner: owner(g), grants: grants(g), security_invoker: false });
            }
        }
        15 => {
            if !d.funcs.is_empty() {
                let k = g.index(d.funcs.len());
                let fu = &mut d.funcs[k];
                match g.int(0u8..=3) {
                    0 => fu.owner = (fu.owner + 1) % 3,
                    1 => fu.security_definer ^= true,
                    2 => fu.revoke_public ^= true,
                    _ => fu.execute = (0..g.int(0usize..=2)).map(|_| g.int(0u8..=2)).collect(),
                }
            } else {
                d.funcs.push(Func { schema: 0, name: 0, owner: owner(g), security_definer: false, revoke_public: true, execute: vec![g.int(0u8..=2)] });
            }
        }
        16 => {
            if !d.seqs.is_empty() {
                let k = g.index(d.seqs.len());
                let s = &mut d.seqs[k];
                if g.bool() {
                    s.owner = (s.owner + 1) % 3;
                } else {
                    s.grants = (0..g.int(0usize..=2)).map(|_| (g.int(0u8..=3), g.int(1u8..=7))).collect();
                }
            } else {
                d.seqs.push(Seq { schema: g.int(0u8..=1), name: 0, owner: owner(g), grants: vec![(g.int(0u8..=3), 1)] });
            }
        }
        // privileges
        17 | 18 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                if !t.grants.is_empty() && g.bool() {
                    let k = g.index(t.grants.len());
                    match g.int(0u8..=3) {
                        0 => {
                            t.grants.remove(k);
                        }
                        1 => t.grants[k].privs = g.int(1u8..=15),
                        2 => t.grants[k].with_grant ^= true,
                        _ => t.grants[k].col = if t.grants[k].col.is_some() { None } else { Some(g.int(0..NC)) },
                    }
                } else {
                    t.grants.push(grant(g));
                }
            }
        }
        19 => {
            if !d.defprivs.is_empty() && g.bool() {
                let k = g.index(d.defprivs.len());
                match g.int(0u8..=2) {
                    0 => {
                        d.defprivs.remove(k);
                    }
                    1 => d.defprivs[k].revoke ^= true,
                    _ => d.defprivs[k].role = g.int(0u8..=3),
                }
            } else {
                d.defprivs.push(defpriv(g, f));
            }
        }
        20 => d.defprivs_first ^= true,
        21 => {
            if g.bool() || d.app_usage.is_empty() {
                d.app_usage.push(g.int(0u8..=3));
            } else {
                d.app_usage.pop();
            }
        }
        // RLS and policies
        22 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                match g.int(0u8..=2) {
                    0 => t.rls ^= true,
                    1 => t.policy = if t.policy.is_some() { None } else { Some((g.int(0u8..=3), g.bool())) },
                    _ => {
                        if let Some(p) = t.policy.as_mut() {
                            p.0 = (p.0 + 1) % 4;
                        }
                    }
                }
            }
        }
        // keys, indexes, triggers, publication
        23 => {
            if let Some(i) = pick(g, d) {
                let t = &mut d.tables[i];
                match g.int(0u8..=5) {
                    0 => t.pk ^= true,
                    1 => t.index = if t.index.is_some() { None } else { Some(g.int(0..NC)) },
                    2 => t.unique = if t.unique.is_some() { None } else { Some(g.int(0..NC)) },
                    3 => t.fk = if t.fk.is_some() { None } else { Some(g.int(0..NT)) },
                    4 => t.trigger ^= true,
                    _ => t.comment ^= true,
                }
            }
        }
        _ => {
            if let Some(i) = pick(g, d) {
                if f == Flavor::Supabase {
                    d.tables[i].realtime ^= true;
                } else {
                    d.tables.remove(i);
                }
            }
        }
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
        write!(f, "\n-- flavor: {:?} compact: {}\n-- A:\n{}-- B:\n{}", self.a.flavor, self.compact, render(&self.a), render(&self.b))
    }
}

pub fn pair(g: &mut Source, f: Flavor) -> Pair {
    let a = db(g, f);
    let b = if g.bool_with(0.08) {
        db(g, f)
    } else {
        let mut b = a.clone();
        for _ in 0..g.int(1usize..=(2 + g.size().min(5))) {
            edit(g, &mut b);
        }
        b
    };
    let (a, b) = if g.bool() { (a, b) } else { (b, a) };
    Pair { a, b, compact: g.bool() }
}

// ------------------------------------------------------------------ shrinking

fn shrink_table(t: &Table) -> Vec<Table> {
    let mut out = Vec::new();
    let mut push = |f: &dyn Fn(&mut Table)| {
        let mut x = t.clone();
        f(&mut x);
        if x != *t {
            out.push(x);
        }
    };
    push(&|x| x.grants.clear());
    push(&|x| x.policy = None);
    push(&|x| x.rls = false);
    push(&|x| x.trigger = false);
    push(&|x| x.comment = false);
    push(&|x| x.realtime = false);
    push(&|x| x.index = None);
    push(&|x| x.unique = None);
    push(&|x| x.check = None);
    push(&|x| x.fk = None);
    push(&|x| x.pk = false);
    push(&|x| x.owner = 0);
    push(&|x| x.inherits.clear());
    push(&|x| {
        if let Some(p) = x.part_of.as_mut() {
            p.default = false;
            p.slot = 0;
        }
    });
    for i in 0..t.grants.len() {
        let mut x = t.clone();
        x.grants.remove(i);
        out.push(x);
        let mut x = t.clone();
        x.grants[i] = Grant { role: x.grants[i].role, privs: 1, col: None, with_grant: false };
        if x != *t {
            out.push(x);
        }
    }
    for i in 0..t.cols.len() {
        let mut x = t.clone();
        x.cols[i].default = false;
        x.cols[i].not_null = x.partitioned.is_some_and(|(_, k)| k == x.cols[i].name);
        if x != *t {
            out.push(x);
        }
        if t.cols.len() > 1 && !t.partitioned.is_some_and(|(_, k)| k == t.cols[i].name) {
            let mut x = t.clone();
            x.cols.remove(i);
            out.push(x);
        }
    }
    out
}

pub fn shrink_db(d: &Db) -> Vec<Db> {
    let mut out = Vec::new();
    for i in 0..d.tables.len() {
        let mut x = d.clone();
        x.tables.remove(i);
        out.push(x);
    }
    for (i, t) in d.tables.iter().enumerate() {
        for s in shrink_table(t) {
            let mut x = d.clone();
            x.tables[i] = s;
            out.push(x);
        }
    }
    macro_rules! drop_each {
        ($f:ident) => {
            for i in 0..d.$f.len() {
                let mut x = d.clone();
                x.$f.remove(i);
                out.push(x);
            }
        };
    }
    drop_each!(views);
    drop_each!(seqs);
    drop_each!(funcs);
    drop_each!(defprivs);
    drop_each!(app_usage);
    if d.app_owner != 0 {
        let mut x = d.clone();
        x.app_owner = 0;
        out.push(x);
    }
    out
}

/// Common context first (the same object removed or simplified on both
/// sides), then each side alone.
pub fn shrink_pair(p: &Pair) -> Vec<Pair> {
    let mut out = Vec::new();
    let keys: BTreeSet<(u8, u8)> = p.a.tables.iter().chain(&p.b.tables).map(|t| (t.schema, t.name)).collect();
    for (s, n) in keys {
        let mut x = p.clone();
        x.a.tables.retain(|t| (t.schema, t.name) != (s, n));
        x.b.tables.retain(|t| (t.schema, t.name) != (s, n));
        if x.a.tables.len() < p.a.tables.len() && x.b.tables.len() < p.b.tables.len() {
            out.push(x);
        }
    }
    for (i, ta) in p.a.tables.iter().enumerate() {
        if let Some(j) = p.b.tables.iter().position(|t| (t.schema, t.name) == (ta.schema, ta.name)) {
            for (xa, xb) in shrink_table(ta).into_iter().zip(shrink_table(&p.b.tables[j])) {
                let mut x = p.clone();
                x.a.tables[i] = xa;
                x.b.tables[j] = xb;
                out.push(x);
            }
        }
    }
    macro_rules! both {
        ($f:ident) => {
            if !p.a.$f.is_empty() && !p.b.$f.is_empty() {
                let mut x = p.clone();
                x.a.$f.remove(0);
                x.b.$f.remove(0);
                out.push(x);
            }
        };
    }
    both!(views);
    both!(seqs);
    both!(funcs);
    both!(defprivs);
    for a in shrink_db(&p.a) {
        out.push(Pair { a, b: p.b.clone(), compact: p.compact });
    }
    for b in shrink_db(&p.b) {
        out.push(Pair { a: p.a.clone(), b, compact: p.compact });
    }
    out
}

// ------------------------------------------------------------------ property

use ephyra::{signature, Gen, GenExt};

pub fn pairs(f: Flavor) -> impl Gen<Value = Pair> {
    (move |g: &mut Source| pair(g, f)).with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

/// Families already confirmed and pinned; matched narrowly so a new bug with a
/// similar message still fails the property.
pub fn known_bug(o: &crate::Outcome) -> Option<&'static str> {
    let first = o.detail.lines().next().unwrap_or("");
    let plan = o.detail.split("plan:").nth(1).unwrap_or("");
    match o.kind.as_str() {
        "apply_error" if first.contains("cannot cast type") => Some("retype without a cast"),
        "data_loss" if plan.contains("DROP TABLE") => Some("proof counts inheritance children as the parent's rows"),
        "apply_error" if first.contains("already exists") && first.contains("column") => Some("child redeclaring a parent column"),
        "apply_error" if first.contains("cannot drop table") && first.contains("because other objects depend on it") && plan.contains(" PARTITION OF ") => Some("partition re-create with a dependent FK"),
        "drift" if o.detail.contains("add acl:") && plan.contains(" OWNER TO ") => Some("owner change loses grant to previous owner"),
        "drift" if o.detail.contains("remove acl:") && plan.contains("CREATE TABLE") => Some("creator default privileges on a new table"),
        "apply_error" if first.contains("cannot alter inherited column") || first.contains("has different type for column") || first.contains("cannot create not-null constraint") => Some("merged inherited column"),
        "drift" if o.detail.contains("add defaultPrivilege:") && o.detail.contains(".PUBLIC") => Some("default privilege of a role on itself"),
        "drift" if self_defpriv(&o.detail) => Some("default privilege of a role on itself"),
        "drift" if o.detail.contains("publicationRel:") => Some("publication and inheritance children"),
        "apply_error" if first.contains("cannot drop inherited column") => Some("child stops redeclaring a column"),
        "apply_error" if first.contains("already member of publication") || first.contains("is not part of the publication") => Some("publication and inheritance children"),
        "drift" if o.detail.contains(".notNull: false -> true") && plan.contains("DROP NOT NULL") => Some("parent DROP NOT NULL recurses to child"),
        "plan_throw" if first.contains("dependency cycle") && o.detail.contains("REVOKE ALL (") => Some("table replace with a column grant"),
        // a parent with an FK to its own inheritance child is re-created as partitioned / a partition (draft 18)
        "plan_throw" | "sync_throw" if first.contains("dependency cycle") && o.detail.contains("FOREIGN KEY") && o.detail.contains("DROP TABLE") && o.detail.contains("PARTITION") => Some("parent with an FK to its former child"),
        _ => None,
    }
}

pub fn check(p: &Pair, flavor: &str) {
    check_outcome(crate::migrate_flavor(&render(&p.a), &render(&p.b), p.compact, flavor));
}

/// `check` with a real row in every source table.
pub fn check_rows(p: &Pair, flavor: &str) {
    check_outcome(crate::migrate_rows(&render(&p.a), &render(&p.b), p.compact, flavor));
}

fn check_outcome(o: crate::Outcome) {
    ephyra::classify(o.kind == "data_hazard", "data hazard (fails only with seeded rows)");
    let known = known_bug(&o);
    ephyra::classify(known.is_some(), "known bug (pinned in tests/ext_regressions.rs or tests/regressions.rs)");
    if let Some(k) = known {
        ephyra::classify(true, k);
    }
    let known = known.is_some();
    match o.verdict.as_str() {
        "pass" => {}
        _ if known => {}
        "invalid" => {
            signature(crate::sig(&format!("generator-invalid {}", o.kind), &o.detail));
            panic!("generated SQL did not load ({}): {}", o.kind, o.detail);
        }
        _ => {
            signature(crate::sig(&o.kind, &o.detail));
            panic!("pg-delta {}: {}", o.kind, o.detail);
        }
    }
}


/// `pairs` without merged inherited columns (see `Db::merge`).
pub fn pairs_unmerged(f: Flavor) -> impl Gen<Value = Pair> {
    (move |g: &mut Source| {
        let mut p = pair(g, f);
        p.a.merge = false;
        p.b.merge = false;
        p
    })
    .with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}

/// Layout a pair's declarative run exports with: the CLI's `grouped`, or the
/// default `by-object` (reusing the pair's `compact` coin keeps shrinking simple).
pub fn layout(p: &Pair) -> &'static str {
    if p.compact { "grouped" } else { "by-object" }
}

/// `defaultPrivilege:<role>.<schema>.<kind>.<grantee>` with grantee == role.
fn self_defpriv(detail: &str) -> bool {
    detail.lines().any(|l| {
        let Some(id) = l.trim().split("defaultPrivilege:").nth(1) else { return false };
        let parts: Vec<&str> = id.split('.').collect();
        parts.len() >= 4 && parts[0] == parts[parts.len() - 1]
    })
}

/// ALTER DEFAULT PRIVILEGES FOR ROLE "r" … TO / FROM "r".
fn self_adp_sql(line: &str) -> bool {
    let Some(rest) = line.split("ALTER DEFAULT PRIVILEGES FOR ROLE ").nth(1) else { return false };
    let role = rest.split(' ').next().unwrap_or("");
    let tail = &rest[role.len()..];
    tail.ends_with(&format!(" {role}")) || tail.ends_with(&format!(" {role};"))
}

/// The export creates a child with `() INHERITS (…)` and then adds a column
/// to it: the column the child redeclares, which it already inherits.
fn child_add_column(detail: &str) -> bool {
    let children: Vec<&str> = detail
        .lines()
        .filter(|l| l.contains(" () INHERITS "))
        .filter_map(|l| l.strip_prefix("CREATE TABLE ").and_then(|r| r.split(" () ").next()))
        .collect();
    detail.lines().any(|l| children.iter().any(|c| l.starts_with(&format!("ALTER TABLE {c} ADD COLUMN "))))
}

/// The export adds both an inheritance parent and one of its children to a
/// publication; `ADD TABLE parent` already added the child.
fn publication_parent_and_child(detail: &str) -> bool {
    let members: Vec<&str> = detail.lines().filter_map(|l| l.split(" ADD TABLE ").nth(1)).map(|t| t.trim_end_matches(';')).collect();
    detail.lines().any(|l| {
        let Some(rest) = l.strip_prefix("CREATE TABLE ") else { return false };
        let Some((child, parents)) = rest.split_once(" INHERITS (") else { return false };
        let child = child.split(" (").next().unwrap_or("");
        members.contains(&child) && parents.trim_end_matches(';').trim_end_matches(')').split(", ").any(|p| members.contains(&p))
    })
}

/// Failure families pinned in tests/declarative_regressions.rs.
pub fn known_declarative(o: &crate::Outcome) -> Option<&'static str> {
    let first = o.detail.lines().next().unwrap_or("");
    let remaining = o.detail.split("remaining:\n").nth(1).and_then(|r| r.split("\nplan:").next()).unwrap_or("");
    match o.kind.as_str() {
        "resync_throw" | "sync_throw" if first.contains("cannot apply") && publication_parent_and_child(&o.detail) => Some("publication and inheritance children"),
        "resync_throw" | "sync_throw" if first.contains("cannot apply") && child_add_column(&o.detail) => Some("export of a child redeclaring an inherited column"),
        "resync_not_empty" | "sync_not_converged" if first.starts_with("ALTER DEFAULT PRIVILEGES FOR ROLE ") && first.contains(" IN SCHEMA ") && (first.ends_with(" TO PUBLIC") || first.ends_with(" FROM PUBLIC")) => {
            Some("default privilege of a role on itself")
        }
        "sync_not_converged" if first.contains("ALTER PUBLICATION") && o.detail.contains(" INHERITS (") => Some("publication and inheritance children"),
        "apply_error" if first.contains("cannot drop table") && first.contains("other objects depend on it") && o.detail.contains("PARTITION BY") => Some("partition drop with an FK to the parent"),
        "sync_not_converged" if o.detail.split("\nplan:\n").nth(1).is_some_and(|p| p.split("\nexport:").next().unwrap_or("").contains(" OWNER TO ")) => Some("owner change loses grant to previous owner"),
        "resync_not_empty" | "sync_not_converged" if first.starts_with("ALTER DEFAULT PRIVILEGES") && o.detail.split("export:").nth(1).is_some_and(|e| e.lines().any(self_adp_sql)) => Some("default privilege of a role on itself"),
        "sync_throw" | "resync_throw" if first.contains("dependency cycle") && o.detail.contains("REVOKE ALL (") => Some("table replace with a column grant"),
        "sync_not_converged" if !remaining.is_empty() && remaining.lines().all(|l| l.trim_start().split(": ").nth(1).is_some_and(|s| s.starts_with("REVOKE ALL ON"))) => {
            Some("owner back to the default owner")
        }
        _ => None,
    }
}

/// The declarative workflow over a pair: export B, re-sync it onto B (nothing to
/// do), sync it onto A, apply, re-sync (nothing left).
pub fn check_declarative(p: &Pair, flavor: &str) {
    let o = crate::declarative(&render(&p.a), &render(&p.b), layout(p), flavor);
    let known = known_bug(&o).or_else(|| known_declarative(&o));
    ephyra::classify(known.is_some(), "known bug (pinned in a regressions file)");
    if let Some(k) = known {
        ephyra::classify(true, k);
    }
    match o.verdict.as_str() {
        "pass" => {}
        _ if known.is_some() => {}
        "invalid" => {
            signature(crate::sig(&format!("generator-invalid {}", o.kind), &o.detail));
            panic!("generated SQL did not load ({}): {}", o.kind, o.detail);
        }
        _ => {
            signature(crate::sig(&o.kind, &o.detail));
            panic!("pg-delta declarative {} ({}): {}", o.kind, layout(p), o.detail);
        }
    }
}
