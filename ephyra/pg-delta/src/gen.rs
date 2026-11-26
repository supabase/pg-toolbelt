//! Drawing schemas and schema pairs, and shrinking them. Names come from
//! small pools so that objects collide, reference each other, and survive
//! from one side of a pair to the other.

use crate::model::*;
use ephyra::Source;

const NT: u8 = 4; // table names per schema
const NC: u8 = 6; // column names per table
const NF: u8 = 4; // function names

fn ty(g: &mut Source) -> Ty {
    match g.int(0u8..=15) {
        0 | 1 => Ty::Int,
        2 => Ty::BigInt,
        3 => Ty::SmallInt,
        4 | 5 => Ty::Text,
        6 => Ty::Varchar(*g.pick(&[1u16, 10, 255])),
        7 => Ty::Numeric(g.int(4u8..=12), g.int(0u8..=3)),
        8 => Ty::Bool,
        9 => Ty::Jsonb,
        10 => Ty::Timestamptz,
        11 => Ty::Uuid,
        12 => Ty::IntArr,
        13 => Ty::TextArr,
        14 => Ty::Enum(g.int(0u8..=1)),
        15 if g.bool() => Ty::Composite(g.int(0u8..=1)),
        _ => Ty::Domain(g.int(0u8..=1)),
    }
}

fn opt<T>(g: &mut Source, p: f64, f: impl FnOnce(&mut Source) -> T) -> Option<T> {
    if g.bool_with(p) {
        Some(f(g))
    } else {
        None
    }
}

fn default(g: &mut Source) -> Default {
    match g.int(0u8..=4) {
        0 | 1 => Default::Const,
        2 => Default::Alt,
        3 => Default::Func,
        _ => Default::NextVal(g.int(0u8..=1)),
    }
}

fn column(g: &mut Source, name: u8) -> Column {
    let ty = ty(g);
    Column {
        name,
        ty,
        not_null: g.bool_with(0.3),
        default: opt(g, 0.35, default),
        generated: opt(g, 0.15, |g| {
            if g.bool() {
                Generated::Identity { always: g.bool() }
            } else {
                Generated::Stored { from: g.int(0..=NC - 1) }
            }
        }),
        comment: opt(g, 0.1, |g| g.int(0u8..=2)),
        collate_c: g.bool_with(0.1),
        storage: opt(g, 0.08, |g| g.int(0u8..=2)),
        stats_target: opt(g, 0.06, |g| g.int(0u16..=1500)),
        ident_opts: opt(g, 0.3, |g| g.int(0u8..=50)),
    }
}

fn cols_subset(g: &mut Source, max: usize) -> Vec<u8> {
    let n = g.int(1..=max);
    (0..n).map(|_| g.int(0..=NC - 1)).collect()
}

fn grant(g: &mut Source) -> Grant {
    Grant { role: g.int(0u8..=3), privs: g.int(1u8..=127), col: opt(g, 0.3, |g| g.int(0..=NC - 1)) }
}

fn table(g: &mut Source, schema: u8, name: u8) -> Table {
    let ncols = g.int(1u8..=NC);
    let mut cols: Vec<Column> = (0..ncols).map(|c| column(g, c)).collect();
    if cols.len() > 1 && g.bool_with(0.2) {
        // non-sequential column names: holes and a different physical order
        let k = g.index(cols.len());
        cols.remove(k);
        let n = cols.len();
        if n > 1 {
            cols.swap(0, g.index(n));
        }
    }
    let pk = if g.bool_with(0.6) { cols_subset(g, 2) } else { vec![] };
    let k = g.int(0usize..=2);
    let uniques = (0..k).map(|i| (i as u8, cols_subset(g, 2))).collect();
    let k = g.int(0usize..=2);
    let checks = (0..k)
        .map(|i| Check {
            name: i as u8,
            col: g.int(0..=NC - 1),
            kind: match g.int(0u8..=3) {
                0 => CheckKind::Positive,
                1 => CheckKind::NotNull,
                2 => CheckKind::CallsFunc(g.int(0..=NF - 1)),
                _ => CheckKind::TwoCols(g.int(0..=NC - 1)),
            },
            no_inherit: g.bool_with(0.1),
        })
        .collect();
    let k = g.int(0usize..=2);
    let fks = (0..k)
        .map(|i| Fk {
            name: i as u8,
            col: g.int(0..=NC - 1),
            target: (g.int(0u8..=2), g.int(0..=NT - 1)),
            target_col: g.int(0..=NC - 1),
            on_delete: g.int(0u8..=4),
            deferrable: g.bool_with(0.2),
            not_valid: g.bool_with(0.1),
        })
        .collect();
    let k = g.int(0usize..=2);
    let indexes = (0..k)
        .map(|i| Index {
            name: i as u8,
            keys: (0..g.int(1usize..=2))
                .map(|_| match g.int(0u8..=5) {
                    0..=3 => IndexKey::Col(g.int(0..=NC - 1)),
                    4 => IndexKey::Lower(g.int(0..=NC - 1)),
                    _ => IndexKey::Func(g.int(0..=NF - 1), g.int(0..=NC - 1)),
                })
                .collect(),
            unique: g.bool_with(0.25),
            partial: opt(g, 0.2, |g| g.int(0..=NC - 1)),
            desc: g.bool_with(0.15),
            include: opt(g, 0.1, |g| g.int(0..=NC - 1)),
        })
        .collect();
    let rls = *g.pick(&[0u8, 0, 0, 1, 2]);
    let k = if g.bool_with(0.3) { g.int(1usize..=2) } else { 0 };
    let policies = (0..k)
        .map(|i| Policy {
            name: i as u8,
            cmd: g.int(0u8..=4),
            using_col: opt(g, 0.5, |g| g.int(0..=NC - 1)),
            permissive: g.bool_with(0.7),
            to_role: g.int(0u8..=3),
        })
        .collect();
    let k = if g.bool_with(0.3) { g.int(1usize..=2) } else { 0 };
    let triggers = (0..k)
        .map(|i| Trigger {
            name: i as u8,
            func: g.int(0..=NF - 1),
            before: g.bool(),
            events: g.int(1u8..=7),
            when_col: opt(g, 0.3, |g| g.int(0..=NC - 1)),
            of_col: opt(g, 0.25, |g| g.int(0..=NC - 1)),
            statement: g.bool_with(0.2),
            disabled: g.bool_with(0.15),
        })
        .collect();
    let k = if g.bool_with(0.3) { g.int(1usize..=2) } else { 0 };
    let grants = (0..k).map(|_| grant(g)).collect();
    Table {
        schema,
        name,
        cols,
        pk,
        uniques,
        checks,
        fks,
        indexes,
        rls,
        policies,
        triggers,
        grants,
        comment: opt(g, 0.15, |g| g.int(0u8..=2)),
        unlogged: g.bool_with(0.05),
        replica_full: g.bool_with(0.08),
        fillfactor: opt(g, 0.08, |g| g.int(0u8..=50)),
        unique_deferrable: g.bool_with(0.1),
        stats: if g.bool_with(0.1) { vec![(0, cols_subset(g, 3))] } else { vec![] },
    }
}

