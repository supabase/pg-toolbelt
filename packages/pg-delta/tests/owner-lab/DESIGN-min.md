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
   A GRANT / REVOKE the applier can already make borrows nothing and runs as it does
   today. Judged narrowly: before the plan, on exactly that object (or column), the
   applier or a role it has holds the grant option for every privilege the ACL item has
   on either side. In any doubt the owner is borrowed.
2. **Lend.** A new owner without CREATE on the schema gets it before the first owner change
   of a run and loses it after the last. Decided from the two end states: nothing when the
   role (or PUBLIC) holds CREATE before the plan and the plan does not take it away; no
   REVOKE when the plan itself grants it, and no GRANT either when that grant already ran.
   Never in a schema the plan renames. CREATE the role only reaches through a group does
   not count: Postgres honours it only when the membership is inherited, so the pass
   lends then too, at the cost of one redundant GRANT / REVOKE pair when it was inherited
   (measured: one lab run changes, the non-inheriting owner, which then passes).
3. **Order.** A schema GRANT moves earlier and a schema REVOKE later, so no role is locked
   out of a schema while the plan still works in it. Only for a role whose privileges the
   plan can depend on: the applier, PUBLIC, a role that owns something in either state,
   and the roles these are members of. A grant to a runtime role that owns nothing stays
   where the plan put it. It stops at any other GRANT / REVOKE
   on that schema, at a statement on the schema or the role itself, at a statement on a role or a role membership
   that gives authority (when moving earlier) or takes it away (when moving later), and at
   a commit. (The base plan revokes an owner's own
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

PG16+ memberships carry INHERIT / SET (effective over all rows) as facts. For the applier's
OWN membership in a role the plan knows two states: full use (INHERIT and SET) and none. It
keeps its statement only between those two, when the applier can make the change: it creates
the role or holds ADMIN on it directly, a full use it takes away is its own row
(`cap.selfGrants`, both options) and no other grantor's row gives it use (`cap.usedViaOthers`),
and an ADMIN it gives up is on its own row. When it already has a row of its own, a kept GRANT
spells `WITH INHERIT TRUE, SET TRUE` (a GRANT changes only the options it names). Every other
statement on that membership (only INHERIT or only SET on either side, use or ADMIN through
another grantor's row, a role it cannot grant itself) is left out with an `applier_membership_left` warning in `plan.diagnostics`, and the membership
stays as found. A kept GRANT of a borrowed role is the borrow when the borrow statement is
written; a kept REVOKE moves to the end. The ADMIN-only row `CREATE ROLE` gives the creator
stays out of the managed view; a create of it with full use is planned without the ADMIN
part. Other members' INHERIT / SET are rendered as for any membership.

A plan that borrows or lends is bound to its applier: `apply()` refuses to run it as
another role, and a rendered script starts with a `DO` block that raises unless
`current_user` is that role.

## What was built, measured and cut

| Mechanism | Why it existed | Why it was cut |
|---|---|---|
| The ordering rule for every applier, superusers included (proposed by a review) | one code path for everyone | measured on the lab: 101 of 1,200 superuser plans change on PG17 and on PG15, no result changes; churn for users the pass does nothing for |
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
| A GRANT / REVOKE or comment on an object whose owner has no `USAGE` on its schema, in a schema owned by a third role the applier does not hold either: only the object's owner is borrowed | Postgres error (`permission denied for schema`) | rare: an owner that cannot reach its own object |
| The new owner lacks `CREATE` on a schema whose owner the applier cannot borrow, while the applier itself holds `CREATE WITH GRANT OPTION` there: `CREATE` is lent only with the schema owner's privileges | Postgres error on the owner change | rare |
| A schema `REVOKE` moved to after a membership `GRANT` of the same plan, when that membership makes another grant-option holder reachable: Postgres may pick a different grantor for the `REVOKE` | the entry can stay, with a warning; the next plan is not empty | rare |
| The applier holds an owner only through a group role, and the plan changes that group (membership or inheritance) in the same migration as work that needs the owner: statements keep the base plan's order around the change, and the owner is not borrowed directly | Postgres error, or a warning and a non-empty next plan, when the base order uses the authority after removing it | rare |
| Owner change of schema `public` itself | not planned, on any applier | rare |
| Membership rows granted by another role | not modelled per grantor, as on `main`; a REVOKE of a row the applier did not grant is a no-op with a warning. INHERIT / SET are facts as the EFFECTIVE option (any row): `GRANT r TO m WITH INHERIT FALSE, SET FALSE` updates only the executing role's row, so turning them off for a member that holds them through another grantor's row leaves them on (FACT_DRIFT); no grantor-blind statement can do it | rare |
| PG16+: the applier's own membership with only INHERIT or only SET, on either side (`h01`, `h02`, `b09`, `g13`); or one it cannot change: ADMIN on a role a superuser created, use or ADMIN through another grantor's row (`h04`, `h05`, `h06`, `h08`) | left as found, with an `applier_membership_left` warning; the rest of the plan runs, borrowing the role if it needs it (lab: `MEMBER_LEFT`; a superuser can make it true) | plausible on hosted Postgres |
| A PG ≤15 state diffed with a PG16+ state | INHERIT / SET are not comparable (absent on one side) and never give a statement; a GRANT rendered from a PG16+ desired state for a PG ≤15 server may still spell `WITH INHERIT …`, which PG ≤15 rejects | rare |
| A membership whose member role a policy hides (INHERIT assumed true for the default) | the create may omit `WITH INHERIT TRUE` for a NOINHERIT member. Not reproduced: the Supabase profile hides such memberships with the role | rare |
| The plan itself grants the applier a role holding a grant option (`d03`) or ADMIN (`d21`) on what a later statement grants | on PG16+ the plan's own self-grant now exists, so Postgres records that role as the grantor: silent | rare |
| A plan with several transactions that fails in a later one (for example a failed `CREATE INDEX CONCURRENTLY`) | the migration fails loudly and the borrowed role stays granted; `REVOKE <role> FROM <applier>` by hand. Borrowing per transaction would remove this at the cost of a GRANT / REVOKE pair per transaction | rare |
| Grant options on columns: the refusal looks at the whole table, so a borrowed role's option on column `a` refuses a planned grant on column `b` | blocker where the plan would have been fine | rare |
| A REVOKE the applier makes through a grant option (no borrow) when the grant being revoked was in fact made by the owner | Postgres revokes nothing and warns; the next plan is not empty. Same as on `main` | rare |
| `createrole_self_grant` set for the applier (off by default, empty on Supabase) and the plan creates a role it also borrows | the closing REVOKE removes the automatic self-grant | rare |
