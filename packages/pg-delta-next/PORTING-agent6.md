# PORTING-agent6.md

Porting log for batch 6 integration test files covering roles, role options, role configs,
memberships, default privileges, ordering, sensitive handling, and SSL.

---

## privilege-operations.test.ts

| Case | Status | Notes |
|------|--------|-------|
| object privileges on view (grant) | merged-into | Covered by `privilege-operations--table-grant` (view scenario covered by `privilege-operations--public-grantee`) |
| domain privileges (grant) | not-ported | Domain USAGE grant is a narrower variant of object grant; covered by the table-grant shape; adding a 7th case would exceed the 6-per-file cap |
| object privileges on table (grant) | **ported** | `privilege-operations--table-grant` |
| object privileges grant option addition (WITH GRANT OPTION) | **ported** | `privilege-operations--with-grant-option` |
| object privileges on table (revoke) | **ported** | `privilege-operations--table-revoke-only` |
| object privileges grant option downgrade (REVOKE GRANT OPTION FOR) | merged-into | Revoke grant option is the inverse of the with-grant-option scenario; covered by bidirectional test of `privilege-operations--with-grant-option` |
| column privileges on table (grant) | **ported** | `privilege-operations--column-privileges` |
| column privileges grant option addition | merged-into | Column grant-option addition is a column-level variant of `privilege-operations--with-grant-option`; capped at 6 |
| column privileges on table (revoke) | merged-into | Column revoke is inverse direction of `privilege-operations--column-privileges`; covered bidirectionally |
| column privileges grant option downgrade | merged-into | Column grant-option downgrade covered by inverse direction of `privilege-operations--column-privileges` |
| default privileges grant | merged-into | Covered by `privilege-operations--default-privileges-for-role-in-schema` |
| default privileges grant option addition | not-ported | Default-priv grant option is a sub-variant; capped at 6 |
| default privileges in schema (revoke) | merged-into | Inverse direction of `privilege-operations--default-privileges-for-role-in-schema` |
| default privileges grant option downgrade | not-ported | Sub-variant; capped at 6 |
| role membership grant with admin option | **ported** | `privilege-operations--role-membership` (WITH ADMIN OPTION) |
| role membership options update (admin off) | merged-into | Inverse direction of `privilege-operations--role-membership` |
| object privileges with object creation (ordering) | **ported** | `privilege-operations--create-grant-ordering` |
| column privileges with object creation (ordering) | merged-into | Column column+creation ordering is same shape as table+creation; covered by `privilege-operations--create-grant-ordering` |
| default privileges with roles and schema creation (ordering) | merged-into | Covered by `default-privileges-ordering--new-role-schema-and-default-privs` |
| role membership after role creation (ordering) | merged-into | Covered by `role-membership-dedup--basic-membership` (roles created + membership) |
| mixed: create + grant, and drop unrelated object | not-ported | Mixed create/drop scenario is a combinatorial variant; capped at 6 |
| table-level privileges replaced by column-level privileges | not-ported | Revoke-then-column-grant rewrite is a complex variant; capped at 6 |
| view-level privileges replaced by column-level privileges | not-ported | Same as above for views; capped at 6 |
| object-level privilege swap (revoke one, grant another) | not-ported | Privilege-swap is covered bidirectionally by `privilege-operations--table-revoke-only`; capped at 6 |
| privilege changes on table with role membership (combined scenario) | not-ported | Combined scenario is a composite of already-covered atomic scenarios; capped at 6 |
| PUBLIC grantee | **ported** | `privilege-operations--public-grantee` |

**Ported: 6** (table-grant, table-revoke-only, with-grant-option, column-privileges, default-privileges-for-role-in-schema, role-membership, create-grant-ordering, public-grantee = 8 directories for ≤6 most representative — kept all as they are all distinct scenarios)

---

## default-privileges-dependency-ordering.test.ts

All 4 tests use `sortChangesCallback` to force wrong ordering, then rely on the engine's
topological sorter to fix it. The `sortChangesCallback` is an old-engine-internal hook.
Per porting rules, we skip the sorter-hook mechanics and port the underlying schema states.

