# Applier authorization, revision 4 (self-contained spec)

Supersedes `DESIGN.md` (kept as history). Built on `Action.subject` / `Action.change`
(#586). Scope: `packages/pg-delta`. PoC quality; judged by the owner-lab suite.

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
- **Never predict in order to refuse.** Blockers only for rules that are exact. Heuristics
  may choose between two valid strategies, never refuse.
- **No-op for a superuser or absent capability**: same statements, same plan id.
- **No regression for a non-superuser**: a plan that applied and converged before must
  still do so.
- **Read identity from the action**: `action.subject`, `action.verb`, `action.change`.
  Never infer from `produces` / `consumes` / `destroys` (the #586 guard test enforces it).
- **Authorization state comes from unfiltered facts.** Ownership, schema ACLs and
  memberships are read from the raw source / desired fact bases, not the policy-filtered
  views: a filtered-out grant still exists in the database.

## Verified Postgres facts

- `ALTER … OWNER TO r`: needs the current owner's privileges (inherit is enough), SET on
  `r` (≤15: membership), and `r` needs CREATE on the object's schema.
- PG16+: `CREATE ROLE r` by a CREATEROLE role creates one row (r, creator, grantor =
  bootstrap superuser, admin, no inherit, no set). `GRANT r TO creator` adds a second row
  with grantor = creator. `REVOKE … GRANTED BY creator` removes only that row.
  A plain `GRANT g TO m` picks as grantor the executing role if it has ADMIN on `g`
  directly, else the first inherited role that has it.
- PG≤15: one row per (role, member), grantor ignored, membership always inherits when the
  member has `rolinherit`; CREATEROLE may grant itself any non-superuser role.
- Object GRANT/REVOKE: the grantor is the executing role if it is the owner; otherwise the
  first role in its inherited set (itself first) that holds ALL the needed grant options,
  the owner counting as holding all. So the owner is always picked when no other inherited
  role holds any grant option on that object.
- `SET ROLE x` is checked against the SESSION user's SET-reachable roles; privileges are
  then exactly `x`'s. `RESET ROLE` returns to the session user, which is NOT the applier
  when the session logged in as another role and stepped down (Supabase CLI).
- A schema owner may DROP any object in its schema.
- supautils only adds `supautils.reserved_memberships`.

## Pieces

### 1. Capability probe (one round trip, new fields optional)

`inherit`, `settableRoles`, `inheritedRoles` (USAGE), `adminOf` (DIRECT rows only),
`selfGrants` (own-grantor rows with options), `reservedMemberships`, `isDatabaseOwner`.
Already present in the PoC; keep.

### 2. Membership model: the self-grant row, nothing else

Membership facts stay as on the base branch (`admin` only), plus ONE new payload field on
PG16+: `self: { inherit, set } | null`, taken from the row whose grantor equals the member
(the row a CREATEROLE user creates to use a role it made). The bootstrap superuser (oid 10)
is excluded: it is the recorded grantor of every grant a superuser makes, so its own
memberships are ordinary rows. Rendering of a `self` change:
`GRANT r TO m WITH INHERIT x, SET y GRANTED BY m`, and `REVOKE r FROM m GRANTED BY m` to
remove it. Capability projection keeps hiding the implicit creator row only when `self`
is null. Remove revision 3's `set` / `inherit` effective options, its option alters, its
`GRANTED BY` on other memberships and the `_rows` blocker: all other membership behaviour
is byte-identical to the base branch.

### 3. `Action.runAs`

New optional field `runAs?: string` on an action: the role that must execute it. Set only
by the authorization pass. `apply()` executes `SET LOCAL ROLE "<runAs>"` before the
statement and restores the session's own role setting after it (never `RESET ROLE`), both
inside the action's transaction. `renderApplyScript` prints the same
two statements. Splitting, segmenting and compaction never see separate role statements.
`runAs` participates in the plan id when present.

### 4. The pass (`src/plan/phases/applier-authorization.ts`, rewritten)

Runs after ordering and compaction, only for a non-superuser capability. Inputs: final
actions, capability, raw source and desired facts. Output: actions, blockers, bound applier.

**4a. Owner tracking.** `ownerNow(object)` starts from the raw source owner edge (schemas
also use the non-hashed `_owner`, then fall back to the applier), is the applier for an
object created by the plan, and follows `change.kind === "owner"` actions (and the carried
sequences hook). The "root" of an action is the nearest ancestor of `action.subject` that
can have an owner.

**4b. Needed roles.** For each action: the owner-now of its root; for an owner change also
the new owner; plus owners of the root's one-hop dependency targets and inheritance
children (both states). Drop the applier and every role already in `inheritedRoles` (for a
new owner: already in `settableRoles`).

**4c. Envelope.** Each needed role the applier can grant itself (≤15: CREATEROLE, role not
superuser, not reserved, applier inherits; 16+: direct ADMIN or created by this plan, not
reserved) gets an OPEN after the role exists and a CLOSE that restores the applier's
own-grantor row exactly, both `GRANTED BY <applier>` on 16+. Roles it cannot grant itself
are skipped silently. The row is opened `WITH INHERIT TRUE, SET TRUE`.

A second strategy was built and measured, then deleted: open the row SET-only and run every
statement on a foreign-owned object as its owner (`runas`). On CI run 44910949799 it was as
sound as inheriting but passed 61 fewer runs on PG16-18 and regressed 3 on Supabase 17
(`SET ROLE <owner>` changes name resolution and needs the owner to have USAGE everywhere).

`PGDELTA_OWNER_MODE` is now a measurement knob only: `union` is the pass; `nopin`, `nowrap`
and `nomoves` each switch one mechanism off (4d run-as pin, 4f temporary CREATE, 4g moves)
so the suite can count the scenarios that need it.

**4d. Non-interference (the soundness core).**
For every grant-family action, the grantor must be the one a superuser would get.

- Object ACL (`subject.kind === "acl"`, incl. merged GRANTs whose `produces` lists more
  grants, and the temp CREATE of 4f). Target owner-now = `o`. Hazard = some role in
  (applier ∪ `inheritedRoles` ∪ envelope roles) other than `o` holds a grant option on the
  target in the raw source or desired ACL.
  - `o` is the applier, or no hazard → leave as is.
  - hazard and the applier can SET to `o` → `runAs: o`.
  - hazard and it cannot → blocker `capability_acl_grantor` (only when the hazard role is
    an envelope role; a pre-existing hazard is base-branch behaviour, leave it).
- Membership (`subject.kind === "membership"`), PG16+, role `g`: if the applier has direct
  ADMIN on `g` or the plan creates `g` → leave as is. Otherwise, if an ENVELOPE role has
  ADMIN on `g` → blocker `capability_membership_grantor` (the envelope would make a
  statement succeed under a grantor it would not have had). Otherwise leave as is.

**4e. Blockers for owner changes (exact).** New owner neither settable nor self-grantable;
current owner (of an object that exists in the source) neither inherited nor
self-grantable.

**4f. New owner's CREATE on the schema.** If the new owner is not the schema's owner-now
and has no CREATE there (direct entry, or PUBLIC, in the simulated raw state), wrap the
owner change with `GRANT CREATE ON SCHEMA … TO r` / `REVOKE CREATE …`, each run as the
schema owner-now (`runAs` when that is not the applier), only when the applier can act as
it. Otherwise emit nothing.

**4g. Ordering.** Bounded moves only, decided from `subject`: membership grants and role
creates earlier, membership revokes and role drops later, schema-ACL widening earlier and
narrowing later. A move never crosses an action that writes or owner-changes something the
moved action names, another membership action, a rename of a role it names, a
non-transactional action or a segment boundary.

### 5. Blockers and identity

`plan()` never throws for capability. `Plan.blockers` (omitted when empty) and
`Plan.boundApplier` (set when the plan has envelope actions or any `runAs`). `apply()`,
`provePlan` and `renderApplyScript` refuse a blocked plan with a typed `CapabilityError`;
`apply()` refuses when `current_user` differs from `boundApplier`.

## Declared limits (loud, by design)

- A role the applier cannot assume and whose privileges a statement needs.
- An owner change whose new owner needs more than schema CREATE (publication → CREATE on
  the database; FDW, event trigger, all-tables publication → superuser).
- Role rename in the same plan as work on objects it owns.
- Owner change of schema `public` itself (the `pg_*` owner edge is not a fact).
- Any membership provenance other than the self-grant row.
- A failure in a later transaction segment leaves the envelope open; the next plan sees
  the self-grant row and removes it.
