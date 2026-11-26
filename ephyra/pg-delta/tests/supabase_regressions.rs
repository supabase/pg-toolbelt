//! Shrunk Supabase-profile counterexamples. Runs only with
//! EPHYRA_FLAVOR=supabase (the worker boots the Supabase container).

use pg_delta_ephyra::{declarative_strict, migrate_flavor};

fn converges(from: &str, to: &str) {
    if std::env::var("EPHYRA_FLAVOR").as_deref() != Ok("supabase") {
        return;
    }
    let fails: Vec<String> = [true, false]
        .into_iter()
        .map(|compact| (compact, migrate_flavor(from, to, compact, "supabase")))
        .filter(|(_, o)| o.verdict != "pass")
        .map(|(compact, o)| format!("compact={compact} {}: {}", o.kind, o.detail))
        .collect();
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}


#[test]
fn new_table_in_user_schema_does_not_keep_user_default_privilege_grants() {
    converges(
        "CREATE SCHEMA app; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;",
        "CREATE SCHEMA app; CREATE TABLE app.t (id bigint); ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;",
    );
}

#[test]
fn new_partitioned_table_in_user_schema_with_user_default_privileges() {
    converges(
        "CREATE SCHEMA app; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;",
        "CREATE SCHEMA app; CREATE TABLE app.t (id bigint, k integer) PARTITION BY RANGE (k); ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO service_role;",
    );
}

/// `schema apply`-style sync with a co-located shadow, on a Supabase database
/// nobody changed: base-init's schema-level `{postgres=X/postgres}` function
/// default in `public` is read as PUBLIC having lost EXECUTE.
#[test]
fn untouched_database_resyncs_to_nothing() {
    if std::env::var("EPHYRA_FLAVOR").as_deref() != Ok("supabase") {
        return;
    }
    let o = declarative_strict("", "", "grouped", "supabase");
    assert_eq!(o.verdict, "pass", "{}: {}", o.kind, o.detail);
}
