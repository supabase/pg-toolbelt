# Applier authorization, minimal design

Supersedes `DESIGN-v5.md`, `DESIGN-v4.md`, `DESIGN.md` (kept as history of what was tried and
measured). Built on `Action.subject` / `Action.change` (#586). PoC; judged by the owner-lab.

## The problem in one paragraph

A plan is run by ONE role. On Supabase that is `postgres`: not a superuser, CREATEROLE.
Postgres lets a non-superuser change an object only with its owner's privileges, and hand
it to a new owner only if it can `SET ROLE` to that owner and the owner has CREATE on the
schema. These are core Postgres rules, not supautils. The engine was written for a
superuser, so a branch with one function owned by a custom role makes the plan fail.

## What the pass does: what a person would write by hand

```sql
GRANT "app_owner" TO "postgres";                 -- borrow the owner role
GRANT CREATE ON SCHEMA "app" TO "app_owner";     -- lend: the new owner needs CREATE
ALTER FUNCTION "app"."f"() OWNER TO "app_owner";
ALTER TABLE "app"."t" OWNER TO "app_owner";
REVOKE CREATE ON SCHEMA "app" FROM "app_owner";
REVOKE "app_owner" FROM "postgres";              -- give it back
```

Four rules, in `src/plan/phases/applier-authorization.ts`. They run on the final ordered
plan, only for a known non-superuser applier. A superuser plan is not touched.

1. **Borrow.** Every owner role a statement needs and the applier does not have, but can
   grant itself, is granted to it once (at the start, or right after the plan creates the
   role) and given back once at the end. "Needs": the owner of the object the statement
   is on; the owner of its schema, only to create, drop or rename in it without CREATE
   there, or to lend (rule 2); the owners of what the object references (a foreign key's
   table, a trigger's function) and of its inheritance children, only when the object
   itself is created or altered; the new owner of an owner change. If the applier had already granted itself that
   role with other options (PG16+), the row goes back exactly as the capability probe saw
   it. If the plan itself revokes that membership, its REVOKE is the one at the end.
   A GRANT / REVOKE the applier can already make through a grant option it (or a role
   it has) holds borrows nothing: it runs as it does today.
2. **Lend.** A new owner without CREATE on the schema gets it before the first owner change
   of a run and loses it after the last. Decided from the two end states: nothing when the
   role (or PUBLIC) holds CREATE before the plan and the plan does not take it away; no
   REVOKE when the plan itself grants it, and no GRANT either when that grant already ran.
   Never in a schema the plan renames.
3. **Order.** A schema GRANT moves earlier and a schema REVOKE later, so no role is locked
   out of a schema while the plan still works in it. It stops at any other GRANT / REVOKE
   on that schema, at a statement on the schema or the role itself, and at a commit. (The base plan revokes an owner's own
   schema privileges first and grants the new ones last; only a superuser survives that.)
   Nothing else is ever reordered.
4. **Refuse.** Typed blockers on the plan, reported before anything runs; `plan()` never
   throws for this, so a read-only diff always renders:
   - an owner change whose new owner the applier can neither `SET ROLE` to nor borrow, or
     whose current owner it can neither act as nor borrow;
   - a GRANT / REVOKE whose grantor the borrow could change. Postgres records the
     executing role when it owns the object, else the first role, among the executing
     role and those it inherits, holding every grant option asked for in THAT object's
     ACL (the owner holds them all); a superuser always records the owner. Borrowing
     adds candidates, so the plan is refused when a borrowed role (or one it is a member
     of) holds a grant option on the object of a planned GRANT / REVOKE, or when the
     object's owner is borrowed while the applier, or a role it already had, holds every
     option the statement asks for. Grant options on other objects, or on other
     privileges, are ignored. What the applier could already do before the plan is left
     alone: same result as on `main`, including the rare cases where that result
     differs from a superuser's.
   - a membership GRANT / REVOKE on a role where a borrowed role holds ADMIN and the
     applier holds none directly (same reason, for `pg_auth_members`).

"Can grant itself": PG ≤15 the applier has CREATEROLE and inherits, the role is not a
superuser; PG16+ the applier holds ADMIN on the role directly or the plan creates it; on
every version the role is not reserved by supautils and is not a member of the applier.

A plan that borrows or lends is bound to its applier: `apply()` refuses to run it as
another role.

## What was built, measured and cut

| Mechanism | Why it existed | Why it was cut |
|---|---|---|
| Run every statement as the owner (`SET ROLE`) | no inherited privileges, so no grantor ambiguity | passed 61 fewer runs on PG16-18, regressed 3 Supabase cases (name resolution under the owner) |
| Run single GRANT / REVOKE statements as the owner (`SET LOCAL ROLE` pin) | exact grantor when a borrowed role holds grant options | needs a role holding WITH GRANT OPTION that the plan must borrow: rare. It added `SET ROLE` lines to scripts and was the source of 2 regressions and 3 silent results in round 5. Replaced by the refusal above |
| Model the applier's own membership row as managed state (PG16+) | exact `pg_auth_members` convergence | changed superuser plans, and needed "absorb the plan's own statements" logic. Which roles the applier has granted itself is plumbing, not schema |
| Simulated schema ACL per step | decide whether a new owner already has CREATE | wrong for a GRANT merged over several grantees (silent lost privilege). Replaced by the end-state rule |
| Moving membership and role statements | make a role usable earlier / revoked later | name-overlap is not a proof that two statements commute; borrowing for the whole plan makes it unnecessary |
| Keeping a borrowed role when the desired database shows the applier holding it (PG16+, from advisory extract fields) | plain DDL instead of a GRANT / REVOKE pair when dev keeps `GRANT app_owner TO postgres` | acted on information the diff, and an export / load round trip, do not carry; produced 4 of the 6 findings of the last three review rounds. Belongs in the engine as membership attributes |
| Refusing every GRANT / REVOKE with two possible grantors, borrowed or not | 3 silent wrong-grantor results that `main` has too | refused 16 to 40 runs per configuration that pass on `main` (same applier, same memberships on both sides reproduce the same grantor) |

## Declared limits

Likelihood is my estimate of how often a real project migration hits it.

| Limit | Result | Likelihood |
|---|---|---|
| Owner role the applier cannot borrow: PG16+ a role it neither created nor holds ADMIN on; reserved by supautils; a superuser role | blocker | plausible on PG16+ for roles created by another role |
| A role the plan must borrow holds a grant option on an object the plan grants or revokes on (or ADMIN on a role it grants); or that object's owner must be borrowed while the applier already holds every option asked for | blocker: take the grant option away, or apply as a superuser | rare |
| The applier ALREADY has, before the plan, both the owner's privileges and a grant option on the object (its own or an inherited role's), or the plan itself grants it such a role | GRANT / REVOKE recorded with the grantor Postgres picks, as on `main` today; identical in two environments set up the same way, different from a superuser's (5 lab scenarios) | rare; unchanged behaviour |
| Publication owner (new owner needs CREATE on the database); FDW, event trigger, all-tables publication (superuser) | Postgres error | rare |
| Role rename in the same plan as work on objects it owns | Postgres error | rare |
| Owner change of schema `public` itself | not planned, on any applier | rare |
| Membership rows granted by another role, and their INHERIT / SET options | not modelled, as on `main`; a REVOKE of a row the applier did not grant is a no-op with a warning | rare |
| A plan with several transactions that fails in a later one (for example a failed `CREATE INDEX CONCURRENTLY`) | the migration fails loudly and the borrowed role stays granted; `REVOKE <role> FROM <applier>` by hand. Borrowing per transaction would remove this at the cost of a GRANT / REVOKE pair per transaction | rare |
| Which roles the applier has granted itself (PG16+): a `GRANT app_owner TO postgres` kept in the desired database | not compared, not planned: `CREATE ROLE` gives the creator an ADMIN-only row, so the membership fact exists on both sides and INHERIT / SET are not facts. A borrowed role is always given back, and a role the applier already held is left as found. Follow-up for the engine: INHERIT / SET as membership attributes (extract, diff, export together); the plan's own GRANT then keeps the role, as on PG ≤15, with no change to this pass | common, harmless: a migration that needs the role borrows it; `GRANT app_owner TO postgres` once on the target gives plain DDL from then on |
| A table-level `REVOKE ALL` while a role the applier acts through holds grant options on that table's columns only | Postgres picks a grantor per column for the implicit column revokes; not checked | rare |