fn view(g: &mut Source, schema: u8, name: u8) -> View {
    View {
        schema,
        name,
        src: if g.bool_with(0.75) { ViewSrc::Table(g.int(0u8..=2), g.int(0..=NT - 1)) } else { ViewSrc::View(g.int(0u8..=2), g.int(0u8..=2)) },
        cols: cols_subset(g, 3),
        filter: opt(g, 0.3, |g| g.int(0..=NC - 1)),
        materialized: g.bool_with(0.2),
        security_barrier: g.bool_with(0.1),
        grants: if g.bool_with(0.2) { vec![grant(g)] } else { vec![] },
        comment: opt(g, 0.15, |g| g.int(0u8..=2)),
        calls_func: opt(g, 0.15, |g| g.int(0..=NF - 1)),
        mv_index: opt(g, 0.4, |g| g.int(0..=NC - 1)),
    }
}

fn func(g: &mut Source, name: u8) -> Func {
    Func {
        schema: *g.pick(&[0u8, 0, 1, 2]),
        name,
        body: match g.int(0u8..=5) {
            0 | 1 => FuncBody::PureSql(g.int(-3i8..=3)),
            2 => FuncBody::PurePlpgsql(g.int(-3i8..=3)),
            3 => FuncBody::Atomic(g.int(0u8..=2), g.int(0..=NT - 1)),
            _ => FuncBody::Trigger(g.int(0u8..=1)),
        },
        volatility: *g.pick(&[0u8, 0, 1, 2]),
        strict: g.bool_with(0.3),
        security_definer: g.bool_with(0.1),
        search_path: g.bool_with(0.15),
        revoke_public: g.bool_with(0.15),
        comment: opt(g, 0.1, |g| g.int(0u8..=2)),
    }
}

pub fn db(g: &mut Source) -> Db {
    let mut schemas = Vec::new();
    for s in 1u8..=2 {
        if g.bool_with(0.4) {
            schemas.push(s);
        }
    }
    let live = |g: &mut Source, schemas: &Vec<u8>| -> u8 {
        let mut opts = vec![0u8];
        opts.extend(schemas.iter().copied());
        *g.pick(&opts)
    };
    let enums = (0..g.int(0u8..=2))
        .map(|n| {
            let k = g.int(1usize..=4);
            let mut labels: Vec<u8> = Vec::new();
            while labels.len() < k {
                let l = g.int(0u8..=5);
                if !labels.contains(&l) {
                    labels.push(l);
                }
            }
            Enum { schema: live(g, &schemas), name: n, labels }
        })
        .collect();
    let domains = (0..g.int(0u8..=2))
        .map(|n| Domain { schema: live(g, &schemas), name: n, base: g.int(0u8..=2), not_null: g.bool_with(0.2), check: g.bool_with(0.5), default: g.bool_with(0.3) })
        .collect();
    let seqs = (0..g.int(0u8..=2))
        .map(|n| Seq {
            schema: live(g, &schemas),
            name: n,
            increment: *g.pick(&[1i8, 1, 2, -1, 10]),
            start: g.int(0u8..=100),
            cycle: g.bool_with(0.2),
            owned_by: opt(g, 0.3, |g| (g.int(0u8..=2), g.int(0..=NT - 1), g.int(0..=NC - 1))),
            as_type: *g.pick(&[0u8, 0, 1, 2]),
            max: opt(g, 0.2, |g| g.int(0u16..=30000)),
        })
        .collect();
    let funcs = (0..g.int(0u8..=NF)).map(|n| func(g, n)).collect();
    let mut tables = Vec::new();
    let nt = g.int(1usize..=4);
    for _ in 0..nt {
        let s = live(g, &schemas);
        let n = g.int(0..=NT - 1);
        if !tables.iter().any(|t: &Table| t.schema == s && t.name == n) {
            tables.push(table(g, s, n));
        }
    }
    let mut views = Vec::new();
    for _ in 0..g.int(0usize..=3) {
        let s = live(g, &schemas);
        let n = g.int(0u8..=2);
        if !views.iter().any(|v: &View| v.schema == s && v.name == n) {
            views.push(view(g, s, n));
        }
    }
    let schema_comments = if g.bool_with(0.1) { vec![(live(g, &schemas), g.int(0u8..=2))] } else { vec![] };
    let composites = (0..g.int(0u8..=2))
        .map(|n| Composite { schema: live(g, &schemas), name: n, attrs: (0..g.int(1u8..=3)).map(|a| (a, g.int(0u8..=2))).collect() })
        .collect();
    let mut d = Db { schemas, composites, enums, domains, seqs, funcs, tables, views, schema_comments };
    wire(g, &mut d);
    d
}

