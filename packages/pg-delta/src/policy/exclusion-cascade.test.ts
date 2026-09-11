/**
 * Policy exclusion must close over dependents (CLI-2300 / CLI-2342).
 *
 * Parent-chain cascade already removes children of a hard-pruned root.
 * Dependents that are not children — a user trigger on a hard-pruned
 * user-owned system table, a public view whose `depends` edge pointed at
 * an excluded extension — used to stay managed after that edge was pruned.
 */
import { describe, expect, test } from "bun:test";
import { EXCLUDED_BY_CASCADE } from "../core/diagnostic.ts";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { plan } from "../plan/plan.ts";
import { reconstructManagedView } from "./reconstruct.ts";
import { supabasePolicy } from "./supabase.ts";

const f = (
  id: StableId,
  parent?: StableId,
  payload: Fact["payload"] = {},
): Fact => (parent ? { id, parent, payload } : { id, payload });

const sqlOf = (p: ReturnType<typeof plan>): string[] =>
  p.actions.map((a) => a.sql);

const mentions = (sql: string[], re: RegExp): boolean =>
  sql.some((s) => re.test(s));

describe("CLI-2300 — user trigger on an excluded user-owned system table", () => {
  const postgres: StableId = { kind: "role", name: "postgres" };
  const publicSchema: StableId = { kind: "schema", name: "public" };
  const migSchema: StableId = { kind: "schema", name: "supabase_migrations" };
  const migTable: StableId = {
    kind: "table",
    schema: "supabase_migrations",
    name: "schema_migrations",
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
  const rls: StableId = {
    kind: "policy",
    schema: "supabase_migrations",
    table: "schema_migrations",
    name: "no_anon",
  };

  const triggerDef =
    "CREATE TRIGGER block_writes BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.on_mig()";

  function desired(): ReturnType<typeof buildFactBase> {
    return buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        f(migSchema),
        f(migTable, migSchema, { persistence: "p" }),
        f(fn, publicSchema, {
          def: "CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          kind: "f",
        }),
        f(trigger, migTable, { def: triggerDef, enabled: "O" }),
        f(rls, migTable, {
          cmd: "a",
          permissive: true,
          usingExpr: null,
          checkExpr: "false",
          roles: ["anon"],
        }),
        f({ kind: "role", name: "anon" }),
      ],
      [
        { from: migTable, to: postgres, kind: "owner" },
        { from: trigger, to: fn, kind: "depends" },
      ],
    );
  }

  test("planning against an empty target does not throw; the trigger is skipped", () => {
    const empty = buildFactBase([], []);
    const p = plan(empty, desired(), { policy: supabasePolicy });
    expect(mentions(sqlOf(p), /CREATE TRIGGER/i)).toBe(false);
    expect(mentions(sqlOf(p), /CREATE POLICY/i)).toBe(false);
    expect(mentions(sqlOf(p), /schema_migrations/i)).toBe(false);
    expect(
      p.diagnostics?.some(
        (d) =>
          d.code === EXCLUDED_BY_CASCADE &&
          d.subject !== undefined &&
          encodeId(d.subject) === encodeId(trigger),
      ),
    ).toBe(true);
  });

  test("a user trigger on a platform-owned assumed-schema table still plans", () => {
    const admin: StableId = { kind: "role", name: "supabase_admin" };
    const authSchema: StableId = { kind: "schema", name: "auth" };
    const users: StableId = { kind: "table", schema: "auth", name: "users" };
    const authTrigger: StableId = {
      kind: "trigger",
      schema: "auth",
      table: "users",
      name: "on_auth_user_created",
    };
    const source = buildFactBase(
      [
        f(admin),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
      ],
      [{ from: users, to: admin, kind: "owner" }],
    );
    const desiredAuth = buildFactBase(
      [
        f(admin),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
        f(fn, publicSchema, {
          def: "CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          kind: "f",
        }),
        f(authTrigger, users, {
          def: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.on_mig()",
          enabled: "O",
        }),
      ],
      [
        { from: users, to: admin, kind: "owner" },
        { from: authTrigger, to: fn, kind: "depends" },
      ],
    );
    const p = plan(source, desiredAuth, { policy: supabasePolicy });
    expect(mentions(sqlOf(p), /CREATE TRIGGER/i)).toBe(true);
  });

  test("a shadow-seeded postgres-owned copy of a live platform table still accepts a user trigger", () => {
    const admin: StableId = { kind: "role", name: "supabase_admin" };
    const postgres: StableId = { kind: "role", name: "postgres" };
    const authSchema: StableId = { kind: "schema", name: "auth" };
    const users: StableId = { kind: "table", schema: "auth", name: "users" };
    const authTrigger: StableId = {
      kind: "trigger",
      schema: "auth",
      table: "users",
      name: "on_auth_user_created",
    };
    const live = buildFactBase(
      [
        f(admin),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
      ],
      [{ from: users, to: admin, kind: "owner" }],
    );
    const shadow = buildFactBase(
      [
        f(postgres),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
        f(fn, publicSchema, {
          def: "CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          kind: "f",
        }),
        f(authTrigger, users, {
          def: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.on_mig()",
          enabled: "O",
        }),
      ],
      [
        { from: users, to: postgres, kind: "owner" },
        { from: authTrigger, to: fn, kind: "depends" },
      ],
    );
    const p = plan(live, shadow, { policy: supabasePolicy });
    expect(mentions(sqlOf(p), /CREATE TRIGGER/i)).toBe(true);
  });
});

