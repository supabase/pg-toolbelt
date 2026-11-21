# PoC design: applier authorization as one plan-level pass ("assume-owner envelope")

Scope: `packages/pg-delta`. Branch `avallete/owner-envelope-poc`. This is a PoC to
measure a design, not a mergeable PR. Favor small, readable code over coverage of
every kind; when something is out of scope, make it a loud, typed refusal.

## The problem in one paragraph

A plan is a program run by ONE role (the applier). The desired state has MANY
owners. A superuser is authorized for every statement, so the planner only ever
modelled object dependencies. A non-superuser applier (Supabase `postgres`:
NOSUPERUSER CREATEROLE; stock equivalent `CREATE ROLE app CREATEROLE`) is
authorized per statement by the authorization state AT THAT POINT of the plan:
who owns the object, which roles the applier holds, which schema ACLs exist.
Every earlier fix patched one (statement kind × precondition × intermediate
state) triple inside the dependency graph, and wrote to `pg_auth_members`, which
the fact model reads lossily. This PoC replaces that with one pass that runs
after ordering + compaction and treats authorization as its own concern.

## Verified Postgres facts (probed on stock 15/17 and supabase/postgres 15.19/17.11)

- `ALTER … OWNER TO r` needs: privileges of the current owner; on PG16+ the SET
  option on `r` (≤15: membership); and **`r` itself** needs CREATE on the
  containing schema (the only check made against a role other than the applier).
- After `CREATE ROLE r` by a CREATEROLE non-superuser on PG16+: one
  `pg_auth_members` row (r, applier, grantor = bootstrap superuser, admin=t,
  inherit=f, set=f). `GRANT r TO applier` then adds a SECOND row (grantor =
  applier, admin=f, inherit=t, set=t). `REVOKE r FROM applier GRANTED BY applier`
  removes only that second row, whoever executes it. A bare `REVOKE r FROM
  applier` run by a superuser removes the bootstrap ADMIN row instead.
- PG≤15: one row per (role, member); grantor is ignored; a CREATEROLE role can
  grant itself any non-superuser role, even one created by someone else.
  PG16+: self-grant needs ADMIN on `r` (so: only roles the applier created).
- A schema owner can DROP any object in its schema without owning the object.
- supautils changes none of this. It only adds `supautils.reserved_memberships`
  (self-grant refused for `supabase_admin`, `supabase_*_admin`, `authenticator`,
  `pgbouncer`, `dashboard_user`, …). `createrole_self_grant` is empty on Supabase.

## Design

### 1. Capability probe v2 (`src/policy/capability.ts`)

Extend `ApplierCapability` (all new fields optional so legacy JSON still parses)
and `probeApplierCapability` (keep it ONE round trip):

- `inherit: boolean` — applier `rolinherit`.
- `usableRoles: string[]` — roles whose privileges the applier already has AND
  can hand objects to: `pg_has_role(current_user, r.oid, 'USAGE')` AND
  (PG16+: `pg_has_role(current_user, r.oid, 'SET')`; ≤15: `'MEMBER'`).
  Include `pg_database_owner` here when the applier is the current database's
  `datdba` (implicit membership). Do NOT filter `pg_%` out of this list.
- `adminOf: string[]` — `pg_has_role(current_user, r.oid, 'MEMBER WITH ADMIN OPTION')`
  (valid on 14+; if it errors on some version, fall back to reading
  `pg_auth_members.admin_option` for direct rows).
- `selfGrants: { role, admin, inherit, set }[]` — the applier's OWN-GRANTOR rows:
  PG16+: `pg_auth_members` where member = applier AND grantor = applier.
  ≤15: every direct row where member = applier (inherit = applier rolinherit,
  set = true).
- `reservedMemberships: string[]` — parsed `current_setting('supautils.reserved_memberships', true)`
  (comma list; entries may end with `*` meaning prefix match; empty when unset).
- Keep `memberOf` as is for existing callers.

### 2. Membership fidelity (`src/extract/roles.ts`, `src/plan/rules/roles.ts`)

Contract: pg-delta converges the EFFECTIVE membership options of (role, member)
— admin / set / inherit — not which grantor row carries them.