/// Make references resolve more often than chance would: FKs target a real
/// single-column key with a matching type, triggers call a trigger function,
/// identity columns have an integer type.
fn wire(g: &mut Source, d: &mut Db) {
    for t in d.tables.iter_mut() {
        for c in t.cols.iter_mut() {
            if matches!(c.generated, Some(Generated::Identity { .. })) {
                c.ty = *g.pick(&[Ty::Int, Ty::BigInt, Ty::SmallInt]);
            }
        }
    }
    let keys: Vec<(u8, u8, u8, Ty)> = d
        .tables
        .iter()
        .filter(|t| t.pk.len() == 1)
        .filter_map(|t| t.cols.iter().find(|c| c.name == t.pk[0] && !matches!(c.generated, Some(Generated::Stored { .. }))).map(|c| (t.schema, t.name, c.name, c.ty)))
        .collect();
    if !keys.is_empty() {
        for t in d.tables.iter_mut() {
            for fk in t.fks.iter_mut() {
                if !g.bool_with(0.8) {
                    continue;
                }
                let (s, n, c, ty) = keys[g.index(keys.len())];
                fk.target = (s, n);
                fk.target_col = c;
                if let Some(col) = t.cols.iter_mut().find(|x| x.name == fk.col) {
                    col.ty = ty;
                    if matches!(col.generated, Some(Generated::Identity { .. })) && !matches!(ty, Ty::Int | Ty::BigInt | Ty::SmallInt) {
                        col.generated = None;
                    }
                }
            }
        }
    }
    let trig: Vec<u8> = d.funcs.iter().filter(|f| matches!(f.body, FuncBody::Trigger(_))).map(|f| f.name).collect();
    let has_triggers = d.tables.iter().any(|t| !t.triggers.is_empty());
    if has_triggers {
        let trig = if trig.is_empty() {
            let free = (0..NF).find(|n| !d.funcs.iter().any(|f| f.name == *n));
            match free {
                Some(n) => {
                    let mut f = func(g, n);
                    f.body = FuncBody::Trigger(g.int(0u8..=1));
                    d.funcs.push(f);
                    vec![n]
                }
                None => vec![],
            }
        } else {
            trig
        };
        if !trig.is_empty() {
            for t in d.tables.iter_mut() {
                for tr in t.triggers.iter_mut() {
                    tr.func = trig[g.index(trig.len())];
                }
            }
        }
    }
}

