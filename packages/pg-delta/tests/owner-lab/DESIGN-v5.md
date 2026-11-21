# Applier authorization, revision 5 (self-contained spec)

Supersedes `DESIGN-v4.md` and `DESIGN.md` (kept as history). Built on `Action.subject` /
`Action.change` (#586). Scope: `packages/pg-delta`. PoC quality; judged by the owner-lab suite.

## Problem

A plan is run by ONE role, the applier. On Supabase that is `postgres`: NOSUPERUSER,
CREATEROLE, INHERIT, owner of the database. Objects in the desired state may be owned by
other roles. Postgres then decides two things per statement from WHO runs it:

1. **Authorization**: may it run (owner of the object, SET on the new owner, CREATE on
   the schema, ADMIN on a role).
2. **Attribution**: for GRANT / REVOKE on objects and (PG16+) on role memberships, which
   role is recorded as grantor, and therefore which rows a REVOKE removes. Postgres picks
   the grantor from the executing role plus every role it INHERITS.

A superuser is authorized for everything and is always attributed as the object's owner.
The engine was written for that. Everything below exists to give a non-superuser the same
result, or fail loudly.

## Contract

- **SOUND OR LOUD.** A plan that applies successfully leaves exactly the desired state:
  owners, ACL items including grantor, `pg_auth_members`, default ACLs, table rows; and
  leaves the session's role as it found it. Anything it cannot do that way fails with a
  typed blocker before apply, or with Postgres's own error during apply.
- **Never predict in order to refuse.** Blockers only for rules that are exact.
- **No-op for a superuser or absent capability**: same statements, same plan id.
- **No regression for a non-superuser**: a plan that applied and converged before must
  still do so.
- **Read identity from the action**: `action.subject`, `action.verb`, `action.change`. The
  one documented exception is a GRANT merged over several grantees, which lists every
  grant in `produces`.
- **Authorization state comes from unfiltered facts.**
- **Insert and remove, never reorder** (new in revision 5). The pass adds statements and
  removes the ones an added statement replaces. It never moves a statement of the base
  plan, and it never decides from a simulated intermediate ACL.

## Why revision 5

Revision 4 was sound on the suite (CI run 44918673651: zero SILENT, zero REGRESSION on 12
non-superuser configs) but carried two mechanisms that kept producing findings:

- **Bounded reordering** (membership grants earlier, revokes later, schema grants earlier /
  later, each stopping at a "conflict" found by comparing the ids two statements name).
  Switching it off cost 274 of 1,017 passing runs on PG17, so it was load-bearing, and a
  name-overlap test is not a proof that two statements commute.
- **A simulated schema ACL** to decide whether the new owner of an object already has
  CREATE on the schema. A GRANT merged over two grantees was tracked for the first one only
  and the temporary grant's REVOKE then removed a privilege the desired state wants
  (`adversarial/e04`, found by Codex).

Both existed to answer "what can the applier (or the new owner) do at THIS step". Revision 5
removes the question: the applier keeps every role it needs for the whole plan, and the
schema CREATE rule is decided from the two end states.

## Verified Postgres facts

- `ALTER … OWNER TO r`: needs the current owner's privileges (inherit is enough), SET on
  `r` (≤15: membership), and `r` needs CREATE on the object's schema.
- PG16+: `CREATE ROLE r` by a CREATEROLE role creates one row (r, creator, grantor =
  bootstrap superuser, admin, no inherit, no set). `GRANT r TO creator` adds a second row
  with grantor = creator. `REVOKE … GRANTED BY creator` removes only that row. A plain
  `GRANT g TO m` / `REVOKE g FROM m` picks as grantor the executing role if it has ADMIN
  on `g` directly, else the first inherited role that has it.
- PG16+: because the creator's row makes the applier a member of `r`, `r` can never be a
  member of the applier. On ≤15 it can, and `GRANT r TO applier` is then refused as a loop.
- PG≤15: one row per (role, member), grantor has no effect, membership always inherits
  when the member has `rolinherit`; CREATEROLE may grant itself any non-superuser role.
- Object GRANT/REVOKE: the grantor is the executing role if it is the owner; otherwise the
  first role in its inherited set (itself first) that holds ALL the needed grant options,
  the owner counting as holding all. So the owner is always picked when no other inherited
  role holds any grant option on that object.
- `SET ROLE x` is checked against the SESSION user's SET-reachable roles; privileges are
  then exactly `x`'s. `RESET ROLE` returns to the session user, which is NOT the applier
  when the session logged in as another role and stepped down (Supabase CLI).
- A schema owner may DROP any object in its schema.
- supautils only adds `supautils.reserved_memberships`.
- The bootstrap superuser (oid 10) is the recorded grantor of every grant a superuser makes.

## Pieces

### 1. Capability probe (one round trip, new fields optional)

`inherit`, `settableRoles`, `inheritedRoles` (USAGE), `adminOf` (DIRECT rows only),
`selfGrants`, `reservedMemberships`, `isDatabaseOwner`.

### 2. Membership model: the member's own row, nothing else

Membership facts stay as on the base branch (`admin` only), plus ONE payload field on
PG16+: `self: { inherit, set }` (absent when there is none), taken from the row whose
grantor equals the member and is not the bootstrap superuser. It renders in a statement of
its own: `GRANT r TO m WITH INHERIT x, SET y GRANTED BY m` / `REVOKE r FROM m GRANTED BY m`.
This changes superuser plans in one way, on purpose: a member's own row is now planned
where the base plan was empty.

### 3. `Action.runAs`

Optional `runAs?: string`: the role that must execute the action. Set only by the pass.
`apply()` runs `SET LOCAL ROLE "<runAs>"` before the statement and restores the session's
own role setting after it (never `RESET ROLE`), inside the action's transaction.
`renderApplyScript` prints the same. `runAs` is part of the plan id when present.

### 4. The pass (`src/plan/phases/applier-authorization.ts`)

Runs after ordering and compaction, only for a non-superuser capability.

**4a. Owner tracking.** `ownerNow(object)`: the raw source owner edge (schemas fall back to
the non-hashed `_owner`, then the applier); the applier for an object the plan creates;
follows `change.kind === "owner"` actions and the carried-sequence hook; a rename moves the
owner to the new id and frees the old one. The "root" of an action is the nearest ancestor
of `action.subject` that can have an owner.

**4b. Needed roles.** For each action: the owner-now of its root, of the schema the root
lives in, of the root's one-hop dependency targets and inheritance children (both states);
for an owner change also the new owner. A role counts as already held only if the applier
inherits it (for a new owner: can SET it) AND the plan does not change the applier's own
row on it or on a role below it.

**4c. Envelope.** Each needed role the applier can grant itself gets:

- OPEN after the role exists: `GRANT r TO applier WITH INHERIT TRUE, SET TRUE GRANTED BY
  applier` (≤15: `GRANT r TO applier`).
- The plan's own statements on that row are REMOVED (PG16+: the `self` statements and the
  membership's plain REVOKE; ≤15: the REVOKE). A segment boundary a removed statement
  opened moves to the next statement.
- CLOSE at the end writes the row's final state: the desired own row when the plan had
  statements on it, otherwise exactly the source own row; `REVOKE … GRANTED BY applier`
  when there is none. Nothing when the plan drops the role.

A role whose own row the plan changes and through which a statement reaches a role it uses
is treated the same way. "Can grant itself": ≤15 CREATEROLE, role not superuser, not
reserved, applier inherits; 16+ direct ADMIN or created by this plan, not reserved; on every
version the role is not a member of the applier (loop). Roles it cannot grant itself are
skipped silently. A role where the plan also grants, or changes ADMIN on, a row the applier
did not grant is left alone (provenance is not modelled).

**4d. Non-interference.** For every grant-family action the grantor must be the one a
superuser would get.

- Object ACL (`subject.kind === "acl"`, and the statements of 4e). Target owner-now = `o`.
  Hazard = a role other than `o` among (applier ∪ `inheritedRoles` ∪ everything reachable
  through the envelope) holds a grant option on the target in either state.
  - no hazard → as is.
  - hazard and the applier can SET to `o` → `runAs: o` (plus USAGE on the object's schema
    for `o` by rule 4e when it lacks it).
  - hazard and it cannot → blocker `capability_acl_grantor`, only when the hazard role
    comes from the envelope (a hazard the applier had before is base-branch behaviour).
- Membership, PG16+, role `g`: if the applier has direct ADMIN on `g` or the plan creates
  `g` → as is. Otherwise, if a role reachable through the envelope has ADMIN on `g` →
  blocker `capability_membership_grantor`.

**4e. Lending a schema privilege (CREATE for a new owner, USAGE for a run-as owner).**
Role `r` needs privilege `P` on schema `S` for one statement. `S`'s owner-now is `so ≠ r`.
Decided from the two states and from whether the plan itself writes the ACL item (S, r):

| Case | Statements |
| --- | --- |
| (S, r) or (S, PUBLIC) holds `P` in the source, and the plan does not take it away | nothing |
| the plan itself grants `P` to `r` | `GRANT P` before the statement, no REVOKE |
| otherwise | `GRANT P` before, `REVOKE P` right after |

Only when the applier has `so`'s privileges, and with the grantor rule of 4d (run as `so`
on a hazard, or not at all). A REVOKE of this rule never removes a privilege the desired
state holds, and a GRANT without REVOKE is always completed by a statement of the plan.

