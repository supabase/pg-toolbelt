/**
 * CREATE EXTENSION emits `SCHEMA <s>` iff schema `s` will EXIST when the
 * statement runs — present on the target (source view, incl. reference-only
 * platform schemas like Supabase's `extensions`) OR created by this plan (a
 * managed, non-reference-only desired schema). Otherwise the extension creates
 * its own schema from its control file (pgmq), so the clause would fail against
 * a not-yet-existing schema — emit the bare form. Built-in schemas (pg_catalog,
 * pg_cron's target) are never extracted, so they also fall to bare. A schema
 * the control file pins and the target already holds (possibly only assumed)
 * is bare too: Postgres finds or creates it.
 *
 * This is a PLAN-TIME property. `relocatable` / `_schemaIsMember` cannot express
 * it: the `deptype='e'` schema→extension edge never exists (Postgres does not
 * record extension ownership of schemas), so `_schemaIsMember` was always false
 * and the rule always emitted the clause — breaking pgmq and pg_cron (da8ce04).
 */
import { describe, expect, test } from "bun:test";
import type { Fact } from "../../core/fact.ts";
import type { Payload } from "../../core/hash.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { FactView } from "../rules.ts";
import { schemaRules } from "./schemas.ts";

/** Minimal FactView: `present` ids resolve via get(); `refOnly` ids report
 *  reference-only. Everything else the extension create rule ignores. */
function view(present: StableId[], refOnly: StableId[] = []): FactView {
  const keys = new Set(present.map(encodeId));
  const ro = new Set(refOnly.map(encodeId));
  return {
    get: (id) =>
      keys.has(encodeId(id)) ? ({ id, payload: {} } as Fact) : undefined,
    isReferenceOnly: (id) => ro.has(encodeId(id)),
    childrenOf: () => [],
    facts: () => [],
    outgoingEdges: () => [],
    incomingEdges: () => [],
    edges: [],
  };
}

const EMPTY = view([]);
const sch = (name: string): StableId => ({ kind: "schema", name });

function createSql(
  payload: Payload,
  sourceView: FactView,
  desiredView: FactView = EMPTY,
): string {
  const fact: Fact = { id: { kind: "extension", name: "x" }, payload };
  return schemaRules.extension!.create(
    fact,
    desiredView,
    undefined,
    sourceView,
  )[0]!.sql;
}

describe("CREATE EXTENSION schema clause (presence-based)", () => {
  test("non-relocatable ext into a schema present on the target → SCHEMA (pg_net)", () => {
    // `extensions` is reference-only in both views (Supabase platform schema)
    // but physically present on the target → the clause is valid + needed.
    expect(
      createSql(
        { schema: "extensions", _relocatable: false },
        view([sch("extensions")], [sch("extensions")]),
        view([sch("extensions")], [sch("extensions")]),
      ),
    ).toBe(`CREATE EXTENSION "x" SCHEMA "extensions"`);
  });

  test("relocatable ext into a present schema → SCHEMA (citext, unchanged)", () => {
    expect(
      createSql(
        { schema: "extensions", _relocatable: true },
        view([sch("extensions")], [sch("extensions")]),
      ),
    ).toBe(`CREATE EXTENSION "x" SCHEMA "extensions"`);
  });

  test("ext whose schema is created by THIS plan (managed desired) → SCHEMA", () => {
    // schema present in desired and NOT reference-only → produced by the plan;
    // the `consumes` edge orders CREATE SCHEMA first. Absent from the target.
    expect(
      createSql(
        { schema: "app", _relocatable: false },
        EMPTY,
        view([sch("app")], []),
      ),
    ).toBe(`CREATE EXTENSION "x" SCHEMA "app"`);
  });

  test("ext that creates its OWN schema (absent target, reference-only desired) → bare (pgmq)", () => {
    // RED before the fix: the old gate emitted `SCHEMA "pgmq"`, which fails at
    // apply because pgmq does not exist until CREATE EXTENSION creates it.
    expect(
      createSql(
        { schema: "pgmq", _relocatable: false, _schemaIsMember: false },
        EMPTY,
        view([sch("pgmq")], [sch("pgmq")]),
      ),
    ).toBe(`CREATE EXTENSION "x"`);
  });

  test("ext into a built-in schema (never extracted) → bare (pg_cron / pg_catalog)", () => {
    // RED before the fix: emitted `SCHEMA "pg_catalog"`, which trips the
    // requirement guard (pg_catalog is not a fact and not assumed).
    expect(
      createSql(
        { schema: "pg_catalog", _relocatable: false, _schemaIsMember: false },
        EMPTY,
        EMPTY,
      ),
    ).toBe(`CREATE EXTENSION "x"`);
  });
});

describe("CREATE EXTENSION schema clause (control-file-pinned schema)", () => {
  const pinned = (schema: string, controlSchema: string): Payload => ({
    schema,
    _relocatable: false,
    _controlSchema: controlSchema,
  });
  const create = (payload: Payload, sourceView: FactView, desired: FactView) =>
    schemaRules.extension!.create(
      { id: { kind: "extension", name: "x" }, payload },
      desired,
      undefined,
      sourceView,
    )[0]!;

  test("schema only assumed on the target (export seed) → bare", () => {
    // Export seeds reference-only schemas into its pristine source, so `pgmq`
    // looks present although a fresh Supabase database does not have it.
    const action = create(
      pinned("pgmq", "pgmq"),
      view([sch("pgmq")], [sch("pgmq")]),
      view([sch("pgmq")], [sch("pgmq")]),
    );
    expect(action.sql).toBe(`CREATE EXTENSION "x"`);
    expect(action.consumes).toEqual([sch("pgmq")]);
  });

  test("schema created by this plan → SCHEMA, ordered after CREATE SCHEMA", () => {
    // The clause keeps the exported extension file failing until CREATE SCHEMA
    // has run, so any load order converges.
    const action = create(pinned("app", "app"), EMPTY, view([sch("app")]));
    expect(action.sql).toBe(`CREATE EXTENSION "x" SCHEMA "app"`);
    expect(action.consumes).toEqual([sch("app")]);
  });

  test("schema a real fact on the target → bare", () => {
    const action = create(
      pinned("pgmq", "pgmq"),
      view([sch("pgmq")]),
      view([sch("pgmq")]),
    );
    expect(action.sql).toBe(`CREATE EXTENSION "x"`);
    expect(action.consumes).toEqual([sch("pgmq")]);
  });

  test("control file pinning a different schema → presence logic", () => {
    expect(
      createSql(
        pinned("extensions", "other"),
        view([sch("extensions")], [sch("extensions")]),
        view([sch("extensions")], [sch("extensions")]),
      ),
    ).toBe(`CREATE EXTENSION "x" SCHEMA "extensions"`);
  });
});
