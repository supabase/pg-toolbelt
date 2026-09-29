/**
 * Withheld-requirement cascade (CLI-2300 / CLI-2342 / CLI-2178).
 *
 * A kept CREATE whose prerequisite the policy withholds, on a target that
 * lacks that prerequisite, is reverted at plan time (moved to `filteredDeltas`)
 * with an `excluded-by-cascade` warning instead of throwing or emitting DDL
 * that fails at apply. A stranded change to an existing object, or a stranded
 * constraint or restrictive RLS policy, is refused instead: skipping it would
 * leave looser state live. Prerequisites present on the target, produced by the plan, or
 * ambient keep planning exactly as before. No DB.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../core/diagnostic.ts";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
} from "../../core/fact.ts";
import { encodeId, type StableId } from "../../core/stable-id.ts";
import type { Policy } from "../../policy/policy.ts";
import { supabasePolicy } from "../../policy/supabase.ts";
import { plan } from "../plan.ts";

const CASCADE = "excluded-by-cascade";

const f = (
  id: StableId,
  parent?: StableId,
  payload: Fact["payload"] = {},
): Fact => (parent ? { id, parent, payload } : { id, payload });

const tablePayload = (): Fact["payload"] => ({
  persistence: "p",
  rowSecurity: false,
  forceRowSecurity: false,
  replicaIdentity: "d",
  replicaIdentityIndex: null,
  partitionKey: null,
  partitionBound: null,
  parentTable: null,
  reloptions: null,
});

const colPayload = (type: string, position: number): Fact["payload"] => ({
  _position: position,
  type,
  notNull: false,
  identity: null,
  collation: null,
  generatedExpr: null,
});

const sqlOf = (p: ReturnType<typeof plan>): string[] =>
  p.actions.map((a) => a.sql);

const cascades = (p: ReturnType<typeof plan>): Diagnostic[] =>
  (p.diagnostics ?? []).filter((d) => d.code === CASCADE);

const cascadeSubjects = (p: ReturnType<typeof plan>): string[] =>
  cascades(p)
    .map((d) => (d.subject === undefined ? "" : encodeId(d.subject)))
    .sort();

const publicSchema: StableId = { kind: "schema", name: "public" };
const postgres: StableId = { kind: "role", name: "postgres" };
const pgsodium: StableId = { kind: "extension", name: "pgsodium" };
const pgsodiumFact = (): Fact =>
  f(pgsodium, undefined, { version: "3.1.8", _relocatable: false });

describe("CLI-2300 — user trigger on a reference-only table the target lacks", () => {
  const migSchema: StableId = { kind: "schema", name: "supabase_migrations" };
  const migTable: StableId = {
    kind: "table",
    schema: "supabase_migrations",
    name: "schema_migrations",
  };
  const migCol: StableId = {
    kind: "column",
    schema: "supabase_migrations",
    table: "schema_migrations",
    name: "version",
  };
  const fn: StableId = {
    kind: "function",
    schema: "public",
    name: "on_mig",
    args: [],
  };
  const trigger: StableId = {
    kind: "trigger",
    schema: "supabase_migrations",
    table: "schema_migrations",
    name: "block_writes",
  };

  const desired = () =>
    buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        f(migSchema),
        f(migTable, migSchema, tablePayload()),
        f(migCol, migTable, colPayload("text", 1)),
        f(fn, publicSchema, {
          def: "CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          kind: "f",
        }),
        f(trigger, migTable, {
          def: "CREATE TRIGGER block_writes BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.on_mig()",
          enabled: "O",
        }),
      ],
      [
        { from: migTable, to: postgres, kind: "owner" },
        { from: trigger, to: fn, kind: "depends" },
      ],
    );

  test("empty branch: the trigger is skipped with a warning, the function is still created", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const p = plan(source, desired(), { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(sql.some((s) => /CREATE TRIGGER/i.test(s))).toBe(false);
    expect(sql.some((s) => /schema_migrations/i.test(s))).toBe(false);
    expect(
      sql.some((s) => /CREATE (OR REPLACE )?FUNCTION.*on_mig/is.test(s)),
    ).toBe(true);
    const [warning, ...rest] = cascades(p);
    expect(rest).toEqual([]);
    expect(warning?.severity).toBe("warning");
    expect(warning?.subject).toEqual(trigger);
    expect(warning?.context?.["requirement"]).toBe(encodeId(migTable));
    expect(warning?.context?.["stage"]).toBe("referenceOnly");
    expect(String(warning?.context?.["reasonCode"])).toStartWith(
      "reference-only.assumed-schema",
    );
    expect(
      p.filteredDeltas.some(
        (d) => d.verb === "add" && encodeId(d.fact.id) === encodeId(trigger),
      ),
    ).toBe(true);
  });

  test("the plan target fingerprint matches the state the plan produces", () => {
    // The branch has the schema but not the table. After apply it holds the
    // desired catalog minus the skipped trigger and the absent table.
    const source = buildFactBase(
      [f(postgres), f(publicSchema), f(migSchema)],
      [],
    );
    const p = plan(source, desired(), { policy: supabasePolicy });
    const applied = buildFactBase(
      desired()
        .facts()
        .filter(
          (fact) =>
            ![trigger, migTable, migCol].some(
              (id) => encodeId(id) === encodeId(fact.id),
            ),
        ),
      [],
    );
    const replan = plan(applied, desired(), { policy: supabasePolicy });
    expect(replan.source.fingerprint).toBe(p.target.fingerprint);
  });

  test("empty branch without the schema: the plan target fingerprint matches the applied state", () => {
    const source = buildFactBase([f(postgres), f(publicSchema)], []);
    const p = plan(source, desired(), { policy: supabasePolicy });
    expect(cascadeSubjects(p)).toEqual([encodeId(trigger)]);
    const applied = buildFactBase(
      desired()
        .facts()
        .filter(
          (fact) =>
            ![trigger, migTable, migCol, migSchema].some(
              (id) => encodeId(id) === encodeId(fact.id),
            ),
        ),
      [],
    );
    const replan = plan(applied, desired(), { policy: supabasePolicy });
    expect(replan.source.fingerprint).toBe(p.target.fingerprint);
  });

  test("re-planning against the applied empty branch is stable", () => {
    const source = buildFactBase([f(postgres), f(publicSchema)], []);
    const first = plan(source, desired(), { policy: supabasePolicy });
    const applied = buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        ...desired()
          .facts()
          .filter((fact) => encodeId(fact.id) === encodeId(fn)),
      ],
      [],
    );
    const again = plan(applied, desired(), { policy: supabasePolicy });
    expect(sqlOf(again)).toEqual([]);
    expect(cascadeSubjects(again)).toEqual(cascadeSubjects(first));
  });

  test("a view over an absent reference-only column: the plan target fingerprint matches the applied state", () => {
    const view: StableId = { kind: "view", schema: "public", name: "mig_v" };
    const desiredWithView = buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        f(migSchema),
        f(migTable, migSchema, tablePayload()),
        f(migCol, migTable, colPayload("text", 1)),
        f(view, publicSchema, {
          def: "SELECT version FROM supabase_migrations.schema_migrations",
          reloptions: null,
        }),
      ],
      [
        { from: migTable, to: postgres, kind: "owner" },
        { from: view, to: migCol, kind: "depends" },
      ],
    );
    const source = buildFactBase(
      [f(postgres), f(publicSchema), f(migSchema)],
      [],
    );
    const p = plan(source, desiredWithView, { policy: supabasePolicy });
    expect(cascadeSubjects(p)).toEqual([encodeId(view)]);
    const applied = buildFactBase(
      [f(postgres), f(publicSchema), f(migSchema)],
      [],
    );
    const replan = plan(applied, desiredWithView, { policy: supabasePolicy });
    expect(replan.source.fingerprint).toBe(p.target.fingerprint);
  });

  test("the table present on the target: the trigger still plans", () => {
    const source = buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        f(migSchema),
        f(migTable, migSchema, tablePayload()),
        f(migCol, migTable, colPayload("text", 1)),
      ],
      [{ from: migTable, to: postgres, kind: "owner" }],
    );
    const p = plan(source, desired(), { policy: supabasePolicy });
    expect(sqlOf(p).some((s) => /CREATE TRIGGER/i.test(s))).toBe(true);
    expect(cascades(p)).toEqual([]);
  });
});

describe("CLI-2342 — pgsodium TCE artefacts on a branch without pgsodium", () => {
  const creds: StableId = { kind: "table", schema: "public", name: "creds" };
  const colId: StableId = {
    kind: "column",
    schema: "public",
    table: "creds",
    name: "id",
  };
  const colSecret: StableId = {
    kind: "column",
    schema: "public",
    table: "creds",
    name: "secret",
  };
  const colKey: StableId = {
    kind: "column",
    schema: "public",
    table: "creds",
    name: "key_id",
  };
  const defKey: StableId = {
    kind: "default",
    schema: "public",
    table: "creds",
    name: "key_id",
  };
  const view: StableId = {
    kind: "view",
    schema: "public",
    name: "decrypted_creds",
  };
  const seclabel: StableId = {
    kind: "securityLabel",
    target: colSecret,
    provider: "pgsodium",
  };

  const tceDesired = () =>
    buildFactBase(
      [
        f(publicSchema),
        pgsodiumFact(),
        f(creds, publicSchema, tablePayload()),
        f(colId, creds, colPayload("integer", 1)),
        f(colSecret, creds, colPayload("text", 2)),
        f(colKey, creds, colPayload("uuid", 3)),
        f(defKey, colKey, { expr: "(pgsodium.create_key()).id" }),
        f(view, publicSchema, {
          def: "SELECT pgsodium.crypto_aead_det_decrypt(secret) AS secret FROM public.creds",
          reloptions: null,
        }),
        f(seclabel, colSecret, { label: "ENCRYPT WITH KEY COLUMN key_id" }),
      ],
      [
        { from: defKey, to: pgsodium, kind: "depends" },
        { from: view, to: pgsodium, kind: "depends" },
        { from: view, to: colSecret, kind: "depends" },
      ],
    );

  test("empty branch: CREATE TABLE without pgsodium defaults; no view, label, or extension", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = tceDesired();
    const p = plan(source, desired, { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(sql.some((s) => s.startsWith(`CREATE TABLE "public"."creds"`))).toBe(
      true,
    );
    expect(sql.some((s) => /pgsodium/i.test(s))).toBe(false);
    expect(sql.some((s) => /CREATE EXTENSION/i.test(s))).toBe(false);
    expect(sql.some((s) => /CREATE VIEW/i.test(s))).toBe(false);
    expect(sql.some((s) => /SECURITY LABEL/i.test(s))).toBe(false);
    expect(cascadeSubjects(p)).toEqual(
      [defKey, view, seclabel].map(encodeId).sort(),
    );
    for (const d of cascades(p)) {
      expect(d.context?.["requirement"]).toBe(encodeId(pgsodium));
      expect(d.context?.["stage"]).toBe("policyScopeRule");
    }
  });

  test("re-planning against the applied branch is stable: no throw, no actions, same warnings", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const first = plan(source, tceDesired(), { policy: supabasePolicy });
    const skipped = new Set([defKey, view, seclabel, pgsodium].map(encodeId));
    const applied = buildFactBase(
      tceDesired()
        .facts()
        .filter((fact) => !skipped.has(encodeId(fact.id))),
      [],
    );
    const again = plan(applied, tceDesired(), { policy: supabasePolicy });
    expect(sqlOf(again)).toEqual([]);
    expect(cascadeSubjects(again)).toEqual(cascadeSubjects(first));
  });

  const check: StableId = {
    kind: "constraint",
    schema: "public",
    table: "creds",
    name: "creds_secret_check",
  };
  const checkFact = (): Fact =>
    f(check, creds, {
      def: "CHECK ((pgsodium.crypto_aead_det_decrypt(secret::bytea) IS NOT NULL))",
      type: "c",
      validated: true,
    });
  const tableFacts = (): Fact[] => [
    f(publicSchema),
    f(creds, publicSchema, tablePayload()),
    f(colId, creds, colPayload("integer", 1)),
    f(colSecret, creds, colPayload("text", 2)),
  ];

  test("a new CHECK calling pgsodium on a new table throws", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [...tableFacts(), pgsodiumFact(), checkFact()],
      [{ from: check, to: pgsodium, kind: "depends" }],
    );
    expect(() => plan(source, desired, { policy: supabasePolicy })).toThrow(
      /constraint:public\.creds\.creds_secret_check requires extension:pgsodium/,
    );
  });

  test("a CHECK on a table that is itself skipped cascades with it", () => {
    const keyType: StableId = {
      kind: "type",
      schema: "pgsodium",
      name: "key_type",
    };
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [
        ...tableFacts(),
        pgsodiumFact(),
        f({ kind: "schema", name: "pgsodium" }),
        f(keyType, { kind: "schema", name: "pgsodium" }, {}),
        checkFact(),
      ],
      [
        { from: keyType, to: pgsodium, kind: "memberOfExtension" },
        { from: creds, to: keyType, kind: "depends" },
        { from: check, to: pgsodium, kind: "depends" },
      ],
    );
    const p = plan(source, desired, { policy: supabasePolicy });
    expect(sqlOf(p)).toEqual([]);
    expect(cascadeSubjects(p)).toEqual([encodeId(creds)]);
  });
});

describe("a member of a withheld extension", () => {
  test("a view over a pgsodium member function is skipped on a branch without pgsodium", () => {
    const pgsodiumSchema: StableId = { kind: "schema", name: "pgsodium" };
    const decrypt: StableId = {
      kind: "function",
      schema: "pgsodium",
      name: "crypto_aead_det_decrypt",
      args: [],
    };
    const view: StableId = { kind: "view", schema: "public", name: "dec" };
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [
        f(publicSchema),
        pgsodiumFact(),
        f(pgsodiumSchema),
        f(decrypt, pgsodiumSchema, { kind: "f" }),
        f(view, publicSchema, {
          def: "SELECT pgsodium.crypto_aead_det_decrypt()",
          reloptions: null,
        }),
      ],
      [
        { from: decrypt, to: pgsodium, kind: "memberOfExtension" },
        { from: view, to: decrypt, kind: "depends" },
      ],
    );
    const p = plan(source, desired, { policy: supabasePolicy });
    expect(sqlOf(p).some((s) => /CREATE VIEW/i.test(s))).toBe(false);
    expect(cascadeSubjects(p)).toEqual([encodeId(view)]);
    const [warning] = cascades(p);
    expect(warning?.context?.["requirement"]).toBe(encodeId(decrypt));
    expect(warning?.context?.["stage"]).toBe("policyScopeRule");
  });
});

describe("CLI-2178 — view over a policy-suppressed foreign table", () => {
  const wrappers: StableId = { kind: "extension", name: "wrappers" };
  const fdw: StableId = { kind: "fdw", name: "clerk_oauth" };
  const server: StableId = { kind: "server", name: "clerk_server" };
  const ft: StableId = {
    kind: "foreignTable",
    schema: "public",
    name: "clerk_users",
  };
  const view: StableId = { kind: "view", schema: "public", name: "users_v" };

  const wrapperFacts = (): Fact[] => [
    f(postgres),
    f(publicSchema),
    f(wrappers, undefined, { schema: "extensions", _relocatable: true }),
    f(fdw, undefined, {
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
      options: [],
    }),
    f(server, fdw, {
      fdw: "clerk_oauth",
      type: null,
      version: null,
      options: [],
    }),
    f(ft, server, { server: "clerk_server", options: [] }),
  ];
  const wrapperEdges = (): DependencyEdge[] => [
    { from: fdw, to: wrappers, kind: "depends" },
    { from: fdw, to: postgres, kind: "owner" },
    { from: server, to: postgres, kind: "owner" },
    { from: ft, to: postgres, kind: "owner" },
  ];
  const desired = () =>
    buildFactBase(
      [
        ...wrapperFacts(),
        f(view, publicSchema, {
          def: "SELECT * FROM public.clerk_users",
          reloptions: null,
        }),
      ],
      [...wrapperEdges(), { from: view, to: ft, kind: "depends" }],
    );

  test("branch lacks the wrapper: the view is skipped with a warning", () => {
    const source = buildFactBase([f(publicSchema)], []);
    const p = plan(source, desired(), { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(sql.some((s) => /CREATE VIEW/i.test(s))).toBe(false);
    expect(sql.some((s) => /clerk/i.test(s))).toBe(false);
    expect(cascadeSubjects(p)).toEqual([encodeId(view)]);
    const [warning] = cascades(p);
    expect(warning?.context?.["requirement"]).toBe(encodeId(ft));
    expect(warning?.context?.["stage"]).toBe("policyScopeRule");
    expect(warning?.context?.["reasonCode"]).toBe("supabase.wrappers-fdw");
  });

  test("branch has the wrapper: the view still plans", () => {
    const source = buildFactBase(wrapperFacts(), wrapperEdges());
    const p = plan(source, desired(), { policy: supabasePolicy });
    expect(
      sqlOf(p).some((s) => s.startsWith(`CREATE VIEW "public"."users_v"`)),
    ).toBe(true);
    expect(cascades(p)).toEqual([]);
  });
});

describe("stranded changes to existing objects are refused, not reverted", () => {
  const t: StableId = { kind: "table", schema: "public", name: "t" };
  const colA: StableId = {
    kind: "column",
    schema: "public",
    table: "t",
    name: "a",
  };
  const shared = (): Fact[] => [
    f(publicSchema),
    f(t, publicSchema, tablePayload()),
    f(colA, t, colPayload("text", 1)),
  ];

  test("a view redefinition that newly requires pgsodium throws", () => {
    const v: StableId = { kind: "view", schema: "public", name: "v" };
    const w: StableId = { kind: "view", schema: "public", name: "w" };
    const source = buildFactBase(
      [
        ...shared(),
        f(v, publicSchema, { def: "SELECT a FROM public.t", reloptions: null }),
      ],
      [{ from: v, to: colA, kind: "depends" }],
    );
    const desired = buildFactBase(
      [
        ...shared(),
        pgsodiumFact(),
        f(v, publicSchema, {
          def: "SELECT pgsodium.crypto_aead_det_decrypt(a) AS b FROM public.t",
          reloptions: null,
        }),
        f(w, publicSchema, { def: "SELECT b FROM public.v", reloptions: null }),
      ],
      [
        { from: v, to: colA, kind: "depends" },
        { from: v, to: pgsodium, kind: "depends" },
        { from: w, to: v, kind: "depends" },
      ],
    );
    expect(() => plan(source, desired, { policy: supabasePolicy })).toThrow(
      /view:public\.v[\s\S]*extension:pgsodium[\s\S]*supabase\.system-extension/,
    );
  });

  test("an RLS policy tightened onto a pgsodium function throws instead of keeping the looser policy", () => {
    const pol: StableId = {
      kind: "policy",
      schema: "public",
      table: "t",
      name: "read",
    };
    const policyFact = (usingExpr: string): Fact =>
      f(pol, t, {
        cmd: "r",
        permissive: true,
        roles: ["authenticated"],
        usingExpr,
        checkExpr: null,
      });
    const source = buildFactBase([...shared(), policyFact("true")], []);
    const desired = buildFactBase(
      [
        ...shared(),
        pgsodiumFact(),
        policyFact("(pgsodium.crypto_aead_det_decrypt(a) IS NOT NULL)"),
      ],
      [{ from: pol, to: pgsodium, kind: "depends" }],
    );
    expect(() => plan(source, desired, { policy: supabasePolicy })).toThrow(
      /policy:public\.t\.read[\s\S]*extension:pgsodium/,
    );
  });
});

describe("a stranded constraint on an existing table is refused", () => {
  test("a new CHECK constraint on an existing table that calls pgsodium throws", () => {
    const t: StableId = { kind: "table", schema: "public", name: "t" };
    const colA: StableId = {
      kind: "column",
      schema: "public",
      table: "t",
      name: "a",
    };
    const check: StableId = {
      kind: "constraint",
      schema: "public",
      table: "t",
      name: "t_a_check",
    };
    const shared = (): Fact[] => [
      f(publicSchema),
      f(t, publicSchema, tablePayload()),
      f(colA, t, colPayload("bytea", 1)),
    ];
    const source = buildFactBase(shared(), []);
    const desired = buildFactBase(
      [
        ...shared(),
        pgsodiumFact(),
        f(check, t, {
          def: "CHECK ((pgsodium.crypto_aead_det_decrypt(a) IS NOT NULL))",
          type: "c",
          validated: true,
        }),
      ],
      [{ from: check, to: pgsodium, kind: "depends" }],
    );
    expect(() => plan(source, desired, { policy: supabasePolicy })).toThrow(
      /constraint:public\.t\.t_a_check[\s\S]*extension:pgsodium[\s\S]*policyScopeRule/,
    );
  });
});

describe("new RLS policies whose prerequisite is withheld", () => {
  const t: StableId = { kind: "table", schema: "public", name: "t" };
  const pol: StableId = {
    kind: "policy",
    schema: "public",
    table: "t",
    name: "gate",
  };
  const run = (permissive: boolean) => {
    const source = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(t, publicSchema, tablePayload()),
        pgsodiumFact(),
        f(pol, t, {
          cmd: "r",
          permissive,
          roles: ["authenticated"],
          usingExpr: "(pgsodium.crypto_aead_det_noncegen() IS NOT NULL)",
          checkExpr: null,
        }),
      ],
      [{ from: pol, to: pgsodium, kind: "depends" }],
    );
    return () => plan(source, desired, { policy: supabasePolicy });
  };

  test("a restrictive policy throws: skipping it would widen access", () => {
    expect(run(false)).toThrow(
      /policy:public\.t\.gate[\s\S]*extension:pgsodium/,
    );
  });

  test("a permissive policy is skipped with a warning", () => {
    const p = run(true)();
    expect(sqlOf(p).some((s) => /CREATE TABLE "public"\."t"/.test(s))).toBe(
      true,
    );
    expect(sqlOf(p).some((s) => /CREATE POLICY/i.test(s))).toBe(false);
    expect(cascadeSubjects(p)).toEqual([encodeId(pol)]);
  });
});

describe("regression pins — requirements present, produced, or ambient", () => {
  test("user view over vault.decrypted_secrets plans when supabase_vault is on the target (vault 0.2.8 → pgsodium)", () => {
    const vaultSchema: StableId = { kind: "schema", name: "vault" };
    const vaultExt: StableId = { kind: "extension", name: "supabase_vault" };
    const admin: StableId = { kind: "role", name: "supabase_admin" };
    const decrypted: StableId = {
      kind: "view",
      schema: "vault",
      name: "decrypted_secrets",
    };
    const userView: StableId = {
      kind: "view",
      schema: "public",
      name: "secrets_view",
    };
    const platform = (): Fact[] => [
      f(admin),
      f(publicSchema),
      f(vaultSchema),
      f(vaultExt, undefined, { version: "0.3.1", _relocatable: false }),
      f(decrypted, vaultSchema, {
        def: "SELECT id FROM vault.secrets",
        reloptions: null,
      }),
    ];
    const source = buildFactBase(platform(), [
      { from: decrypted, to: admin, kind: "owner" },
    ]);
    const desired = buildFactBase(
      [
        ...platform(),
        pgsodiumFact(),
        f(userView, publicSchema, {
          def: "SELECT id FROM vault.decrypted_secrets",
          reloptions: null,
        }),
      ],
      [
        { from: decrypted, to: admin, kind: "owner" },
        { from: decrypted, to: pgsodium, kind: "depends" },
        { from: userView, to: decrypted, kind: "depends" },
        { from: userView, to: vaultExt, kind: "depends" },
      ],
    );
    const p = plan(source, desired, { policy: supabasePolicy });
    expect(
      sqlOf(p).some((s) => s.startsWith(`CREATE VIEW "public"."secrets_view"`)),
    ).toBe(true);
    expect(cascades(p)).toEqual([]);
  });

  test("a type change under a view that also reads an excluded-schema table still rebuilds the view", () => {
    const ops: StableId = { kind: "schema", name: "ops" };
    const items: StableId = { kind: "table", schema: "public", name: "items" };
    const itemsId: StableId = {
      kind: "column",
      schema: "public",
      table: "items",
      name: "id",
    };
    const hidden: StableId = { kind: "table", schema: "ops", name: "hidden" };
    const hiddenX: StableId = {
      kind: "column",
      schema: "ops",
      table: "hidden",
      name: "x",
    };
    const v: StableId = { kind: "view", schema: "public", name: "v" };
    const policy: Policy = {
      id: "ops-excluded",
      filter: [
        { match: { schema: "ops" }, action: "exclude" },
        {
          match: { all: [{ kind: "schema" }, { name: "ops" }] },
          action: "exclude",
        },
      ],
    };
    const state = (idType: string) =>
      buildFactBase(
        [
          f(publicSchema),
          f(ops),
          f(items, publicSchema, tablePayload()),
          f(itemsId, items, colPayload(idType, 1)),
          f(hidden, ops, tablePayload()),
          f(hiddenX, hidden, colPayload("integer", 1)),
          f(v, publicSchema, {
            def: "SELECT i.id, h.x FROM public.items i, ops.hidden h",
            reloptions: null,
          }),
        ],
        [
          { from: v, to: itemsId, kind: "depends" },
          { from: v, to: hiddenX, kind: "depends" },
        ],
      );
    const p = plan(state("integer"), state("bigint"), { policy });
    const sql = sqlOf(p);
    const dropView = sql.findIndex((s) =>
      s.startsWith(`DROP VIEW "public"."v"`),
    );
    const alterType = sql.findIndex((s) => /TYPE bigint/.test(s));
    const createView = sql.findIndex((s) =>
      s.startsWith(`CREATE VIEW "public"."v"`),
    );
    expect(dropView).toBeGreaterThanOrEqual(0);
    expect(alterType).toBeGreaterThan(dropView);
    expect(createView).toBeGreaterThan(alterType);
    expect(cascades(p)).toEqual([]);
  });

  test("a webhook trigger on a system-role-owned supabase_functions.http_request still plans", () => {
    const table: StableId = { kind: "table", schema: "public", name: "d" };
    const trigger: StableId = {
      kind: "trigger",
      schema: "public",
      table: "d",
      name: "crud_sync",
    };
    const functionsSchema: StableId = {
      kind: "schema",
      name: "supabase_functions",
    };
    const httpRequest: StableId = {
      kind: "function",
      schema: "supabase_functions",
      name: "http_request",
      args: [],
    };
    const owner: StableId = { kind: "role", name: "supabase_functions_admin" };
    const source = buildFactBase(
      [f(publicSchema), f(table, publicSchema, tablePayload())],
      [],
    );
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(table, publicSchema, tablePayload()),
        f(trigger, table, {
          def: "CREATE TRIGGER crud_sync AFTER INSERT ON public.d FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://example.com', 'POST')",
          enabled: "O",
        }),
        f(owner),
        f(functionsSchema),
        f(httpRequest, functionsSchema, { kind: "f" }),
      ],
      [
        { from: trigger, to: httpRequest, kind: "depends" },
        { from: httpRequest, to: owner, kind: "owner" },
      ],
    );
    const p = plan(source, desired, { policy: supabasePolicy });
    expect(sqlOf(p).some((s) => /CREATE TRIGGER/i.test(s))).toBe(true);
    expect(cascades(p)).toEqual([]);
  });

  test("a requirement hidden by a verb rule (not withheld by projection) still throws", () => {
    const app: StableId = { kind: "schema", name: "app" };
    const t: StableId = { kind: "table", schema: "app", name: "t" };
    const v: StableId = { kind: "view", schema: "app", name: "v" };
    const policy: Policy = {
      id: "no-table-adds",
      filter: [
        {
          match: { all: [{ kind: "table" }, { verb: "add" }] },
          action: "exclude",
        },
      ],
    };
    const source = buildFactBase([f(app)], []);
    const desired = buildFactBase(
      [
        f(app),
        f(t, app, tablePayload()),
        f(v, app, { def: "SELECT 1 FROM app.t", reloptions: null }),
      ],
      [{ from: v, to: t, kind: "depends" }],
    );
    expect(() => plan(source, desired, { policy })).toThrow(
      /missing requirement/,
    );
  });

  test("an accepted role rename plans alongside a cascade of a view granted to the renamed role", () => {
    const rolePayload = (): Fact["payload"] => ({
      superuser: false,
      inherit: true,
      createRole: false,
      createDb: false,
      login: false,
      replication: false,
      bypassRls: false,
      config: [],
    });
    const roleA: StableId = { kind: "role", name: "role_a" };
    const roleB: StableId = { kind: "role", name: "role_b" };
    const t: StableId = { kind: "table", schema: "public", name: "t" };
    const v: StableId = { kind: "view", schema: "public", name: "v" };
    const tAcl = (grantee: string): Fact =>
      f({ kind: "acl", target: t, grantee }, t, {
        privileges: ["SELECT"],
        grantable: [],
      });
    const vAcl: StableId = { kind: "acl", target: v, grantee: "role_b" };
    const source = buildFactBase(
      [
        f(roleA, undefined, rolePayload()),
        f(publicSchema),
        f(t, publicSchema, tablePayload()),
        tAcl("role_a"),
      ],
      [],
    );
    const desired = buildFactBase(
      [
        f(roleB, undefined, rolePayload()),
        f(publicSchema),
        f(t, publicSchema, tablePayload()),
        tAcl("role_b"),
        pgsodiumFact(),
        f(v, publicSchema, {
          def: "SELECT pgsodium.crypto_aead_det_decrypt('x'::bytea)",
          reloptions: null,
        }),
        f(vAcl, v, { privileges: ["SELECT"], grantable: [] }),
      ],
      [{ from: v, to: pgsodium, kind: "depends" }],
    );
    const p = plan(source, desired, {
      policy: supabasePolicy,
      renames: "auto",
    });
    const sql = sqlOf(p);
    expect(sql).toContain(`ALTER ROLE "role_a" RENAME TO "role_b"`);
    expect(sql.some((s) => /"public"\."v"/.test(s))).toBe(false);
    expect(cascadeSubjects(p)).toEqual([encodeId(v)]);
    // the grant on the cascaded view is reverted with it, without its own warning
    expect(
      p.filteredDeltas.some(
        (d) => d.verb === "add" && encodeId(d.fact.id) === encodeId(vAcl),
      ),
    ).toBe(true);
  });
});