**4f. Blockers for owner changes (exact).** New owner neither settable nor reachable
through the envelope; current owner (of an object that exists in the source) neither
inherited nor reachable.

### 5. Blockers and identity

`plan()` never throws for capability. `Plan.blockers` (omitted when empty) and
`Plan.boundApplier` (set when the plan has envelope actions or any `runAs`). `apply()`,
`provePlan` and `renderApplyScript` refuse a blocked plan with a typed `CapabilityError`;
`apply()` refuses when `current_user` differs from `boundApplier`.

## Declared limits (loud unless noted)

- A role the applier cannot assume and cannot grant itself, whose privileges a statement
  needs (PG16+: no direct ADMIN; any version: reserved by supautils, superuser role).
- An owner change whose new owner needs more than schema CREATE (publication → CREATE on
  the database; FDW, event trigger, all-tables publication → superuser).
- Role rename in the same plan as work on objects it owns.
- Owner change of schema `public` itself (the `pg_*` owner edge is not a fact). Not loud:
  the owner change is not planned, on any applier.
- Membership provenance other than the member's own row: rows granted by another role,
  their INHERIT / SET options, and a plan that grants or changes ADMIN on the applier's
  membership in a role it also needs. A REVOKE of a row the applier did not grant is a
  no-op with a warning (not loud; the next plan is not empty).
- Delegated grantors on object ACLs (an ACL item whose grantor is not the owner): the
  engine's ACL facts do not carry the grantor, on any applier.
- A membership statement whose grantor the applier gets only through an inherited role,
  while a role reachable through the envelope also holds ADMIN on it: blocker, even when the
  envelope role could not have been picked.
- A failure in a later transaction segment leaves the envelope open; the next plan sees
  the own row and removes it.