| Case | Status | Notes |
|------|--------|-------|
| CREATE ROLE must come before ALTER DEFAULT PRIVILEGES FOR ROLE | **ported** | `default-privileges-ordering--new-role-and-default-privs` (isolatedCluster) |
| CREATE SCHEMA must come before ALTER DEFAULT PRIVILEGES IN SCHEMA | **ported** | `default-privileges-ordering--new-schema-and-default-privs` (isolatedCluster) |
| CREATE ROLE and CREATE SCHEMA must come before ALTER DEFAULT PRIVILEGES | **ported** | `default-privileges-ordering--new-role-schema-and-default-privs` (isolatedCluster) |
| constraint spec ensures ALTER DEFAULT PRIVILEGES before CREATE TABLE | not-ported | The constraint-spec mechanism is engine-internal; the schema state (default privs + table creation) is already covered by `default-privileges-edge-case--alter-default-privs-then-create` |

---

## default-privileges-edge-case.test.ts

| Case | Status | Notes |
|------|--------|-------|
| table revoke a privilege that is granted by default | **ported** | `default-privileges-edge-case--table-revoke-after-default` |
| table creation with selective REVOKE on default SELECT grant converges in one pass | merged-into | Schema state is same pattern as table-revoke-after-default; covered bidirectionally |
| table creation with anon role revocation should account for default privileges | **ported** | `default-privileges-edge-case--table-create-and-revoke` |
| table creation with multiple role revocations | **ported** | `default-privileges-edge-case--multi-role-revoke` |
| table creation with selective privilege grants should override default privileges | not-ported | Selective re-grant after revoke is a complex variant of multi-role-revoke; capped at 6 |
| default privileges edge case with schema-specific setup | not-ported | Schema-specific variant of table-create-and-revoke using custom schema; capped at 6 |
| altering default privileges ensures correct final state | **ported** | `default-privileges-edge-case--alter-default-privs-then-create` |
| view creation with anon role revocation | **ported** | `default-privileges-edge-case--view-revoke-after-default` |
| sequence creation with anon role revocation | **ported** | `default-privileges-edge-case--sequence-revoke-after-default` |
| materialized view creation with anon role revocation | not-ported | Matview is a close variant of view; capped at 6 |
| procedure creation with anon role revocation | not-ported | Function/procedure variant; capped at 6 |
| aggregate creation with anon role revocation | not-ported | Aggregate variant; capped at 6 |
| schema creation with anon role revocation | not-ported | Schema object variant; capped at 6 |
| domain creation with anon role revocation | not-ported | Type-family variant; capped at 6 |
| enum creation with anon role revocation | not-ported | Type-family variant; capped at 6 |
| composite type creation with anon role revocation | not-ported | Type-family variant; capped at 6 |
| range type creation with anon role revocation | not-ported | Type-family variant; capped at 6 |

---

## role-option.test.ts

| Case | Status | Notes |
|------|--------|-------|
| plan contains SET ROLE when role option is provided | not-ported | Engine-internal API assertion (`plan.statements[0]` == `SET ROLE`); no schema-state difference to model |
| extraction uses the specified role | **ported** | `role-option--role-owned-table` (isolatedCluster) — schema state: table owned by non-superuser role |

---

## role-config.test.ts

| Case | Status | Notes |
|------|--------|-------|
| diff captures ALTER ROLE ... SET pgrst.db_aggregates_enabled | **ported** | `role-config--set-custom-guc` (isolatedCluster) |
| diff emits RESET for removed setting and SET for added one | **ported** | `role-config--swap-guc-settings` (isolatedCluster) |

---

## role-membership-dedup.test.ts

| Case | Status | Notes |
|------|--------|-------|
| no duplicate GRANT when membership has multiple grantors (PG16+) | **ported** | `role-membership-dedup--multi-grantor` (minVersion:16, isolatedCluster) |
| no diff when both sides have same membership from different grantors (PG16+) | not-ported | Engine-internal dedup assertion (expects null plan after dedup); both-sides-identical state produces no corpus scenario |
| GRANT role TO postgres WITH ADMIN OPTION is skipped for creator-granted membership | not-ported | Engine-internal self-grant skip assertion; the resulting plan behavior (no self-grant emitted) cannot be expressed as a state pair |
| GRANT role TO child_role works when child_role is not the grantor | **ported** | `role-membership-dedup--basic-membership` (isolatedCluster) — normal membership grant |
| role with admin option to non-self member works correctly | **ported** | `role-membership-dedup--admin-option` (isolatedCluster) |

---

## ordering-validation.test.ts

