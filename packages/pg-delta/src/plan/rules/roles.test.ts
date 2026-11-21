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
import type { Fact } from "../../core/fact.ts";
import type { FactView } from "../rules.ts";
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

describe("membership options (PG16+ INHERIT / SET)", () => {
  const rules = roleRules.membership!;
  const id = { kind: "membership", role: "r", member: "somerole" } as const;
  const viewOf = (facts: Fact[]): FactView =>
    ({
      get: (x: { kind: string; name?: string }) =>
        facts.find(
          (f) =>
            f.id.kind === x.kind && (f.id as { name?: string }).name === x.name,
        ),
    }) as unknown as FactView;
  const noinherit = {
    ...roleFact,
    payload: { ...roleFact.payload, inherit: false },
  };
  const create = (payload: Fact["payload"], member: Fact = roleFact) =>
    rules
      .create({ id, payload }, viewOf([member]), undefined, viewOf([member]))
      .map((s) => s.sql);

  test("a create spells only the options a plain grant would not give", () => {
    expect(create({ admin: false })).toEqual([`GRANT "r" TO "somerole"`]);
    expect(create({ admin: true })).toEqual([
      `GRANT "r" TO "somerole" WITH ADMIN OPTION`,
    ]);
    expect(create({ admin: false, inherit: true, set: true })).toEqual([
      `GRANT "r" TO "somerole"`,
    ]);
    expect(create({ admin: true, inherit: true, set: true })).toEqual([
      `GRANT "r" TO "somerole" WITH ADMIN OPTION`,
    ]);
    expect(create({ admin: true, inherit: false, set: false })).toEqual([
      `GRANT "r" TO "somerole" WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`,
    ]);
    expect(
      create({ admin: false, inherit: false, set: true }, noinherit),
    ).toEqual([`GRANT "r" TO "somerole"`]);
    expect(
      create({ admin: false, inherit: true, set: true }, noinherit),
    ).toEqual([`GRANT "r" TO "somerole" WITH INHERIT TRUE`]);
  });

  test("INHERIT and SET changing together give one statement", () => {
    const from: Fact = {
      id,
      payload: { admin: true, inherit: true, set: true },
    };
    const to: Fact = {
      id,
      payload: { admin: true, inherit: false, set: false },
    };
    const src = viewOf([from]);
    const run = (attr: string) => {
      const rule = rules.attributes[attr];
      if (rule === undefined || rule === "replace") throw new Error(attr);
      const out = rule.alter(to, true, false, viewOf([]), src);
      return (Array.isArray(out) ? out : [out]).map((s) => s.sql);
    };
    expect([...run("inherit"), ...run("set")]).toEqual([
      `GRANT "r" TO "somerole" WITH INHERIT FALSE, SET FALSE`,
    ]);
  });
});

describe("role drop", () => {
  test("emits a plain DROP ROLE, never DROP OWNED BY", () => {
    const spec = roleRules.role!.drop!(roleFact);
    const sql = Array.isArray(spec) ? spec.map((s) => s.sql) : spec.sql;
    expect(sql).toBe(`DROP ROLE "somerole"`);
  });
});
