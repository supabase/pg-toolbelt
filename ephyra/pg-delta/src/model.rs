//! A name-keyed model of a Postgres schema. References (FKs, views, defaults,
//! generated columns, ...) are by name, and the renderer drops any reference
//! that does not resolve, so every value of the model, including every shrink
//! candidate, renders to SQL that loads.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ty {
    Int,
    BigInt,
    SmallInt,
    Text,
    Varchar(u16),
    Numeric(u8, u8),
    Bool,
    Jsonb,
    Timestamptz,
    Uuid,
    IntArr,
    TextArr,
    /// index into `Db::enums` by name lookup at render time
    Enum(u8),
    Domain(u8),
    Composite(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Default {
    Const,
    Alt,
    Func,
    NextVal(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub enum Generated {
    Identity { always: bool },
    Stored { from: u8 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Column {
    pub name: u8,
    pub ty: Ty,
    pub not_null: bool,
    pub default: Option<Default>,
    pub generated: Option<Generated>,
    pub comment: Option<u8>,
    pub collate_c: bool,
    /// 0 EXTERNAL, 1 MAIN, 2 EXTENDED (varlena types only)
    pub storage: Option<u8>,
    pub stats_target: Option<u16>,
    /// identity START WITH / INCREMENT BY
    pub ident_opts: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CheckKind {
    Positive,
    NotNull,
    CallsFunc(u8),
    TwoCols(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Check {
    pub name: u8,
    pub col: u8,
    pub kind: CheckKind,
    pub no_inherit: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Fk {
    pub name: u8,
    pub col: u8,
    pub target: (u8, u8),
    pub target_col: u8,
    pub on_delete: u8,
    pub deferrable: bool,
    pub not_valid: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum IndexKey {
    Col(u8),
    Lower(u8),
    Func(u8, u8),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Index {
    pub name: u8,
    pub keys: Vec<IndexKey>,
    pub unique: bool,
    pub partial: Option<u8>,
    pub desc: bool,
    pub include: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub name: u8,
    pub cmd: u8,
    pub using_col: Option<u8>,
    pub permissive: bool,
    pub to_role: u8,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Trigger {
    pub name: u8,
    pub func: u8,
    pub before: bool,
    pub events: u8,
    pub when_col: Option<u8>,
    pub of_col: Option<u8>,
    pub statement: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub role: u8,
    pub privs: u8,
    pub col: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub schema: u8,
    pub name: u8,
    pub cols: Vec<Column>,
    pub pk: Vec<u8>,
    pub uniques: Vec<(u8, Vec<u8>)>,
    pub checks: Vec<Check>,
    pub fks: Vec<Fk>,
    pub indexes: Vec<Index>,
    pub rls: u8,
    pub policies: Vec<Policy>,
    pub triggers: Vec<Trigger>,
    pub grants: Vec<Grant>,
    pub comment: Option<u8>,
    pub unlogged: bool,
    pub replica_full: bool,
    pub fillfactor: Option<u8>,
    pub unique_deferrable: bool,
    /// extended statistics: (name, columns)
    pub stats: Vec<(u8, Vec<u8>)>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ViewSrc {
    Table(u8, u8),
    View(u8, u8),
}

#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub schema: u8,
    pub name: u8,
    pub src: ViewSrc,
    pub cols: Vec<u8>,
    pub filter: Option<u8>,
    pub materialized: bool,
    pub security_barrier: bool,
    pub grants: Vec<Grant>,
    pub comment: Option<u8>,
    pub calls_func: Option<u8>,
    /// index on a materialized view column
    pub mv_index: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Enum {
    pub schema: u8,
    pub name: u8,
    pub labels: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Domain {
    pub schema: u8,
    pub name: u8,
    pub base: u8,
    pub not_null: bool,
    pub check: bool,
    pub default: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Seq {
    pub schema: u8,
    pub name: u8,
    pub increment: i8,
    pub start: u8,
    pub cycle: bool,
    pub owned_by: Option<(u8, u8, u8)>,
    /// 0 bigint, 1 integer, 2 smallint
    pub as_type: u8,
    pub max: Option<u16>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum FuncBody {
    /// int -> int, language sql, immutable
    PureSql(i8),
    /// int -> int, plpgsql
    PurePlpgsql(i8),
    /// BEGIN ATOMIC reading a table (pg_depend-tracked)
    Atomic(u8, u8),
    /// trigger function
    Trigger(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Func {
    pub schema: u8,
    pub name: u8,
    pub body: FuncBody,
    pub volatility: u8,
    pub strict: bool,
    pub security_definer: bool,
    pub search_path: bool,
    pub revoke_public: bool,
    pub comment: Option<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Composite {
    pub schema: u8,
    pub name: u8,
    /// (attribute name, 0 integer / 1 text / 2 boolean)
    pub attrs: Vec<(u8, u8)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Db {
    pub schemas: Vec<u8>,
    pub composites: Vec<Composite>,
    pub enums: Vec<Enum>,
    pub domains: Vec<Domain>,
    pub seqs: Vec<Seq>,
    pub funcs: Vec<Func>,
    pub tables: Vec<Table>,
    pub views: Vec<View>,
    pub schema_comments: Vec<(u8, u8)>,
}

pub const SCHEMAS: [&str; 3] = ["public", "app", "aux"];
pub const ROLES: [&str; 4] = ["PUBLIC", "pg_read_all_data", "pg_monitor", "pg_write_all_data"];
pub const LABELS: [&str; 6] = ["red", "green", "blue", "cyan", "magenta", "yellow"];
pub const COMMENTS: [&str; 3] = ["first comment", "it's quoted", "third"];

impl Db {
    pub fn table(&self, s: u8, n: u8) -> Option<&Table> {
        self.tables.iter().find(|t| t.schema == s && t.name == n)
    }
    pub fn view(&self, s: u8, n: u8) -> Option<&View> {
        self.views.iter().find(|v| v.schema == s && v.name == n)
    }
    /// Object count, the shrink size.
    pub fn size(&self) -> u64 {
        let t: u64 = self
            .tables
            .iter()
            .map(|t| {
                1 + t.cols.len() as u64 * 2
                    + t.cols.iter().map(|c| c.default.is_some() as u64 + c.generated.is_some() as u64 + c.not_null as u64 + c.comment.is_some() as u64 + c.collate_c as u64 + c.storage.is_some() as u64 + c.stats_target.is_some() as u64 + c.ident_opts.is_some() as u64).sum::<u64>()
                    + t.pk.len() as u64
                    + t.uniques.len() as u64
                    + t.checks.len() as u64
                    + t.fks.len() as u64
                    + t.indexes.len() as u64
                    + t.rls as u64
                    + t.policies.len() as u64
                    + t.triggers.len() as u64
                    + t.grants.len() as u64
                    + t.comment.is_some() as u64
                    + t.unlogged as u64
                    + t.replica_full as u64
                    + t.fillfactor.is_some() as u64
                    + t.unique_deferrable as u64
                    + t.stats.len() as u64
                    + t.triggers.iter().map(|x| x.of_col.is_some() as u64 + x.statement as u64 + x.disabled as u64 + x.when_col.is_some() as u64).sum::<u64>()
            })
            .sum();
        t + self.views.iter().map(|v| 2 + v.cols.len() as u64 + v.grants.len() as u64 + v.filter.is_some() as u64 + v.comment.is_some() as u64 + v.calls_func.is_some() as u64 + v.mv_index.is_some() as u64 + v.security_barrier as u64 + v.materialized as u64).sum::<u64>()
            + self.enums.iter().map(|e| 1 + e.labels.len() as u64).sum::<u64>()
            + self.domains.len() as u64 * 2
            + self.seqs.iter().map(|q| 2 + q.owned_by.is_some() as u64 + q.max.is_some() as u64 + (q.as_type != 0) as u64 + q.cycle as u64).sum::<u64>()
            + self.funcs.len() as u64 * 2
            + self.schemas.len() as u64
            + self.composites.iter().map(|c| 1 + c.attrs.len() as u64).sum::<u64>()
            + self.schema_comments.len() as u64
    }
}
