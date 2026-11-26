use serde::Deserialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Deserialize, Clone)]
pub struct Ordered {
    pub sql: String,
    pub file: String,
    pub index: usize,
    pub cls: String,
    #[serde(default)]
    pub provides: Vec<Prov>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Prov {
    pub kind: String,
    pub schema: Option<String>,
    pub name: String,
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Diag {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct TopoResult {
    pub ok: bool,
    #[serde(default)]
    pub ordered: Vec<Ordered>,
    #[serde(default)]
    pub diagnostics: Vec<Diag>,
    #[serde(default)]
    pub error: Option<String>,
    /// (producer sql, consumer sql)
    #[serde(default)]
    pub edges: Vec<(String, String)>,
    #[serde(default)]
    pub cycles: Vec<Vec<String>>,
}

struct Worker {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

fn worker() -> &'static Mutex<Worker> {
    static W: OnceLock<Mutex<Worker>> = OnceLock::new();
    W.get_or_init(|| {
        // CI runs prebuilt test binaries from another checkout, so the compile-time path can be overridden
        let path = std::env::var("PGTOPO_WORKER").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/worker.ts").to_string());
        let mut child = Command::new("bun")
            .arg(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn bun worker");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Mutex::new(Worker { _child: child, stdin, stdout })
    })
}

pub fn analyze(sql: &[String]) -> TopoResult {
    analyze_mode(sql, "strings")
}

pub fn analyze_mode(sql: &[String], mode: &str) -> TopoResult {
    analyze_with(sql, mode, serde_json::Value::Null)
}

/// `options` is passed to analyzeAndSort as-is (e.g. `{"externalProviders": [...]}`).
pub fn analyze_with(sql: &[String], mode: &str, options: serde_json::Value) -> TopoResult {
    let mut w = worker().lock().unwrap_or_else(|e| e.into_inner());
    let req = serde_json::json!({ "sql": sql, "mode": mode, "options": options });
    writeln!(w.stdin, "{req}").unwrap();
    w.stdin.flush().unwrap();
    let mut line = String::new();
    w.stdout.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap_or_else(|e| panic!("bad worker output {e}: {line}"))
}

fn pg() -> &'static Mutex<postgres::Client> {
    static C: OnceLock<Mutex<postgres::Client>> = OnceLock::new();
    C.get_or_init(|| {
        let url = std::env::var("PGTOPO_PG")
            .unwrap_or_else(|_| "host=127.0.0.1 port=5432 user=postgres password=postgres dbname=postgres".into());
        Mutex::new(postgres::Client::connect(&url, postgres::NoTls).expect("connect pg"))
    })
}

/// Executes statements in order inside a rolled-back transaction.
/// Returns Err((index, message)) for the first failing statement.
pub fn execute(stmts: &[String]) -> Result<(), (usize, String)> {
    let mut c = pg().lock().unwrap_or_else(|e| e.into_inner());
    c.batch_execute("ROLLBACK; BEGIN; SET LOCAL check_function_bodies = on;").unwrap();
    let mut res = Ok(());
    for (i, s) in stmts.iter().enumerate() {
        if let Err(e) = c.batch_execute(s) {
            let msg = e.as_db_error().map(|d| d.message().to_string()).unwrap_or_else(|| e.to_string());
            res = Err((i, msg));
            break;
        }
    }
    let _ = c.batch_execute("ROLLBACK");
    res
}

// dump cases commit roles and databases, so they use their own cluster
fn admin_url(db: &str) -> String {
    let port = std::env::var("PGTOPO_DUMP_PORT").unwrap_or_else(|_| "55452".into());
    format!("host=127.0.0.1 port={port} user=postgres password=pg dbname={db}")
}

/// Builds `stmts` in a fresh database `<tag>_src`, returns `pg_dump --schema-only` text.
/// Roles named in `roles` are dropped afterwards (they are cluster-wide).
pub fn dump_schema(tag: &str, stmts: &[String]) -> Result<String, String> {
    let src = format!("{tag}_src");
    let mut admin = postgres::Client::connect(&admin_url("postgres"), postgres::NoTls).map_err(|e| e.to_string())?;
    let dberr = |e: postgres::Error| e.as_db_error().map(|d| d.message().to_string()).unwrap_or_else(|| e.to_string());
    admin.batch_execute(&format!("DROP DATABASE IF EXISTS {src} WITH (FORCE)")).map_err(dberr)?;
    admin.batch_execute(&format!("CREATE DATABASE {src}")).map_err(dberr)?;
    let res = (|| {
        let mut c = postgres::Client::connect(&admin_url(&src), postgres::NoTls).map_err(|e| e.to_string())?;
        for s in stmts {
            c.batch_execute(s).map_err(|e| format!("build: {}: {s}", dberr(e)))?;
        }
        drop(c);
        let out = Command::new("docker")
            .args(["exec", &std::env::var("PGTOPO_DUMP_CONTAINER").unwrap_or_else(|_| "pgtopo-dump".into()), "pg_dump", "-U", "postgres", "--schema-only", "--no-comments", &src])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        // pg_dump 17 emits psql meta-commands (\restrict / \unrestrict); they are not SQL
        let text = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| !l.starts_with('\\'))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(text)
    })();
    let _ = admin.batch_execute(&format!("DROP DATABASE IF EXISTS {src} WITH (FORCE)"));
    res
}

/// Drops the roles a dump case committed (roles are cluster-wide).
pub fn drop_test_roles() {
    if let Ok(mut admin) = postgres::Client::connect(&admin_url("postgres"), postgres::NoTls) {
        // only roles the generator names (role_N, ROLE_N, "role N.x")
        if let Ok(rows) = admin.query("select rolname from pg_roles where lower(rolname) ~ '^role_ ?[0-9]'", &[]) {
            for r in rows {
                let n: String = r.get(0);
                let _ = admin.batch_execute(&format!("DROP ROLE IF EXISTS \"{}\"", n.replace('"', "\"\"")));
            }
        }
    }
}

/// Executes in database `<tag>_dst` (created empty if missing) inside a rolled-back transaction.
pub fn execute_in(tag: &str, stmts: &[String]) -> Result<(), (usize, String)> {
    let dst = format!("{tag}_dst");
    let mut admin = postgres::Client::connect(&admin_url("postgres"), postgres::NoTls).expect("admin");
    let exists = admin.query_opt("select 1 from pg_database where datname = $1", &[&dst]).unwrap().is_some();
    if !exists {
        admin.batch_execute(&format!("CREATE DATABASE {dst}")).unwrap();
    }
    let mut c = postgres::Client::connect(&admin_url(&dst), postgres::NoTls).expect("dst");
    c.batch_execute("BEGIN").unwrap();
    let mut res = Ok(());
    for (i, s) in stmts.iter().enumerate() {
        if let Err(e) = c.batch_execute(s) {
            let msg = e.as_db_error().map(|d| d.message().to_string()).unwrap_or_else(|| e.to_string());
            res = Err((i, msg));
            break;
        }
    }
    let _ = c.batch_execute("ROLLBACK");
    res
}
