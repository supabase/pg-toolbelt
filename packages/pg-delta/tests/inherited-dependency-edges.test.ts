/**
 * Partition / inheritance children carry catalog objects PostgreSQL materializes
 * from the parent — inherited columns, cloned constraints (incl. the per-partition
 * FK clones on the referencing table), attached indexes, copied defaults and
 * cloned triggers. None is extracted as a fact, so a pg_depend edge touching one
 * must not dangle: as a dependency target it resolves to the parent's modeled
 * object (a view over a partition column keeps its edge), and its own deps are
 * dropped rather than re-pointed onto the parent.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeId } from "../src/core/stable-id.ts";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let result: ExtractResult;

beforeAll(async () => {
  db = await createTestDb("inh-edges");
  await db.pool.query(/* sql */ `
    create table public.messages (
      id bigint generated always as identity,
      inserted_at timestamptz not null default now(),
      body text,
      primary key (id, inserted_at)
    ) partition by range (inserted_at);
    create table public.messages_2024 partition of public.messages
      for values from ('2024-01-01') to ('2025-01-01');
    create table public.messages_default partition of public.messages default;
    create table public.messages_2025 partition of public.messages
      for values from ('2025-01-01') to ('2026-01-01') partition by hash (id);
    create table public.messages_2025_h0 partition of public.messages_2025
      for values with (modulus 1, remainder 0);
    create index on public.messages (body);
    create table public.reactions (
      id int primary key, msg_id bigint, msg_at timestamptz,
      foreign key (msg_id, msg_at) references public.messages (id, inserted_at)
    );
    create function public.touch() returns trigger
      language plpgsql as $$begin return new; end$$;
    create trigger messages_touch before update on public.messages
      for each row execute function public.touch();
    -- local objects over inherited partition columns
    create index messages_2024_at_idx on public.messages_2024 (inserted_at);
    create view public.recent as select id, body from public.messages_2025_h0;
    -- a reference to the identity column's backing sequence
    create view public.next_id as
      select nextval('public.messages_id_seq'::regclass) as id;
    create table public.pins (
      msg_id bigint, msg_at timestamptz,
      foreign key (msg_id, msg_at) references public.messages_2024 (id, inserted_at)
    );
    -- legacy (multiple) inheritance: inherited columns + inherited CHECK
    create table public.base (v int check (v > 0));
    create table public.other (w int);
    create table public.child (extra int) inherits (public.base, public.other);
    create view public.child_v as select v, w from public.child;
  `);
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

describe("inherited partition/child objects in pg_depend edges", () => {
  test("no dangling_edge diagnostics", () => {
    expect(
      result.diagnostics
        .filter((d) => d.code === "dangling_edge")
        .map((d) => d.message),
    ).toEqual([]);
  });

  test("edges resolve to the parent's modeled objects", () => {
    // PG14 records view _RETURN self-deps (PG15+ does not); drop them so the
    // snapshot holds across the version matrix
    const edges = result.factBase.edges
      .filter((e) => e.kind === "depends")
      .map((e) => [encodeId(e.from), encodeId(e.to)])
      .filter(([from, to]) => from !== to && to !== "schema:public")
      .map(([from, to]) => `${from} -> ${to}`)
      .sort();
    expect(edges).toMatchInlineSnapshot(`
      [
        "constraint:public.base.base_v_check -> column:public.base.v",
        "constraint:public.messages.messages_pkey -> column:public.messages.id",
        "constraint:public.messages.messages_pkey -> column:public.messages.inserted_at",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> column:public.messages.id",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> column:public.messages.inserted_at",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> column:public.pins.msg_at",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> column:public.pins.msg_id",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> constraint:public.messages.messages_pkey",
        "constraint:public.pins.pins_msg_id_msg_at_fkey -> table:public.messages_2024",
        "constraint:public.reactions.reactions_msg_id_msg_at_fkey -> column:public.messages.id",
        "constraint:public.reactions.reactions_msg_id_msg_at_fkey -> column:public.messages.inserted_at",
        "constraint:public.reactions.reactions_msg_id_msg_at_fkey -> column:public.reactions.msg_at",
        "constraint:public.reactions.reactions_msg_id_msg_at_fkey -> column:public.reactions.msg_id",
        "constraint:public.reactions.reactions_msg_id_msg_at_fkey -> constraint:public.messages.messages_pkey",
        "constraint:public.reactions.reactions_pkey -> column:public.reactions.id",
        "default:public.messages.inserted_at -> column:public.messages.inserted_at",
        "index:public.messages_2024_at_idx -> column:public.messages.inserted_at",
        "index:public.messages_2024_at_idx -> table:public.messages_2024",
        "index:public.messages_2024_body_idx -> column:public.messages.body",
        "index:public.messages_2024_body_idx -> table:public.messages_2024",
        "index:public.messages_2025_body_idx -> column:public.messages.body",
        "index:public.messages_2025_body_idx -> table:public.messages_2025",
        "index:public.messages_2025_h0_body_idx -> column:public.messages.body",
        "index:public.messages_2025_h0_body_idx -> table:public.messages_2025_h0",
        "index:public.messages_body_idx -> column:public.messages.body",
        "index:public.messages_default_body_idx -> column:public.messages.body",
        "index:public.messages_default_body_idx -> table:public.messages_default",
        "table:public.child -> table:public.base",
        "table:public.child -> table:public.base",
        "table:public.child -> table:public.other",
        "table:public.child -> table:public.other",
        "table:public.messages_2024 -> table:public.messages",
        "table:public.messages_2024 -> table:public.messages",
        "table:public.messages_2025 -> table:public.messages",
        "table:public.messages_2025 -> table:public.messages",
        "table:public.messages_2025_h0 -> table:public.messages_2025",
        "table:public.messages_2025_h0 -> table:public.messages_2025",
        "table:public.messages_default -> table:public.messages",
        "table:public.messages_default -> table:public.messages",
        "trigger:public.messages.messages_touch -> function:public.touch()",
        "trigger:public.messages.messages_touch -> table:public.messages",
        "view:public.child_v -> column:public.base.v",
        "view:public.child_v -> column:public.other.w",
        "view:public.child_v -> table:public.child",
        "view:public.next_id -> column:public.messages.id",
        "view:public.recent -> column:public.messages.body",
        "view:public.recent -> column:public.messages.id",
        "view:public.recent -> table:public.messages_2025_h0",
      ]
    `);
  });
});