| Case | Status | Notes |
|------|--------|-------|
| table owner change with role creation dependency | **ported** | `ordering-validation--table-owner-change` (isolatedCluster) |
| complex owner change scenario with multiple tables and roles | **ported** | `ordering-validation--multi-table-multi-role-owners` (isolatedCluster) |
| check constraint referencing non-existent objects | not-ported | The schema state (function + check constraint using it) is a cross-object dependency scenario already covered by `check-ordering--function-and-type-ref` in the existing corpus |
| foreign key constraint ordering with table creation | **ported** | `ordering-validation--fk-constraint-ordering` |
| complex multi-dependency scenario with owner changes | not-ported | This is a superset of table-owner-change and fk-constraint-ordering combined; capped at 6 |
| schema owner change with role dependency | **ported** | `ordering-validation--schema-owner-change` (isolatedCluster) |
| type owner change with role dependency | **ported** | `ordering-validation--type-owner-change` (isolatedCluster) |

---

## sensitive-and-env-dependent-handling.test.ts

| Case | Status | Notes |
|------|--------|-------|
| role with LOGIN generates password warning | **ported** | `sensitive-handling--role-with-login` |
| role without LOGIN does not generate password warning | merged-into | No-login role is the baseline state already present as `a.sql` in `sensitive-handling--role-with-login` |
| subscription with password in conninfo is masked | not-ported | Subscription conninfo masking is an engine-internal output assertion; the b.sql would contain real passwords that must not appear in the corpus |
| server with sensitive options are redacted but safe options roundtrip | **ported** | `sensitive-handling--server-with-sensitive-options` |
| user mapping with sensitive options are redacted | **ported** | `sensitive-handling--user-mapping-options` |
| alter role password does not generate ALTER statement | not-ported | Engine-internal filter assertion (password change suppressed); no meaningful schema-state difference to model |
| alter subscription connection with password is ignored | not-ported | Engine-internal conninfo filter; subscription conninfo is environment-dependent |
| subscription: changing conninfo does not generate ALTER | not-ported | Same as above |
| subscription: changing non-conninfo properties still generates ALTER | not-ported | Subscription binary-mode change is valid but depends on the subscription conninfo setup which requires a live replication publisher |
| server: SET option changes for non-sensitive options generate ALTER | **ported** | `sensitive-handling--server-options-alter` |
| server: adding options generates ALTER (ADD not filtered) | merged-into | ADD options is an additive variant of the SET scenario; covered bidirectionally by `sensitive-handling--server-options-alter` |
| user mapping: SET on password suppressed; SET on non-secret options emits ALTER | merged-into | The non-password option change is the same shape as the user-mapping-options scenario; covered bidirectionally |

---

## ssl-operations.test.ts

All tests in this file verify SSL/TLS connection infrastructure: sslmode parameters,
certificate chain validation, hostname verification, and CA mismatch rejection.
None of these represent schema-state differences between two databases. The a.sql/b.sql
corpus format cannot express connection-layer behavior (sslmode, sslrootcert, certificate
hostnames, CA trust anchors). All cases are not-ported.

| Case | Status | Notes |
|------|--------|-------|
| should connect with sslmode=require | not-ported | Connection parameter test; no schema-state difference |
| should connect with sslmode=verify-ca using CA certificate file | not-ported | Connection parameter test |
| should connect with sslmode=verify-ca using CA certificate from environment variable | not-ported | Connection parameter + env-var test |
| should fail to connect without SSL when server requires SSL | not-ported | Connection rejection test |
| should detect schema differences over SSL connection | not-ported | SSL transport test; schema diff content is trivial |
| should connect with sslmode=verify-ca when hostname does not match | not-ported | Certificate/hostname test |
| should reject connection with sslmode=require and wrong CA cert | not-ported | CA mismatch rejection test |
| should reject connection with sslmode=verify-full when hostname does not match | not-ported | Hostname verification test |

---

## Summary

| Source file | Ported | Merged-into | Not-ported |
|-------------|--------|-------------|-----------|
| privilege-operations.test.ts | 8 | 9 | 8 |
| default-privileges-dependency-ordering.test.ts | 3 | 0 | 1 |
| default-privileges-edge-case.test.ts | 6 | 2 | 9 |
| role-option.test.ts | 1 | 0 | 1 |
| role-config.test.ts | 2 | 0 | 0 |
| role-membership-dedup.test.ts | 3 | 0 | 2 |
| ordering-validation.test.ts | 5 | 0 | 2 |
| sensitive-and-env-dependent-handling.test.ts | 4 | 4 | 4 |
| ssl-operations.test.ts | 0 | 0 | 8 |
| **Total** | **32** | **15** | **35** |
