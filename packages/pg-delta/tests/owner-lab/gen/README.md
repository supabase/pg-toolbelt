# owner-lab scenario generator

Systematic coverage of the ownership combination space. Both states of every
scenario are built by the applier alone (no superuser steps), so the desired
state is reachable by that applier and the ideal outcome is always `converge`.

    bun packages/pg-delta/tests/owner-lab/gen/generate.ts [--out <dir>] [--only <regex>]

Writes one directory per scenario under `tests/owner-lab/generated/` (default
`--out`): `a.sql`, `b.sql`, `meta.json` (`ideal`, `tags`, `notes`, plus
`minVersion` / `applierInherit` / `dbOwner` where needed). The generator
removes its own previous `g-*` output first (only matching dirs with `--only`)
and is deterministic: no randomness, no timestamps. Run the output through the
lab like any scenario: `bun tests/owner-lab/lab.ts --image postgres:17-alpine
tests/owner-lab/generated/<dir>...`.

Files: `kinds.ts` (object-kind library), `generate.ts` (transitions, side
builder, coverage plan, CLI).

## Dimensions

- **KIND** (16): `table` (pk + index), `table-rls` (RLS + policy for `reader` +
  trigger and its function), `serial`, `identity`, `partitioned` (parent and
  partition both re-owned), `view`, `matview`, `function` (sql, SECURITY
  DEFINER, SET search_path), `procedure`, `aggregate`, `sequence`, `composite`,
  `enum`, `domain`, `schema` (the schema is the object, with a table inside),
  `publication` (FOR TABLE one table; needs CREATE on the database).
- **TRANSITION** (source owner -> desired owner): `new-to-r`, `app-to-r`,
  `r1-to-r2`, `r-modify`, `r-modify-acl`, `r-drop`, `r-drop-role`,
  `r-to-app-drop-role`. Modification per kind: add a column, replace the body,
  add an enum value / composite attribute, change the check / increment /
  INITCOND / policy, add a table to the publication or schema.
  `r-modify-acl` grants to `grantee_new` and revokes from `grantee_old`.
- **MEMBERSHIP** of the applier in the owner role(s) (`r`, `r1`/`r2`, and
  `holder`): `none` (granted for the build, revoked at the end), `kept`,
  `kept-desired`, `kept-source`.
- **SCHEMA**: `own`, `r-owned` (owned by the object's owner on that side: `r`,
  `r1`/`r2`, or the applier while the object is applier-owned), `other-owned`
  (`s_owner`, applier holds `USAGE, CREATE WITH GRANT OPTION`), `public`, and
  `self` (kind `schema` only).
- **CREATE** (new owner's CREATE on the schema): `direct` (kept), `temp`
  (granted around the owner change), `public-grant` (`GRANT CREATE ... TO
  PUBLIC` kept), `na`.
- **ACL**: `none`, `reader`, `holder` (holder gets the privilege WITH GRANT
  OPTION, then `SET ROLE holder` grants it to `reader`; holder also owns
  `holder_t` in the same schema, modified in the desired state), `na`.
- **MODIFIER**: `none`, `enum-boundary`, `two-objects`, `noinherit`
  (`applierInherit=false`, `minVersion` 16), `dbowner-super`.

## Coverage plan and buckets

1. `core`: every KIND x TRANSITION, membership none, schema own, CREATE temp,
   ACL reader, no modifier.
2. `pairwise`: KIND in {table-rls, function, view, serial} x TRANSITION in
   {new-to-r, app-to-r, r1-to-r2, r-modify, r-modify-acl}; per cell a greedy
   all-pairs set over MEMBERSHIP x SCHEMA x CREATE x ACL (every valid pair of
   values of two dimensions appears at least once per cell).
3. `modifiers`: each MODIFIER x KIND in {table-rls, function, enum} x TRANSITION
   in {new-to-r, r1-to-r2, r-modify}, other dimensions at the core values.

A scenario that falls in several buckets is generated once, under the first.
The generator prints the count per bucket and the total.

## Names

`g-<kind>--<transition>--mem-<m>--sch-<s>--create-<c>--acl-<a>[--mod-<x>]`

- kind: `tbl rls ser idn part view mv fn proc agg seq comp enum dom sch pub`
- transition: as above; `mem-`: `none kept kept-desired kept-source`
- `sch-`: `own rown other public self`; `create-`: `direct temp public-grant na`
- `acl-`: `none reader holder na`; `mod-` only when not `none`.

`meta.json` `tags` carry the same values (`kind:`, `transition:`, `membership:`,
`schema:`, `create:`, `acl:`, `modifier:`, `bucket:`) and `needs-db-create` for
kind `schema`, kind `publication` and schema `r-owned` (new owner needs CREATE
on the database; granted and revoked around the move with a `DO` block).

## How a side is built

`a.sql` and `b.sql` come from the same `buildSide`: roles, membership grants,
schema, supporting objects (base tables, sfunc), the object (applier-owned,
modified variant when the transition says so), ACL, `holder_t`, then the owner
moves with temp grants, schema move last, then the revokes. Everything that
needs ownership happens while the applier still owns the object, so `noinherit`
needs no `SET ROLE r`: the applier only needs the SET option on the new owner
(default of `GRANT r TO current_user`). `SET ROLE holder` is used for the grant
made by holder; it works without inheriting.

## Excluded or collapsed combinations

- `publication` x `r-modify-acl`: publications have no privileges. Excluded.
- `publication` ACL `reader`/`holder`: no privileges, collapsed to `acl-na`.
- SCHEMA `r-owned` x `r-drop-role`: the schema owner would disappear with the
  role; excluded (pairwise never uses `r-drop-role`).
- CREATE for kind `schema`, kind `publication` and SCHEMA `r-owned`: not
  applicable, collapsed to `create-na` (internally `temp`, so `holder_t` and
  the object can still move; the schema moves last).
- SCHEMA for kind `schema`: collapsed to `self`.
- `public` schema carries `minVersion` 15 (applier cannot grant on PG14's
  superuser-owned `public`).
- `noinherit` carries `minVersion` 16; the lab skips it on 15.
- `dbowner-super` is not combined with `publication`/`schema` kinds (the
  applier could not grant CREATE on the database); the modifier bucket only
  uses table-rls, function, enum.
- Not applied: ACL on the second object of `two-objects`.

## Fidelity notes

- The membership bracket and the temp CREATE grants are hoisted to the start /
  end of the side instead of wrapping each ALTER; the resulting catalog is the
  same. Temp grants are also made on sides that move nothing, so schema ACLs
  stay uniform across a.sql and b.sql.
- `enum-boundary`: the desired side creates the unrelated enum with both
  values directly (a multi-statement script runs in one transaction, which
  cannot use a value added by `ALTER TYPE ... ADD VALUE`); the plan still has
  to add the value and use it in a default.
- `r-owned` schema owner follows the object's owner on that side (applier when
  applier-owned), so the schema owner changes in the same plan.