describe("CLI-2342 — dependents of an excluded platform extension", () => {
  const publicSchema: StableId = { kind: "schema", name: "public" };
  const pgsodium: StableId = { kind: "extension", name: "pgsodium" };
  const table: StableId = { kind: "table", schema: "public", name: "creds" };
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
  const encryptFn: StableId = {
    kind: "function",
    schema: "public",
    name: "creds_encrypt_secret_secret",
    args: [],
  };
  const encryptTrig: StableId = {
    kind: "trigger",
    schema: "public",
    table: "creds",
    name: "creds_encrypt_secret_trigger_secret",
  };

  function tceFacts(withArtefacts: boolean): Fact[] {
    const cols: Fact[] = [
      f(colId, table, { type: "integer", notNull: true }),
      f(colSecret, table, { type: "text", notNull: false }),
      f(colKey, table, { type: "uuid", notNull: false }),
    ];
    if (!withArtefacts) {
      return [
        f(publicSchema),
        f(table, publicSchema, { persistence: "p" }),
        ...cols,
      ];
    }
    return [
      f(publicSchema),
      f(pgsodium, undefined, { version: "3.1.8", _relocatable: false }),
      f(table, publicSchema, { persistence: "p" }),
      ...cols,
      f(defKey, colKey, { expr: "(pgsodium.create_key()).id" }),
      f(view, publicSchema, {
        def: "SELECT pgsodium.crypto_aead_det_decrypt(secret) FROM public.creds",
      }),
      f(seclabel, colSecret, {
        label: "ENCRYPT WITH KEY COLUMN key_id",
      }),
      f(encryptFn, publicSchema, {
        def: "CREATE FUNCTION public.creds_encrypt_secret_secret() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
        kind: "f",
      }),
      f(encryptTrig, table, {
        def: "CREATE TRIGGER creds_encrypt_secret_trigger_secret BEFORE INSERT ON public.creds FOR EACH ROW EXECUTE FUNCTION public.creds_encrypt_secret_secret()",
        enabled: "O",
      }),
    ];
  }

  function tceEdges(): { from: StableId; to: StableId; kind: "depends" }[] {
    return [
      { from: defKey, to: pgsodium, kind: "depends" },
      { from: view, to: pgsodium, kind: "depends" },
      { from: encryptFn, to: pgsodium, kind: "depends" },
      { from: encryptTrig, to: encryptFn, kind: "depends" },
    ];
  }

  test("empty branch: table is planned without pgsodium defaults, views, labels, or CREATE EXTENSION", () => {
    const empty = buildFactBase([f(publicSchema)], []);
    const desired = buildFactBase(tceFacts(true), tceEdges());
    const p = plan(empty, desired, { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(mentions(sql, /CREATE EXTENSION/i)).toBe(false);
    expect(mentions(sql, /pgsodium/i)).toBe(false);
    expect(mentions(sql, /CREATE VIEW/i)).toBe(false);
    expect(mentions(sql, /SECURITY LABEL/i)).toBe(false);
    expect(mentions(sql, /CREATE TRIGGER/i)).toBe(false);
    expect(mentions(sql, /CREATE TABLE/i)).toBe(true);
    expect(
      p.diagnostics?.some(
        (d) =>
          d.code === EXCLUDED_BY_CASCADE &&
          d.subject !== undefined &&
          encodeId(d.subject) === encodeId(view),
      ),
    ).toBe(true);
    // Desired-only cascade victims are not stamped: apply would otherwise
    // strip a later-created same-id object from the source fingerprint.
    expect(p.cascadeAlignedIds ?? []).toEqual([]);
  });

  test("live catalog vs table-only files: TCE artefacts are not dropped", () => {
    const live = buildFactBase(tceFacts(true), tceEdges());
    const files = buildFactBase(tceFacts(false), []);
    const p = plan(live, files, { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(mentions(sql, /DROP VIEW/i)).toBe(false);
    expect(mentions(sql, /DROP TRIGGER/i)).toBe(false);
    expect(mentions(sql, /SECURITY LABEL/i)).toBe(false);
    expect(mentions(sql, /DROP EXTENSION/i)).toBe(false);
  });
});

describe("user extension members in an assumed schema stay reference-only", () => {
  test("a public default over extensions.uuid_generate_v4 is still planned", () => {
    const postgres: StableId = { kind: "role", name: "postgres" };
    const publicSchema: StableId = { kind: "schema", name: "public" };
    const extSchema: StableId = { kind: "schema", name: "extensions" };
    const uuid: StableId = { kind: "extension", name: "uuid-ossp" };
    const gen: StableId = {
      kind: "function",
      schema: "extensions",
      name: "uuid_generate_v4",
      args: [],
    };
    const table: StableId = { kind: "table", schema: "public", name: "items" };
    const col: StableId = {
      kind: "column",
      schema: "public",
      table: "items",
      name: "id",
    };
    const def: StableId = {
      kind: "default",
      schema: "public",
      table: "items",
      name: "id",
    };
    const desired = buildFactBase(
      [
        f(postgres),
        f(publicSchema),
        f(extSchema),
        f(uuid, undefined, {
          version: "1.1",
          schema: "extensions",
          _relocatable: true,
        }),
        f(gen, extSchema, {
          def: "CREATE FUNCTION extensions.uuid_generate_v4() RETURNS uuid LANGUAGE c AS 'uuid-ossp'",
          kind: "f",
        }),
        f(table, publicSchema, { persistence: "p" }),
        f(col, table, { type: "uuid", notNull: true }),
        f(def, col, { expr: "extensions.uuid_generate_v4()" }),
      ],
      [
        { from: gen, to: uuid, kind: "memberOfExtension" },
        { from: gen, to: postgres, kind: "owner" },
        { from: def, to: gen, kind: "depends" },
      ],
    );
    const p = plan(buildFactBase([f(publicSchema)], []), desired, {
      policy: supabasePolicy,
    });
    const sql = sqlOf(p);
    expect(mentions(sql, /CREATE EXTENSION/i)).toBe(true);
    expect(mentions(sql, /uuid_generate_v4/i)).toBe(true);
    expect(mentions(sql, /CREATE FUNCTION/i)).toBe(false);
  });
});

describe("image-provisioned excluded extensions stay reference-only", () => {
  test("a user view over vault.decrypted_secrets is still planned", () => {
    const publicSchema: StableId = { kind: "schema", name: "public" };
    const vaultSchema: StableId = { kind: "schema", name: "vault" };
    const vault: StableId = { kind: "extension", name: "supabase_vault" };
    const secrets: StableId = {
      kind: "view",
      schema: "vault",
      name: "decrypted_secrets",
    };
    const userView: StableId = {
      kind: "view",
      schema: "public",
      name: "secrets_list",
    };
    const platform: Fact[] = [
      f(publicSchema),
      f(vaultSchema),
      f(vault, undefined, { version: "0.3.1", _relocatable: false }),
      f(secrets, vaultSchema, { def: "SELECT 1 AS secret" }),
    ];
    const platformEdges = [
      { from: secrets, to: vault, kind: "memberOfExtension" as const },
    ];
    const source = buildFactBase(platform, platformEdges);
    const desired = buildFactBase(
      [
        ...platform,
        f(userView, publicSchema, {
          def: "SELECT secret FROM vault.decrypted_secrets",
        }),
      ],
      [...platformEdges, { from: userView, to: secrets, kind: "depends" }],
    );
    const p = plan(source, desired, { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(mentions(sql, /CREATE VIEW/i)).toBe(true);
    expect(mentions(sql, /secrets_list/i)).toBe(true);
    expect(mentions(sql, /CREATE EXTENSION/i)).toBe(false);
  });

  test("a user view over a wrappers foreign table still cascades out", () => {
    const publicSchema: StableId = { kind: "schema", name: "public" };
    const wrappers: StableId = { kind: "extension", name: "wrappers" };
    const ft: StableId = {
      kind: "foreignTable",
      schema: "public",
      name: "stripe_customers",
    };
    const userView: StableId = {
      kind: "view",
      schema: "public",
      name: "customers",
    };
    const desired = buildFactBase(
      [
        f(publicSchema),
        f(wrappers, undefined, { version: "0.5.0", _relocatable: true }),
        f(ft, publicSchema),
        f(userView, publicSchema, {
          def: "SELECT 1 FROM public.stripe_customers",
        }),
      ],
      [
        { from: ft, to: wrappers, kind: "memberOfExtension" },
        { from: userView, to: ft, kind: "depends" },
      ],
    );
    const p = plan(buildFactBase([f(publicSchema)], []), desired, {
      policy: supabasePolicy,
    });
    expect(mentions(sqlOf(p), /CREATE VIEW/i)).toBe(false);
    expect(mentions(sqlOf(p), /CREATE EXTENSION/i)).toBe(false);
  });
});

describe("one-sided reverse-depends cascade aligns presence", () => {
  const publicSchema: StableId = { kind: "schema", name: "public" };
  const pgsodium: StableId = { kind: "extension", name: "pgsodium" };
  const v: StableId = { kind: "view", schema: "public", name: "v" };
  const w: StableId = { kind: "view", schema: "public", name: "w" };

  const select1 = () =>
    buildFactBase(
      [f(publicSchema), f(v, publicSchema, { def: "SELECT 1 AS x" })],
      [],
    );
  const selectPgsodium = () =>
    buildFactBase(
      [
        f(publicSchema),
        f(pgsodium, undefined, { version: "3.1.8", _relocatable: false }),
        f(v, publicSchema, { def: "SELECT pgsodium.foo() AS x" }),
      ],
      [{ from: v, to: pgsodium, kind: "depends" }],
    );

  test("changing an existing view to depend on an excluded extension is not DROP VIEW", () => {
    const p = plan(select1(), selectPgsodium(), { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(mentions(sql, /DROP VIEW/i)).toBe(false);
    expect(mentions(sql, /CREATE VIEW/i)).toBe(false);
    expect(mentions(sql, /CREATE EXTENSION/i)).toBe(false);
    expect(
      p.diagnostics?.some(
        (d) =>
          d.code === EXCLUDED_BY_CASCADE &&
          d.subject !== undefined &&
          encodeId(d.subject) === encodeId(v),
      ),
    ).toBe(true);
    expect(p.cascadeAlignedIds).toContain(encodeId(v));
    const unaligned = reconstructManagedView(select1(), {
      policy: supabasePolicy,
    });
    expect(unaligned.rootHash).not.toBe(p.source.fingerprint);
    const aligned = reconstructManagedView(select1(), {
      policy: supabasePolicy,
      alignedIds: new Set(p.cascadeAlignedIds ?? []),
    });
    expect(aligned.rootHash).toBe(p.source.fingerprint);
    expect(aligned.get(v)).toBeUndefined();
  });

  test("a view that exists only on the desired side is skipped, not aligned", () => {
    const p = plan(buildFactBase([f(publicSchema)], []), selectPgsodium(), {
      policy: supabasePolicy,
    });
    expect(mentions(sqlOf(p), /CREATE VIEW/i)).toBe(false);
    expect(p.cascadeAlignedIds ?? []).not.toContain(encodeId(v));
  });

  test("reversing that change is not CREATE VIEW of an object that still exists", () => {
    const p = plan(selectPgsodium(), select1(), { policy: supabasePolicy });
    const sql = sqlOf(p);
    expect(mentions(sql, /CREATE VIEW/i)).toBe(false);
    expect(mentions(sql, /DROP VIEW/i)).toBe(false);
    expect(p.cascadeAlignedIds).toContain(encodeId(v));
  });

  test("aligning a cascaded view does not reverse-cascade a peer that only depends on it", () => {
    const live = buildFactBase(
      [
        f(publicSchema),
        f(v, publicSchema, { def: "SELECT 1 AS x" }),
        f(w, publicSchema, { def: "SELECT 1 AS x" }),
      ],
      [{ from: w, to: v, kind: "depends" }],
    );
    const files = buildFactBase(
      [
        f(publicSchema),
        f(pgsodium, undefined, { version: "3.1.8", _relocatable: false }),
        f(v, publicSchema, { def: "SELECT pgsodium.foo() AS x" }),
        f(w, publicSchema, { def: "SELECT 1 AS x" }),
      ],
      [{ from: v, to: pgsodium, kind: "depends" }],
    );
    const p = plan(live, files, { policy: supabasePolicy });
    expect(mentions(sqlOf(p), /DROP VIEW/i)).toBe(false);
    expect(mentions(sqlOf(p), /CREATE VIEW/i)).toBe(false);
    const aligned = reconstructManagedView(live, {
      policy: supabasePolicy,
      alignedIds: new Set(p.cascadeAlignedIds ?? []),
    });
    expect(aligned.get(v)).toBeUndefined();
    expect(aligned.get(w)).toBeDefined();
  });

  test("changing a view off a managedBy table is not CREATE VIEW of an object that still exists", () => {
    const pgmq: StableId = { kind: "extension", name: "pgmq" };
    const pgmqSchema: StableId = { kind: "schema", name: "pgmq" };
    const queue: StableId = {
      kind: "table",
      schema: "pgmq",
      name: "q_jobs",
    };
    const live = buildFactBase(
      [
        f(publicSchema),
        f(pgmqSchema),
        f(pgmq, undefined, { version: "1.4.4", _relocatable: false }),
        f(queue, pgmqSchema, { persistence: "p" }),
        f(v, publicSchema, { def: "SELECT 1 FROM pgmq.q_jobs" }),
      ],
      [
        { from: queue, to: pgmq, kind: "managedBy" },
        { from: v, to: queue, kind: "depends" },
      ],
    );
    const files = buildFactBase(
      [f(publicSchema), f(v, publicSchema, { def: "SELECT 1 AS x" })],
      [],
    );
    const p = plan(live, files);
    expect(mentions(sqlOf(p), /CREATE VIEW/i)).toBe(false);
    expect(mentions(sqlOf(p), /DROP VIEW/i)).toBe(false);
    expect(p.cascadeAlignedIds).toContain(encodeId(v));
  });

  test("a shadow-seeded desired fingerprint needs the live peer's assumed ids", () => {
    const admin: StableId = { kind: "role", name: "supabase_admin" };
    const postgres: StableId = { kind: "role", name: "postgres" };
    const authSchema: StableId = { kind: "schema", name: "auth" };
    const users: StableId = { kind: "table", schema: "auth", name: "users" };
    const fn: StableId = {
      kind: "function",
      schema: "public",
      name: "on_mig",
      args: [],
    };
    const authTrigger: StableId = {
      kind: "trigger",
      schema: "auth",
      table: "users",
      name: "on_auth_user_created",
    };
    const publicSchema: StableId = { kind: "schema", name: "public" };
    const live = buildFactBase(
      [
        f(admin),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
      ],
      [{ from: users, to: admin, kind: "owner" }],
    );
    const shadow = buildFactBase(
      [
        f(postgres),
        f(authSchema),
        f(users, authSchema, { persistence: "p" }),
        f(publicSchema),
        f(fn, publicSchema, {
          def: "CREATE FUNCTION public.on_mig() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
          kind: "f",
        }),
        f(authTrigger, users, {
          def: "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.on_mig()",
          enabled: "O",
        }),
      ],
      [
        { from: users, to: postgres, kind: "owner" },
        { from: authTrigger, to: fn, kind: "depends" },
      ],
    );
    const p = plan(live, shadow, { policy: supabasePolicy });
    expect(
      reconstructManagedView(shadow, { policy: supabasePolicy }).rootHash,
    ).not.toBe(p.target.fingerprint);
    const sourceUnaligned = reconstructManagedView(live, {
      policy: supabasePolicy,
    });
    const desired = reconstructManagedView(shadow, {
      policy: supabasePolicy,
      keepAssumedIds: sourceUnaligned.referenceOnly,
      alignedIds: new Set(p.cascadeAlignedIds ?? []),
    });
    expect(desired.rootHash).toBe(p.target.fingerprint);
  });
});
