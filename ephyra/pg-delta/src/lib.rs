pub mod ext;
pub mod obj;
pub mod gen;
pub mod model;
pub mod render;

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// The pg-delta oracle: a Bun process running `worker/worker.ts`, one JSON
/// line in, one `@@RESULT` line out.
struct Worker {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl Worker {
    fn spawn() -> Worker {
        // PGDELTA_WORKER points at a worker.ts inside another checkout (e.g. main)
        let dir = env!("CARGO_MANIFEST_DIR");
        let worker = std::env::var("PGDELTA_WORKER").unwrap_or_else(|_| format!("{dir}/worker/worker.ts"));
        let mut child = Command::new("bun")
            .arg(&worker)
            .current_dir(std::path::Path::new(&worker).parent().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn bun worker");
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Some(r) = line.strip_prefix("@@RESULT ") {
                    if tx.send(r.to_string()).is_err() {
                        break;
                    }
                }
            }
        });
        let ready = rx.recv_timeout(Duration::from_secs(600)).expect("worker did not start");
        assert!(ready.contains("ready"), "{ready}");
        Worker { child, stdin, lines: rx }
    }
}

static WORKER: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();

#[derive(Debug, Clone)]
pub struct Outcome {
    pub verdict: String,
    pub kind: String,
    pub detail: String,
}

/// Send one request; a request that takes longer than `timeout` kills the
/// worker (it is respawned on the next call) and reports `kind = "hang"`.
pub fn ask(req: Value, timeout: Duration) -> Outcome {
    let m = WORKER.get_or_init(|| Mutex::new(None));
    let mut guard = m.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(Worker::spawn());
    }
    let w = guard.as_mut().unwrap();
    let line = format!("{}\n", req);
    if w.stdin.write_all(line.as_bytes()).and_then(|_| w.stdin.flush()).is_err() {
        *guard = None;
        return Outcome { verdict: "fail".into(), kind: "worker_died".into(), detail: String::new() };
    }
    match w.lines.recv_timeout(timeout) {
        Ok(s) => {
            let v: Value = serde_json::from_str(&s).unwrap();
            Outcome {
                verdict: v["verdict"].as_str().unwrap_or("").into(),
                kind: v["kind"].as_str().unwrap_or("").into(),
                detail: v["detail"].as_str().unwrap_or("").into(),
            }
        }
        Err(_) => {
            let _ = w.child.kill();
            *guard = None;
            Outcome { verdict: "fail".into(), kind: "hang".into(), detail: format!("no answer in {timeout:?}") }
        }
    }
}

pub fn migrate(from: &str, to: &str, compact: bool) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact}), Duration::from_secs(120))
}

/// Without auto-seeded rows: a failure here is not a data hazard.
pub fn migrate_bare(from: &str, to: &str, compact: bool) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact, "autoSeed": false}), Duration::from_secs(120))
}

pub fn roundtrip(sql: &str, layout: &str) -> Outcome {
    ask(json!({"op": "roundtrip", "sql": sql, "layout": layout}), Duration::from_secs(120))
}

/// First line of an error, digits blanked: a failure signature.
pub fn sig(kind: &str, detail: &str) -> String {
    let mut lines = detail.lines().filter(|l| !l.ends_with(':'));
    let first = lines.next().unwrap_or("");
    // "set column:aux.t1.c0.collation: null -> x" -> "set column.collation"
    let first = match first.trim().strip_prefix("set ") {
        Some(rest) => {
            let id = rest.split(": ").next().unwrap_or("");
            let kind = id.split(':').next().unwrap_or("");
            let attr = id.rsplit('.').next().unwrap_or("");
            format!("drift set {kind}.{attr}")
        }
        None => first.to_string(),
    };
    let first: String = first.chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).collect();
    let first = first.split(" -> ").next().unwrap_or("").to_string();
    format!("{kind}: {}", first.chars().take(120).collect::<String>())
}

/// `migrate` for the `ext` generator; `flavor` is "stock" or "supabase" (the
/// worker must have been started with EPHYRA_FLAVOR=supabase for the latter).
pub fn migrate_flavor(from: &str, to: &str, compact: bool, flavor: &str) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact, "flavor": flavor}), Duration::from_secs(180))
}

/// The declarative workflow (export `to`, sync it onto `to` and onto `from`).
pub fn declarative(from: &str, to: &str, layout: &str, flavor: &str) -> Outcome {
    ask(json!({"op": "declarative", "from": from, "to": to, "layout": layout, "flavor": flavor}), Duration::from_secs(300))
}

/// `declarative` without the worker's one ignored Supabase statement.
pub fn declarative_strict(from: &str, to: &str, layout: &str, flavor: &str) -> Outcome {
    ask(json!({"op": "declarative", "from": from, "to": to, "layout": layout, "flavor": flavor, "strict": true}), Duration::from_secs(300))
}

/// Same SQL loaded with and without prior OID churn: same hashes, same plan.
pub fn stable(from: &str, to: &str, flavor: &str) -> Outcome {
    ask(json!({"op": "stable", "from": from, "to": to, "flavor": flavor}), Duration::from_secs(180))
}

/// `migrate` with one real row in every source table (see `seedRows` in the
/// worker), so the proof's data check covers tables DEFAULT VALUES cannot fill.
pub fn migrate_rows(from: &str, to: &str, compact: bool, flavor: &str) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact, "flavor": flavor, "rows": true}), Duration::from_secs(180))
}

/// `migrate_rows` with 1–3 objects of B renamed (picked by `seed` from B's
/// catalog) and rename detection on (`renames: "auto"`).
pub fn migrate_renamed(from: &str, to: &str, compact: bool, seed: u32) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact, "rows": true, "renameSeed": seed}), Duration::from_secs(180))
}

/// `migrate_bare` with rename detection on; `to` carries its own RENAME
/// statements after the objects it renames.
pub fn migrate_with_renames(from: &str, to: &str, compact: bool) -> Outcome {
    ask(json!({"op": "migrate", "from": from, "to": to, "compact": compact, "autoSeed": false, "renames": true}), Duration::from_secs(180))
}

/// `declarative` with real rows in the live database and 1–3 objects of the
/// desired side renamed (by `seed`), synced with `renames: "auto"`.
pub fn declarative_renamed(from: &str, to: &str, layout: &str, flavor: &str, seed: u32) -> Outcome {
    ask(json!({"op": "declarative", "from": from, "to": to, "layout": layout, "flavor": flavor, "rows": true, "renameSeed": seed}), Duration::from_secs(300))
}
