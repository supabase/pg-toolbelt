/**
 * Regression for issue #333 item 1 (P1 destructive): `DROP OWNED BY` in the
 * role-drop rule is a sledgehammer — it silently destroys any object the
 * role owns OUTSIDE the managed/projected view (never extracted by the
 * engine). Managed grants, default ACLs, and owned objects are already
 * revoked/reassigned/dropped by their own plan actions before the role drop
 * runs, so a plain `DROP ROLE` is sufficient when everything is managed, and
 * fails loud (instead of silently destroying data) when it isn't.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../../core/fact.ts";
import { plan } from "../plan.ts";
import { roleRules } from "./roles.ts";

const roleFact: Fact = {
  id: { kind: "role", name: "somerole" },
  payload: {
    superuser: false,
    inherit: true,
    createRole: false,
    createDb: false,
    login: false,
    replication: false,
    bypassRls: false,
    config: [],
  },
};

describe("role drop", () => {
  test("emits a plain DROP ROLE, never DROP OWNED BY", () => {
    const spec = roleRules.role!.drop!(roleFact);
    const sql = Array.isArray(spec) ? spec.map((s) => s.sql) : spec.sql;
    expect(sql).toBe(`DROP ROLE "somerole"`);
  });
});

describe("membership self row (PG16+ grant whose grantor is the member)", () => {
  const role = (name: string): Fact => ({
    ...roleFact,
    id: { kind: "role", name },
  });
  const membership = (payload: Fact["payload"]): Fact => ({
    id: { kind: "membership", role: "r", member: "m" },
    payload,
  });
  const fb = (m?: Fact) =>
    buildFactBase([role("r"), role("m"), ...(m ? [m] : [])], []);
  const steps = (from: Fact | undefined, to: Fact | undefined) =>
    plan(fb(from), fb(to)).actions.map((a): unknown[] => [
      a.sql,
      a.verb,
      a.change,
    ]);
  const self = (inherit: boolean, set: boolean) => ({
    admin: true,
    self: { inherit, set },
  });

  test("a membership without one renders as before", () => {
    expect(steps(undefined, membership({ admin: true }))).toEqual([
      [`GRANT "r" TO "m" WITH ADMIN OPTION`, "create", undefined],
    ]);
    expect(steps(membership({ admin: false }), undefined)).toEqual([
      [`REVOKE "r" FROM "m"`, "drop", undefined],
    ]);
  });

  test("create grants the membership, then the member's own row", () => {
    expect(steps(undefined, membership(self(true, false)))).toEqual([
      [`GRANT "r" TO "m" WITH ADMIN OPTION`, "create", undefined],
      [
        `GRANT "r" TO "m" WITH INHERIT TRUE, SET FALSE GRANTED BY "m"`,
        "alter",
        { kind: "attribute", name: "self" },
      ],
    ]);
  });

  test("drop revokes the member's own row first (it depends on the ADMIN row)", () => {
    expect(steps(membership(self(true, true)), undefined)).toEqual([
      [
        `REVOKE "r" FROM "m" GRANTED BY "m"`,
        "alter",
        { kind: "attribute", name: "self" },
      ],
      [`REVOKE "r" FROM "m"`, "drop", undefined],
    ]);
  });

  test("adding, changing and removing the row touch only that row", () => {
    const change = { kind: "attribute", name: "self" };
    expect(
      steps(membership({ admin: true }), membership(self(false, true))),
    ).toEqual([
      [
        `GRANT "r" TO "m" WITH INHERIT FALSE, SET TRUE GRANTED BY "m"`,
        "alter",
        change,
      ],
    ]);
    expect(
      steps(membership(self(false, true)), membership(self(true, true))),
    ).toEqual([
      [
        `GRANT "r" TO "m" WITH INHERIT TRUE, SET TRUE GRANTED BY "m"`,
        "alter",
        change,
      ],
    ]);
    expect(
      steps(membership(self(true, true)), membership({ admin: true })),
    ).toEqual([[`REVOKE "r" FROM "m" GRANTED BY "m"`, "alter", change]]);
  });
});