/// One random edit of a schema: the kind of change a migration is made of.
fn edit(g: &mut Source, d: &mut Db) {
    let nt = d.tables.len();
    match g.int(0u8..=31) {
        0 if nt > 0 => {
            let i = g.index(nt);
            let t = &mut d.tables[i];
            let free: Vec<u8> = (0..NC).filter(|c| !t.cols.iter().any(|x| x.name == *c)).collect();
            if !free.is_empty() {
                let c = *g.pick(&free);
                t.cols.push(column(g, c));
            }
        }
        1 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            if t.cols.len() > 1 {
                t.cols.remove(g.index(t.cols.len()));
            }
        }
        2 | 3 if nt > 0 => {
            // type change
            let t = &mut d.tables[g.index(nt)];
            let k = g.index(t.cols.len());
            let new = match t.cols[k].ty {
                Ty::Int => *g.pick(&[Ty::BigInt, Ty::Text, Ty::Numeric(10, 2), Ty::SmallInt, Ty::Domain(0)]),
                Ty::SmallInt => *g.pick(&[Ty::Int, Ty::BigInt]),
                Ty::BigInt => *g.pick(&[Ty::Int, Ty::Text]),
                Ty::Varchar(n) => *g.pick(&[Ty::Text, Ty::Varchar(n.saturating_add(10)), Ty::Varchar(n.max(2) / 2)]),
                Ty::Text => *g.pick(&[Ty::Varchar(10), Ty::Int, Ty::Jsonb, Ty::Enum(0)]),
                Ty::Numeric(p, s) => *g.pick(&[Ty::Numeric(p + 2, s), Ty::Numeric(p, s + 1), Ty::Int]),
                Ty::Enum(_) => *g.pick(&[Ty::Text, Ty::Enum(1)]),
                Ty::Domain(_) => *g.pick(&[Ty::Int, Ty::Text, Ty::Domain(1)]),
                other => *g.pick(&[other, Ty::Text]),
            };
            t.cols[k].ty = new;
        }
        4 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            let k = g.index(t.cols.len());
            t.cols[k].not_null ^= true;
        }
        5 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            let k = g.index(t.cols.len());
            t.cols[k].default = if t.cols[k].default.is_some() && g.bool() { None } else { Some(default(g)) };
        }
        6 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            let k = g.index(t.cols.len());
            t.cols[k].generated = match t.cols[k].generated {
                Some(_) if g.bool() => None,
                Some(Generated::Identity { always }) => Some(Generated::Identity { always: !always }),
                _ => Some(if g.bool() { Generated::Identity { always: g.bool() } } else { Generated::Stored { from: g.int(0..=NC - 1) } }),
            };
        }
        7 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            t.pk = if t.pk.is_empty() || g.bool() { cols_subset(g, 2) } else { vec![] };
        }
        8 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            if !t.uniques.is_empty() && g.bool() {
                t.uniques.remove(g.index(t.uniques.len()));
            } else {
                let n = g.int(0u8..=2);
                t.uniques.retain(|(x, _)| *x != n);
                t.uniques.push((n, cols_subset(g, 2)));
            }
        }
        9 if nt > 0 => {
            let i = g.index(nt);
            let fresh = table(g, 0, 0).checks;
            let t = &mut d.tables[i];
            if !t.checks.is_empty() && g.bool() {
                t.checks.remove(g.index(t.checks.len()));
            } else if let Some(mut c) = fresh.into_iter().next() {
                c.name = g.int(0u8..=2);
                t.checks.retain(|x| x.name != c.name);
                t.checks.push(c);
            }
        }
        10 | 11 if nt > 0 => {
            let i = g.index(nt);
            let fresh = table(g, 0, 0);
            let t = &mut d.tables[i];
            if !t.fks.is_empty() && g.bool() {
                let k = g.index(t.fks.len());
                if g.bool() {
                    t.fks.remove(k);
                } else {
                    t.fks[k].on_delete = g.int(0u8..=4);
                    t.fks[k].deferrable ^= g.bool();
                }
            } else if let Some(mut f) = fresh.fks.into_iter().next() {
                f.name = g.int(0u8..=2);
                // aim at an existing table now and then
                if !d.tables.is_empty() && g.bool() {
                    let tt = &d.tables[g.index(d.tables.len())];
                    f.target = (tt.schema, tt.name);
                    if let Some(&pk) = tt.pk.first() {
                        f.target_col = pk;
                    }
                }
                let t = &mut d.tables[i];
                t.fks.retain(|x| x.name != f.name);
                t.fks.push(f);
            }
        }
        12 if nt > 0 => {
            let i = g.index(nt);
            let fresh = table(g, 0, 0).indexes;
            let t = &mut d.tables[i];
            if !t.indexes.is_empty() && g.bool() {
                let k = g.index(t.indexes.len());
                if g.bool() {
                    t.indexes.remove(k);
                } else {
                    t.indexes[k].unique ^= true;
                }
            } else if let Some(mut x) = fresh.into_iter().next() {
                x.name = g.int(0u8..=2);
                t.indexes.retain(|y| y.name != x.name);
                t.indexes.push(x);
            }
        }
        13 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            match g.int(0u8..=5) {
                0 => t.rls = g.int(0u8..=2),
                1 => t.comment = opt(g, 0.5, |g| g.int(0u8..=2)),
                2 => t.replica_full ^= true,
                3 => t.unlogged ^= true,
                4 => t.fillfactor = opt(g, 0.5, |g| g.int(0u8..=50)),
                _ => {
                    let k = g.index(t.cols.len());
                    t.cols[k].comment = opt(g, 0.5, |g| g.int(0u8..=2));
                }
            }
        }
        14 if nt > 0 => {
            let i = g.index(nt);
            let fresh = table(g, 0, 0);
            let t = &mut d.tables[i];
            match g.int(0u8..=2) {
                0 => {
                    t.policies = fresh.policies;
                    if t.policies.is_empty() {
                        t.policies.push(Policy { name: 0, cmd: g.int(0u8..=4), using_col: None, permissive: true, to_role: 0 });
                    }
                }
                1 => t.grants = fresh.grants,
                _ => t.triggers = fresh.triggers,
            }
        }
        15 => {
            // add or replace a whole table
            let mut opts = vec![0u8];
            opts.extend(d.schemas.iter().copied());
            let s = *g.pick(&opts);
            let n = g.int(0..=NT - 1);
            d.tables.retain(|t| !(t.schema == s && t.name == n));
            d.tables.push(table(g, s, n));
        }
        16 if nt > 1 => {
            d.tables.remove(g.index(nt));
        }
        17 => {
            // enum label changes: append, insert, remove, reorder
            if d.enums.is_empty() {
                d.enums.push(Enum { schema: 0, name: g.int(0u8..=1), labels: vec![0, 1] });
            }
            let k = g.index(d.enums.len());
            let e = &mut d.enums[k];
            let free: Vec<u8> = (0..6).filter(|l| !e.labels.contains(l)).collect();
            match g.int(0u8..=3) {
                0 | 1 if !free.is_empty() => {
                    let l = *g.pick(&free);
                    let at = g.int(0..=e.labels.len());
                    e.labels.insert(at, l);
                }
                2 if e.labels.len() > 1 => {
                    e.labels.remove(g.index(e.labels.len()));
                }
                _ if e.labels.len() > 1 => {
                    e.labels.swap(0, 1);
                }
                _ => {}
            }
        }
        18 => {
            if d.domains.is_empty() || g.bool_with(0.3) {
                d.domains.push(Domain { schema: 0, name: (d.domains.len() as u8).min(1), base: g.int(0u8..=2), not_null: false, check: true, default: false });
            } else {
                let k = g.index(d.domains.len());
                let x = &mut d.domains[k];
                match g.int(0u8..=3) {
                    0 => x.check ^= true,
                    1 => x.not_null ^= true,
                    2 => x.default ^= true,
                    _ => x.base = g.int(0u8..=2),
                }
            }
        }
        19 => {
            let n = g.int(0..=NF - 1);
            d.funcs.retain(|f| f.name != n);
            if g.bool_with(0.8) {
                d.funcs.push(func(g, n));
            }
        }
        20 if !d.funcs.is_empty() => {
            let k = g.index(d.funcs.len());
            let f = &mut d.funcs[k];
            match g.int(0u8..=5) {
                0 => f.volatility = g.int(0u8..=2),
                1 => f.strict ^= true,
                2 => f.security_definer ^= true,
                3 => f.revoke_public ^= true,
                4 => f.search_path ^= true,
                _ => {
                    f.body = match f.body {
                        FuncBody::PureSql(k) => FuncBody::PureSql(k.wrapping_add(1)),
                        FuncBody::PurePlpgsql(k) => FuncBody::PurePlpgsql(k.wrapping_sub(1)),
                        FuncBody::Trigger(k) => FuncBody::Trigger(k ^ 1),
                        FuncBody::Atomic(s, n) => FuncBody::Atomic(s, (n + 1) % NT),
                    }
                }
            }
        }
        21 | 22 => {
            let s = if d.schemas.is_empty() { 0 } else { *g.pick(&[0, d.schemas[0]]) };
            let n = g.int(0u8..=2);
            let existing = d.views.iter().position(|v| v.schema == s && v.name == n);
            match existing {
                Some(k) if g.bool() => {
                    let v = &mut d.views[k];
                    match g.int(0u8..=4) {
                        0 => v.cols = cols_subset(g, 3),
                        1 => v.filter = opt(g, 0.5, |g| g.int(0..=NC - 1)),
                        2 => v.materialized ^= true,
                        3 => v.comment = opt(g, 0.5, |g| g.int(0u8..=2)),
                        _ => {
                            d.views.remove(k);
                        }
                    }
                }
                _ => {
                    d.views.retain(|v| !(v.schema == s && v.name == n));
                    let mut v = view(g, s, n);
                    if !d.tables.is_empty() && g.bool() {
                        let t = &d.tables[g.index(d.tables.len())];
                        v.src = ViewSrc::Table(t.schema, t.name);
                    }
                    d.views.push(v);
                }
            }
        }
        23 => {
            let s = g.int(1u8..=2);
            if d.schemas.contains(&s) {
                if g.bool_with(0.3) {
                    d.schemas.retain(|x| *x != s);
                }
            } else {
                d.schemas.push(s);
            }
        }
        24 => {
            if d.seqs.is_empty() || g.bool_with(0.3) {
                d.seqs.push(Seq { schema: 0, name: (d.seqs.len() as u8).min(1), increment: 1, start: 0, cycle: false, owned_by: None, as_type: 0, max: None });
            } else {
                let k = g.index(d.seqs.len());
                let s = &mut d.seqs[k];
                match g.int(0u8..=4) {
                    0 => s.increment = *g.pick(&[1i8, 5, -1]),
                    1 => s.cycle ^= true,
                    2 => s.as_type = g.int(0u8..=2),
                    3 => s.max = opt(g, 0.5, |g| g.int(0u16..=30000)),
                    _ => s.owned_by = opt(g, 0.5, |g| (0, g.int(0..=NT - 1), g.int(0..=NC - 1))),
                }
            }
        }
        25 if nt > 0 => {
            // move a table to another schema (same name)
            let k = g.index(nt);
            let mut opts = vec![0u8];
            opts.extend(d.schemas.iter().copied());
            let s = *g.pick(&opts);
            let n = d.tables[k].name;
            if !d.tables.iter().any(|t| t.schema == s && t.name == n) {
                d.tables[k].schema = s;
            }
        }
        26 if nt > 0 => {
            // reorder columns (a rebuild for pg-delta)
            let t = &mut d.tables[g.index(nt)];
            if t.cols.len() > 1 {
                let a = g.index(t.cols.len());
                let b = g.index(t.cols.len());
                t.cols.swap(a, b);
            }
        }
        27 => {
            // composite type attributes: add, drop, retype
            if d.composites.is_empty() || g.bool_with(0.2) {
                let n = g.int(0u8..=1);
                d.composites.retain(|c| c.name != n);
                d.composites.push(Composite { schema: 0, name: n, attrs: vec![(0, g.int(0u8..=2))] });
            } else {
                let k = g.index(d.composites.len());
                let c = &mut d.composites[k];
                match g.int(0u8..=2) {
                    0 => {
                        let a = g.int(0u8..=4);
                        if !c.attrs.iter().any(|x| x.0 == a) {
                            c.attrs.push((a, g.int(0u8..=2)));
                        }
                    }
                    1 if c.attrs.len() > 1 => {
                        c.attrs.remove(g.index(c.attrs.len()));
                    }
                    _ => {
                        let i = g.index(c.attrs.len());
                        c.attrs[i].1 = (c.attrs[i].1 + 1) % 3;
                    }
                }
            }
        }
        28 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            let k = g.index(t.cols.len());
            match g.int(0u8..=2) {
                0 => t.cols[k].storage = opt(g, 0.6, |g| g.int(0u8..=2)),
                1 => t.cols[k].stats_target = opt(g, 0.6, |g| g.int(0u16..=1500)),
                _ => t.cols[k].ident_opts = opt(g, 0.6, |g| g.int(0u8..=50)),
            }
        }
        29 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            match g.int(0u8..=1) {
                0 => t.unique_deferrable ^= true,
                _ => t.stats = if t.stats.is_empty() { vec![(g.int(0u8..=1), cols_subset(g, 3))] } else { vec![] },
            }
        }
        30 if nt > 0 => {
            let t = &mut d.tables[g.index(nt)];
            if t.triggers.is_empty() {
                t.triggers.push(Trigger { name: 0, func: g.int(0..=NF - 1), before: g.bool(), events: 3, when_col: None, of_col: None, statement: false, disabled: false });
            }
            let k = g.index(t.triggers.len());
            let tr = &mut t.triggers[k];
            match g.int(0u8..=3) {
                0 => tr.disabled ^= true,
                1 => tr.statement ^= true,
                2 => tr.of_col = opt(g, 0.6, |g| g.int(0..=NC - 1)),
                _ => tr.events = g.int(1u8..=7),
            }
        }
        31 if !d.views.is_empty() => {
            let k = g.index(d.views.len());
            d.views[k].mv_index = opt(g, 0.6, |g| g.int(0..=NC - 1));
        }
        _ => {
            d.schema_comments = if d.schema_comments.is_empty() { vec![(0, g.int(0u8..=2))] } else { vec![] };
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
        write!(f, "\n-- compact: {}\n-- A:\n{}-- B:\n{}", self.compact, crate::render::render(&self.a), crate::render::render(&self.b))
    }
}

