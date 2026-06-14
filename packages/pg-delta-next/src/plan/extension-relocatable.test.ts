/**
 * The `CREATE EXTENSION … SCHEMA` clause is derived from the extension's
 * `relocatable` fact field (docs/managed-view-architecture.md, move 2), NOT a
 * `skipSchema` serialize param. A relocatable extension honours a SCHEMA clause
 * (and must be ordered after that schema); a non-relocatable extension creates
 * its own schema, so it neither emits SCHEMA nor requires the schema to exist.
 *
 * No Docker required — synthetic fact bases exercise the rule + planner wiring.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const publicSchema: StableId = { kind: "schema", name: "public" };
const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

describe("extension SCHEMA clause derived from relocatable", () => {
  test("a non-relocatable extension does not require its schema to pre-exist", () => {
    const pgmq: StableId = { kind: "extension", name: "pgmq" };
    const source = buildFactBase([f(publicSchema)], []);
    // desired adds pgmq (non-relocatable, installs its own `pgmq` schema). The
    // `pgmq` schema is NOT present as a fact and is NOT produced by the plan.
    const desired = buildFactBase(
      [f(publicSchema), f(pgmq, { schema: "pgmq", relocatable: false })],
      [],
    );

    // RED today: the rule always emits `SCHEMA pgmq` + `consumes` the pgmq
    // schema → the missing-requirement guard throws. GREEN: bare CREATE, no
    // schema requirement, exactly one action.
    const thePlan = plan(source, desired);
    expect(thePlan.actions).toHaveLength(1);
  });

  test("a relocatable extension is ordered after (requires) its target schema", () => {
    const hstore: StableId = { kind: "extension", name: "hstore" };
    const source = buildFactBase([f(publicSchema)], []);
    // relocatable extension targeting `app`, but `app` is absent → the create
    // consumes a schema that neither exists nor is produced → guard throws.
    const desired = buildFactBase(
      [f(publicSchema), f(hstore, { schema: "app", relocatable: true })],
      [],
    );

    expect(() => plan(source, desired)).toThrow(/missing requirement/);
  });
});