- `MEMBERSHIPS_SQL`: on PG16+ also `bool_or(set_option) AS set`,
  `bool_or(inherit_option) AS inherit`. On ≤15 emit `set = true` and
  `inherit = true` constants (version-gate inside the SQL via `to_jsonb(m)`, or
  two SQL variants — follow how the file already handles version differences).
  Payload becomes `{ admin, set, inherit }`.
- Membership rule: create renders `GRANT r TO m WITH ADMIN x, INHERIT y, SET z`
  on PG16+ only when it differs from the plain default (keep today's exact SQL
  for the common case so existing snapshots don't churn more than needed), add
  `set` / `inherit` attribute alters. The rule does not know the server version
  today; if there is no cheap way to pass it, render the options only when
  `set`/`inherit` deviate from (true, true).
- `capabilityExcludedRoots` (PG16+, CREATEROLE non-superuser): today it projects
  out every (r → applier, admin=true) fact, which also hides an explicit
  self-grant the user wants to keep. Change: project out only the PURE implicit
  row (admin=true AND set=false AND inherit=false). When set or inherit is true
  the fact stays; for those facts where member = applier the emitted SQL must
  NOT contain `ADMIN` (0LP01 "cannot be granted back to your own grantor"):
  create = `GRANT r TO applier WITH INHERIT <inherit>, SET <set>`,
  drop = `REVOKE r FROM applier GRANTED BY applier`. Do this rewrite in the
  authorization pass (section 3) where the capability is known, or pass the
  capability to the rule — whichever is smaller.

### 3. The authorization pass (new file `src/plan/phases/applier-authorization.ts`)

A pure function `authorizeForApplier(actions, ctx) → { actions, blockers }`,
called from `finalizeActions` AFTER ordering and compaction, only when
`capability !== undefined && !capability.isSuperuser`. `ctx` = `{ capability,
source, desired }` (the resolved views finalizeActions already has). It never
touches the dependency graph. It does four things, in this order:

**3a. Strata (stable partition of the ordered list).**
- FRONT: role `create` actions and membership widening actions (membership
  `create`, and alters that turn admin/set/inherit ON), in their existing
  relative order.
- BACK: membership narrowing actions (membership `drop`, alters that turn an
  option OFF) and role `drop` actions, in their existing relative order.
- Everything else stays in the middle, order untouched.
- Safety valve: never move an action that has `newSegmentBefore === true`, or a
  role drop whose id is re-produced by a later action; leave it where it is.
Rationale: role/membership statements depend only on roles, so hoisting grants
and sinking revokes is always dependency-safe, and it guarantees the applier
never loses a membership mid-plan (catalog cases C19, C6).

**3b. Schema-ACL monotonicity (middle stratum only).**
For every action whose `produces`/`consumes`/`destroys` touches an `acl` fact
whose target is a `schema`:
- NARROWING (the grantee's privilege set in `desired` is missing something it
  has in `source`, incl. the fact being removed) → move all actions of that acl
  id to the END of the middle stratum, keeping relative order.
- otherwise (new grantee or pure widening) → move all actions of that acl id
  to just after the action that produces the schema, or to the START of the
  middle stratum when the schema already exists.
Rationale: the applier or a future owner must never lose schema CREATE/USAGE
before the structural work is done, and must get it before it is needed
(C3, CLI-2340/E1, #564 finding 8, #563 bug 3). Compaction may have merged
several grantees into one statement; classify the action as narrowing if ANY of
its acl ids narrows.

**3c. Envelope (assume the owner roles).**
- `touched` = for every middle-stratum action, every role that owns — in
  `source` or in `desired` — any id in its `produces`/`consumes`/`destroys`, or
  any ancestor of such an id (walk `fact.parent`, and for `acl`/satellite ids
  their `target`, up to the schema; cap the walk at 8 hops), plus for
  `defaultPrivilege` ids the `role` they are FOR, plus for owner-change actions
  the new owner role (it is in `consumes`). Remove the applier itself.
- For each role `r` in `touched`, in sorted order:
  1. `r ∈ capability.usableRoles` → nothing.
  2. A FRONT-stratum membership action makes (r → applier) hold set && inherit
     in `desired` → nothing (the plan's own grant covers it).
  3. Self-grant possible →
     PG≤15: `capability.createRole && capability.inherit && r is not a superuser
     role (role fact payload) && r not reserved`.
     PG16+: `(r ∈ capability.adminOf || r is created by this plan) && r not reserved`.
     → emit OPEN `GRANT r TO applier` (+ ` WITH INHERIT TRUE, SET TRUE` on PG16+)
     and CLOSE = restore the applier's own-grantor row to what it was:
       - no `selfGrants` row for r → `REVOKE r FROM applier` (+ ` GRANTED BY applier` on PG16+);
       - a row existed with other options (PG16+) → `GRANT r TO applier WITH INHERIT <old>, SET <old>`;
       - if a FRONT membership action already set this row to a desired value,
         CLOSE restores the DESIRED options instead.
     If the plan drops role `r`, skip CLOSE (DROP ROLE removes the row).
  4. Otherwise → push a blocker `{ code: "capability_owner", role: r, reason,
     objects: [encoded ids that needed it] }` with a reason that says which rule
     failed ("role was not created by the applier (PG16+ needs ADMIN)",
     "membership is reserved by supautils", "NOINHERIT applier on PG≤15", "role
     is a superuser", "built-in role").
- OPEN statements go right after the FRONT stratum; CLOSE statements right
  after the middle stratum (before the BACK stratum). All OPEN/CLOSE actions are
  ordinary `Action`s (`verb: "alter"`, transactional, empty produces/destroys,
  `consumes: [role id]`).
- Use the applier's NAME (`qid(capability.role)`), never `CURRENT_USER`.

**3d. New owner needs CREATE on the schema (local temp grant).**
Walk the final list once, tracking for each schema: `ownerNow` (start from
`source` owner edges; update when passing a schema owner change or a `CREATE
SCHEMA … AUTHORIZATION`) and `createNow` (set of roles with a direct CREATE
entry; start from `source` acl facts; update when passing a schema-acl action
to the `desired` value). For each owner-change action on an object that lives
in schema `s` with new owner `r`: if `r !== ownerNow(s)` and `r ∉ createNow(s)`,
wrap it: `GRANT CREATE ON SCHEMA s TO r` immediately before and
`REVOKE CREATE ON SCHEMA s FROM r` immediately after. (A superfluous temp grant
restores exactly; a missing one fails the apply.) Add `ownerNow(s)` to `touched`
before 3c runs if a temp grant is needed (the applier must own `s` to grant).
Schemas themselves, and objects not in a schema, are not wrapped.

### 4. Blockers instead of plan-time throws

- Remove both `canSetOwner` throw sites in `src/plan/phases/action-emitter.ts`.
- `Plan` gains `blockers: PlanBlocker[]` (omit the field when empty so existing
  artifacts/snapshots stay byte-identical; make sure it is part of what `planId`
  hashes when present).
- Export a typed `CapabilityError` (`code: "capability_owner"`, `blockers`).
  `apply()` (and `provePlan`) throw it before running anything when
  `plan.blockers?.length`. `plan()` itself never throws for this, so a read-only
  diff always renders.

### 5. Identity guard

A plan containing envelope actions is bound to `capability.role`. `apply()`
checks `SELECT current_user` once before the first segment when the plan
carries a non-superuser capability with envelope actions, and refuses with a
clear typed error if it differs. (Covers C8/C13 by construction.)

### 6. Owned sequences (plain ordering bug, not authorization — C17)

Postgres refuses `ALTER SEQUENCE … OWNER TO` on a sequence linked to a table
(`OWNED BY`, serial/identity) unless the owner already matches, and refuses
`OWNED BY` when sequence and table owners differ; `ALTER TABLE … OWNER TO`
cascades to linked sequences. Rule: when a sequence is linked in `source`, emit
no owner action for it (its table's owner change carries it). When the link is
created by this plan, its owner action(s) — sequence and table — must precede
the `OWNED BY` action. Implement the smallest version that makes scenario
`k08-c17-bigserial-owned-sequence` pass and the corpus stay green; if the
ordering half needs graph edges, add them in `buildActionGraph`'s caller the way
`chainColumnCreatesByPosition` does.

## Explicitly out of scope (must be a blocker or a loud apply error, never silent)

- An owner role the applier cannot assume (PG16+ role created by someone else;
  supautils-reserved membership; superuser role; NOINHERIT applier on PG≤15).
- Grant provenance: which grantor row carries a membership option.
- Owner changes whose new owner needs something that is not a schema CREATE
  (publication → CREATE on database; FDW / event trigger → superuser).
- A plan executed by a role other than the one it was planned for.
- A failure in a later transaction segment leaves the envelope open; with
  section 2 the leftover is visible to the next plan as a membership delta.

---

# REVISION 2 (after adversarial design review) — these override the sections above

Guiding rule: the pass must be SOUND OR LOUD. It never predicts Postgres's
authorization in order to refuse. It refuses only on rules that are exact, and
otherwise lets the apply fail with Postgres's own error.

R1. Blockers are EXACT rules only (replaces 3c step 4 and the "touched role is
    not assumable → blocker" idea). Emit a blocker only when:
    (a) an owner-change action's NEW owner `r` is neither settable by the
        applier (`capability.settableRoles`) nor self-grantable; or
    (b) an owner-change action targets an object that exists in `source` whose
        SOURCE owner is neither usable nor self-grantable.
    A role in `touched` that cannot be assumed for any other reason is silently
    skipped (no envelope, no blocker): the applier may still be authorized some
    other way (schema owner may DROP, CREATE needs only schema CREATE, …).
    `k09b` (NOINHERIT applier on PG≤15) stays a blocker through rule (a)/(b):
    a NOINHERIT applier on ≤15 cannot make a temporary membership usable.

R2. Probe: `adminOf` = DIRECT `pg_auth_members` rows only (member = applier AND
    admin_option), never `pg_has_role(... 'ADMIN OPTION')` (that counts ADMIN
    inherited through another role, where Postgres would record a different
    grantor and the close would be a silent no-op). Add `settableRoles`
    (PG16+: `pg_has_role(current_user, r, 'SET')`; ≤15: `'MEMBER'`), separate
    from `usableRoles` (USAGE AND settable). On PG16+ BOTH the open and the
    close statement carry an explicit `GRANTED BY <applier>` so a mismatch fails
    loudly instead of creating a row under another grantor.

R3. `touched` is a generic one-hop closure over the fact graph (no per-kind
    table): owners (source and desired) of the action's produced / consumed /
    destroyed ids and their ancestors, PLUS owners of the targets of those ids'
    outgoing dependency edges (source and desired), PLUS owners of inheritance /
    partition descendants of any touched relation. Over-inclusion only costs an
    extra GRANT/REVOKE pair; a miss is a loud apply error.

R4. 3d temp schema CREATE: treat `r` as already having CREATE when PUBLIC has a
    CREATE entry on the schema too. Emit the temp pair only when the applier can
    act as `ownerNow(s)` (it is the applier, usable, or in the envelope).
    Otherwise emit nothing and add no blocker.

R5. Strata moves (3a, 3b) are BOUNDED, never blanket: hoist an action only to
    just after the last earlier action that produces an id it consumes; sink it
    only to just before the first later action that consumes or destroys an id
    it produces, or that drops/renames a role it names. Role renames are never
    moved and nothing is moved across a rename of a role it names. A membership
    grant `x → y` must stay after a same-plan revoke of the reverse pair
    `y → x` (Postgres forbids membership cycles). Envelope OPEN for `r` goes
    after whichever action produces role `r` (create or rename), CLOSE uses the
    role's name at that point of the plan.

R6. Membership rendering on PG16+: ALWAYS explicit `WITH INHERIT x, SET y`
    (a plain GRANT takes INHERIT from the member's role attribute). Emit the
    `set` / `inherit` payload fields only when extracting from PG16+, and render
    the options iff the payload carries them, so ≤15 SQL is unchanged.

R7. §6 owned sequences: suppress the sequence's own owner action only when it
    is linked to the SAME table in both source and desired. If the link is
    created, removed, or moved by the plan, keep the owner action and order it
    so that at each `OWNED BY` the sequence and table owners match.

---

# REVISION 3 (after adversarial round 2 on the implementation + Supabase runs + Codex)

Root finding of round 2: the envelope makes the applier INHERIT every opened
role, and Postgres chooses the GRANTOR of a GRANT/REVOKE (object ACLs and, on
PG16+, memberships) from the whole inherited set. So a grant-family statement
run by the widened applier can silently record the wrong grantor or revoke
nothing (scenarios b01, b02, b06, b07). Design invariant from now on:

  Only grant-family statements have semantics that depend on WHO runs them.
  Every such statement must run under exactly one explicit identity.
  Everything else (CREATE, ALTER, DROP, COMMENT, owner changes) either errors
  or has one deterministic effect, so it may run as the widened applier.

T1. Object-ACL statements (any action whose produced/destroyed/consumed ids
    include an `acl` fact, plus the temp schema-CREATE wrapper) run AS THE
    OBJECT'S OWNER AT THAT POINT of the plan: emit `SET ROLE <owner>` before and
    `RESET ROLE` after (merge adjacent brackets for the same role; never leave a
    bracket open across a `newSegmentBefore` boundary or a non-transactional
    statement). No bracket when the owner is the applier, is unknown, or is a
    built-in `pg_*` role. The owner at that point = source owner, updated by
    earlier owner-change actions; objects created by the plan are applier-owned
    until their owner change. This reproduces superuser semantics (a superuser
    acts as the owner, so the owner is the recorded grantor).
    When the owner is not settable by the applier and not in the envelope:
    run un-bracketed as today, EXCEPT emit a blocker
    (`code: "capability_acl_grantor"`) when some role the envelope opens holds a
    grant option on that object (source or desired ACL) — that is the exact
    hazard condition under which our own widening could change the grantor.
T2. Membership statements, PG16+, non-superuser capability: ALL of them (not
    only member = applier) carry explicit `GRANTED BY <applier>`, and option
    alters render the FULL desired `WITH INHERIT x, SET y` (and ADMIN where
    allowed), never a single option (b10).
T3. Membership provenance blocker (exact rule): extract, as a NON-semantic
    field on PG16+ membership facts (underscore-prefixed, not hashed), the raw
    rows `_rows: [{grantor, admin, inherit, set}]`. When the plan must turn an
    option OFF (or drop the membership) and that option is carried by a row
    whose grantor is not the applier, emit a blocker
    (`code: "capability_membership_grantor"`, naming the grantor) instead of a
    REVOKE that only warns (a11, b07 forward, Codex #2).
T4. Blocker rule (b) — CURRENT owner of an owner-changed object — needs only the
    owner's privileges (USAGE / inherit), not SET (b12, Codex #1). Add
    `inheritedRoles` (pg_has_role USAGE) to the probe and use it there; rule (a)
    (new owner) keeps requiring SET.
T5. An ACL statement is never moved across an owner change of its target
    (Postgres rewrites the old owner's ACL items to the new owner on
    `ALTER … OWNER TO`) (Codex #3).
T6. Unknown schema owner. Carry the raw owner name as a non-semantic `_owner`
    payload field on schema facts (so `public` → `pg_database_owner` is known
    without an owner edge and without changing export output or hashes), and
    when a schema has neither an owner edge nor `_owner` in the view (Supabase
    profile prunes the edge to the default owner) fall back to
    `capability.role`. Use it for `ownerNow(schema)` so the temp schema-CREATE
    wrapper is emitted for `public` (applier is the database owner ⇒
    `pg_database_owner` is in `usableRoles`) and under the Supabase profile
    (scenarios s03, k11, k13 on Supabase, b14, s05 reverse).

Loud completeness gaps left as backlog (do NOT fix in this round): b04, b09,
b11 (role rename), a13 (owned-sequence relink ordering), k19 / s06 (publication
owner needs CREATE on the database), k14a / k14b (owner change of `public`
itself: needs the `pg_*` owner EDGE, a product decision about export output).