pub fn pair(g: &mut Source) -> Pair {
    let a = db(g);
    let b = if g.bool_with(0.1) {
        db(g)
    } else {
        let mut b = a.clone();
        let n = g.int(1usize..=(2 + g.size().min(6)));
        for _ in 0..n {
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
    macro_rules! drop_each {
        ($field:ident) => {
            for i in 0..t.$field.len() {
                let mut x = t.clone();
                x.$field.remove(i);
                out.push(x);
            }
        };
    }
    drop_each!(fks);
    drop_each!(checks);
    drop_each!(indexes);
    drop_each!(policies);
    drop_each!(triggers);
    drop_each!(grants);
    drop_each!(uniques);
    if t.cols.len() > 1 {
        drop_each!(cols);
    }
    if !t.pk.is_empty() {
        let mut x = t.clone();
        x.pk.clear();
        out.push(x);
    }
    macro_rules! clear {
        ($cond:expr, $set:expr) => {
            if $cond {
                let mut x = t.clone();
                $set(&mut x);
                out.push(x);
            }
        };
    }
    clear!(t.rls > 0, |x: &mut Table| x.rls = 0);
    clear!(t.comment.is_some(), |x: &mut Table| x.comment = None);
    clear!(t.unlogged, |x: &mut Table| x.unlogged = false);
    clear!(t.replica_full, |x: &mut Table| x.replica_full = false);
    clear!(t.fillfactor.is_some(), |x: &mut Table| x.fillfactor = None);
    clear!(t.unique_deferrable, |x: &mut Table| x.unique_deferrable = false);
    clear!(!t.stats.is_empty(), |x: &mut Table| x.stats.clear());
    for (i, tr) in t.triggers.iter().enumerate() {
        let mut push = |f: &dyn Fn(&mut Trigger)| {
            let mut x = t.clone();
            f(&mut x.triggers[i]);
            out.push(x);
        };
        if tr.disabled {
            push(&|t| t.disabled = false);
        }
        if tr.statement {
            push(&|t| t.statement = false);
        }
        if tr.of_col.is_some() {
            push(&|t| t.of_col = None);
        }
        if tr.when_col.is_some() {
            push(&|t| t.when_col = None);
        }
    }
    for (i, c) in t.cols.iter().enumerate() {
        let mut push = |f: &dyn Fn(&mut Column)| {
            let mut x = t.clone();
            f(&mut x.cols[i]);
            out.push(x);
        };
        if c.default.is_some() {
            push(&|c| c.default = None);
        }
        if c.generated.is_some() {
            push(&|c| c.generated = None);
        }
        if c.not_null {
            push(&|c| c.not_null = false);
        }
        if c.comment.is_some() {
            push(&|c| c.comment = None);
        }
        if c.collate_c {
            push(&|c| c.collate_c = false);
        }
        if c.storage.is_some() {
            push(&|c| c.storage = None);
        }
        if c.stats_target.is_some() {
            push(&|c| c.stats_target = None);
        }
        if c.ident_opts.is_some() {
            push(&|c| c.ident_opts = None);
        }
    }
    out
}

fn shrink_view(v: &View) -> Vec<View> {
    let mut out = Vec::new();
    let mut push = |f: &dyn Fn(&mut View)| {
        let mut x = v.clone();
        f(&mut x);
        out.push(x);
    };
    if v.filter.is_some() {
        push(&|v| v.filter = None);
    }
    if v.comment.is_some() {
        push(&|v| v.comment = None);
    }
    if v.calls_func.is_some() {
        push(&|v| v.calls_func = None);
    }
    if v.mv_index.is_some() {
        push(&|v| v.mv_index = None);
    }
    if !v.grants.is_empty() {
        push(&|v| v.grants.clear());
    }
    if v.materialized {
        push(&|v| v.materialized = false);
    }
    if v.security_barrier {
        push(&|v| v.security_barrier = false);
    }
    for i in 0..v.cols.len() {
        if v.cols.len() > 1 {
            let mut x = v.clone();
            x.cols.remove(i);
            out.push(x);
        }
    }
    out
}

/// Strictly smaller single-sided variants of a schema.
pub fn shrink_db(d: &Db) -> Vec<Db> {
    let mut out = Vec::new();
    macro_rules! drop_each {
        ($field:ident) => {
            for i in 0..d.$field.len() {
                let mut x = d.clone();
                x.$field.remove(i);
                out.push(x);
            }
        };
    }
    drop_each!(tables);
    drop_each!(views);
    drop_each!(funcs);
    drop_each!(enums);
    drop_each!(domains);
    drop_each!(seqs);
    drop_each!(schema_comments);
    drop_each!(schemas);
    drop_each!(composites);
    for (i, c) in d.composites.iter().enumerate() {
        if c.attrs.len() > 1 {
            for k in 0..c.attrs.len() {
                let mut x = d.clone();
                x.composites[i].attrs.remove(k);
                out.push(x);
            }
        }
    }
    for (i, t) in d.tables.iter().enumerate() {
        for s in shrink_table(t) {
            let mut x = d.clone();
            x.tables[i] = s;
            out.push(x);
        }
    }
    for (i, v) in d.views.iter().enumerate() {
        for s in shrink_view(v) {
            let mut x = d.clone();
            x.views[i] = s;
            out.push(x);
        }
    }
    for (i, e) in d.enums.iter().enumerate() {
        if e.labels.len() > 1 {
            for k in 0..e.labels.len() {
                let mut x = d.clone();
                x.enums[i].labels.remove(k);
                out.push(x);
            }
        }
    }
    for (i, f) in d.funcs.iter().enumerate() {
        let mut push = |g: &dyn Fn(&mut Func)| {
            let mut x = d.clone();
            g(&mut x.funcs[i]);
            out.push(x);
        };
        if f.strict {
            push(&|f| f.strict = false);
        }
        if f.security_definer {
            push(&|f| f.security_definer = false);
        }
        if f.search_path {
            push(&|f| f.search_path = false);
        }
        if f.revoke_public {
            push(&|f| f.revoke_public = false);
        }
        if f.comment.is_some() {
            push(&|f| f.comment = None);
        }
    }
    for (i, s) in d.seqs.iter().enumerate() {
        if s.owned_by.is_some() {
            let mut x = d.clone();
            x.seqs[i].owned_by = None;
            out.push(x);
        }
        if s.max.is_some() {
            let mut x = d.clone();
            x.seqs[i].max = None;
            out.push(x);
        }
        if s.as_type != 0 {
            let mut x = d.clone();
            x.seqs[i].as_type = 0;
            out.push(x);
        }
    }
    for (i, dm) in d.domains.iter().enumerate() {
        let mut push = |g: &dyn Fn(&mut Domain)| {
            let mut x = d.clone();
            g(&mut x.domains[i]);
            out.push(x);
        };
        if dm.check {
            push(&|d| d.check = false);
        }
        if dm.not_null {
            push(&|d| d.not_null = false);
        }
        if dm.default {
            push(&|d| d.default = false);
        }
    }
    out
}

/// Removing the same table/view/function from both sides first keeps the
/// difference while the context shrinks; then each side alone.
pub fn shrink_pair(p: &Pair) -> Vec<Pair> {
    let mut out = Vec::new();
    let mut tkeys: Vec<(u8, u8)> = p.a.tables.iter().chain(p.b.tables.iter()).map(|t| (t.schema, t.name)).collect();
    tkeys.dedup();
    for (s, n) in tkeys {
        let mut x = p.clone();
        x.a.tables.retain(|t| !(t.schema == s && t.name == n));
        x.b.tables.retain(|t| !(t.schema == s && t.name == n));
        if x.a.tables.len() + x.b.tables.len() < p.a.tables.len() + p.b.tables.len() && (x.a.tables.len() < p.a.tables.len() && x.b.tables.len() < p.b.tables.len()) {
            out.push(x);
        }
    }
    let mut vkeys: Vec<(u8, u8)> = p.a.views.iter().chain(p.b.views.iter()).map(|v| (v.schema, v.name)).collect();
    vkeys.dedup();
    for (s, n) in vkeys {
        let mut x = p.clone();
        x.a.views.retain(|v| !(v.schema == s && v.name == n));
        x.b.views.retain(|v| !(v.schema == s && v.name == n));
        if x.a.views.len() < p.a.views.len() && x.b.views.len() < p.b.views.len() {
            out.push(x);
        }
    }
    for n in 0..NF {
        let mut x = p.clone();
        x.a.funcs.retain(|f| f.name != n);
        x.b.funcs.retain(|f| f.name != n);
        if x.a.funcs.len() < p.a.funcs.len() && x.b.funcs.len() < p.b.funcs.len() {
            out.push(x);
        }
    }
    // the same table edited the same way on both sides
    for (i, ta) in p.a.tables.iter().enumerate() {
        if let Some(j) = p.b.tables.iter().position(|t| t.schema == ta.schema && t.name == ta.name) {
            let sa = shrink_table(ta);
            let sb = shrink_table(&p.b.tables[j]);
            for (xa, xb) in sa.into_iter().zip(sb) {
                if xa.cols.len() == ta.cols.len() || true {
                    let mut x = p.clone();
                    x.a.tables[i] = xa;
                    x.b.tables[j] = xb;
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
    out
}

pub fn pair_size(p: &Pair) -> u64 {
    p.a.size() + p.b.size()
}

// ------------------------------------------------------------------ known bugs

/// The SQL of the action an `apply_error` failed at.
fn failed_action(o: &crate::Outcome) -> &str {
    let idx = o.detail.strip_prefix("action ").and_then(|s| s.split(':').next()).unwrap_or("");
    let prefix = format!("  {idx}: ");
    o.detail.lines().find_map(|l| l.strip_prefix(prefix.as_str())).unwrap_or("")
}

/// Bugs already found, reported and pinned in tests/regressions.rs. Matched
/// narrowly on the failing statement so a new bug with a similar message
/// still fails the property. Remove an entry once its bug is fixed.
pub fn known_bug(o: &crate::Outcome) -> Option<&'static str> {
    let drift: Vec<&str> = o.detail.lines().take_while(|l| !l.starts_with("plan:")).filter(|l| l.trim_start().starts_with("set ")).collect();
    if o.kind == "drift" && !drift.is_empty() && drift.iter().all(|l| l.contains(".collation: null -> ")) && o.detail.contains(" TYPE ") {
        return Some("retype drops the column collation");
    }
    if o.kind == "data_loss" && o.detail.contains(" DROP COLUMN ") && o.detail.contains(" ADD COLUMN ") && o.detail.contains(" COLLATE ") {
        return Some("collation change drops and re-adds the column");
    }
    if o.kind == "undeclared_rewrite" && o.detail.contains(" ADD COLUMN ") && o.detail.contains("CREATE DOMAIN") {
        return Some("ADD COLUMN of a constrained domain rewrites undeclared");
    }
    if o.kind != "apply_error" {
        return None;
    }
    let first = o.detail.lines().next().unwrap_or("");
    let sql = failed_action(o);
    if first.contains("cannot cast type") && sql.contains(" TYPE ") && sql.contains(" USING ") {
        return Some("retype without a cast");
    }
    if sql.contains("ADD GENERATED") && (first.contains("must be declared NOT NULL before identity") || first.contains("identity column type must be") || first.contains("is out of range for sequence data type")) {
        return Some("identity added before NOT NULL / retype");
    }
    if sql.contains("SET DEFAULT") && (first.contains("default expression is of type") || first.contains("does not exist")) {
        return Some("default set before its type / retype");
    }
    if first.contains("foreign key constraint") && first.contains("cannot be implemented") && sql.contains(" TYPE ") {
        return Some("FK across a retype of both ends");
    }
    if first.contains("used in a policy definition") && o.detail.contains("__pgdelta_replaced") {
        return Some("enum rebuild with a dependent policy");
    }
    None
}


/// `migration_converges` with a real row in every source table: the same
/// known bugs and intended refusals as tests/props.rs.
pub fn check_rows(p: &Pair) {
    let o = crate::migrate_rows(&crate::render::render(&p.a), &crate::render::render(&p.b), p.compact, "stock");
    ephyra::classify(o.kind == "data_hazard", "data hazard (fails only with seeded rows)");
    let refused = o.kind == "plan_throw"
        && (o.detail.contains("cannot replace an in-use domain") || (o.detail.contains("composite type") && o.detail.contains("while the type is used by table columns")));
    let known = known_bug(&o);
    if let Some(k) = known {
        ephyra::classify(true, k);
    }
    match o.verdict.as_str() {
        "pass" => {}
        _ if refused || known.is_some() => {}
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

pub fn pairs() -> impl ephyra::Gen<Value = Pair> {
    use ephyra::GenExt;
    (|g: &mut Source| pair(g)).with_shrink(|p: &Pair, visit: &mut dyn FnMut(Pair) -> std::ops::ControlFlow<()>| {
        for c in shrink_pair(p) {
            visit(c)?;
        }
        std::ops::ControlFlow::Continue(())
    })
}
