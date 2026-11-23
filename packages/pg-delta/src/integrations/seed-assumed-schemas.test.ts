/**
 * deriveAssumedSchemaSeed unit pins (no Docker). Guards the Phase 2b seed
 * derivation and the two silent-failure modes the design review (Fable) flagged:
 *   - the seed plan must NOT re-project (no policy / no referenceOnly), or the
 *     diff would skip every seed fact → a silently EMPTY seed;
 *   - extension members must be excluded (they can't be CREATEd standalone).
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { extensionPayload } from "../extract/schemas.ts";
import { flattenPolicy, type Policy } from "../policy/policy.ts";
import { supabasePolicy } from "../policy/supabase.ts";
import { deriveAssumedSchemaSeed } from "./seed-assumed-schemas.ts";

const f = (id: StableId, payload: Fact["payload"] = {}): Fact => ({
  id,
  payload,
});

const supabaseAssumedSchemas =
  flattenPolicy(supabasePolicy).assumedSchemas ?? [];

const schemaAuth: StableId = { kind: "schema", name: "auth" };
const schemaPublic: StableId = { kind: "schema", name: "public" };
const schemaApp: StableId = { kind: "schema", name: "app" };

describe("deriveAssumedSchemaSeed", () => {
  test("seeds an assumed schema and NOT a user schema (non-empty; Q6b/Q6f pin)", () => {
    // auth is an assumed (system) schema → reference-only → seeded.
    // app / public are user-managed → NOT seeded. If a regression forwarded the
    // policy (or referenceOnly) INTO the seed plan, resolveView would re-mark
    // `auth` reference-only, the diff would skip it, and this would go EMPTY —
    // which is exactly the silent failure this assertion catches. It ALSO fails
    // if a future committed supabase baseline subtracts `auth`, forcing whoever
    // lands it to revisit Phase 2b (see supabase.ts baseline TODO).
    const target = buildFactBase(
      [f(schemaPublic), f(schemaApp), f(schemaAuth)],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
    });
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.sql).not.toContain('"app"');
    expect(seed.schemas).toEqual(["auth"]);
    expect(seed.facts).toBe(1);
  });

  test("excludes extension members (can't be CREATEd standalone)", () => {
    const ext: StableId = { kind: "extension", name: "someext" };
    const memberFn: StableId = {
      kind: "function",
      schema: "auth",
      name: "member_fn",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaAuth),
        f(ext),
        f(memberFn, {
          def: `CREATE FUNCTION "auth"."member_fn"() RETURNS void LANGUAGE sql AS $$ $$`,
        }),
      ],
      [{ from: memberFn, to: ext, kind: "memberOfExtension" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
    });
    // the assumed schema is seeded; the extension member is not.
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.sql).not.toContain("member_fn");
    expect(seed.facts).toBe(1);
  });

  test("a diff-time baseline containing the assumed schema does NOT empty the seed", () => {
    // The seed answers the SUPERSET question — "what platform objects must
    // exist for user SQL to elaborate in the shadow" — so it must derive from
    // the RAW target, BEFORE the diff-time baseline subtraction. A baseline that
    // contains `auth` (as a real platform baseline would) must NOT remove auth
    // from the seed, or a co-located apply of a user dir referencing auth.users
    // could not load. (Codex #323 finding 3: the seed used to forward the
    // baseline into resolveView, silently emptying the seed.)
    const target = buildFactBase([f(schemaPublic), f(schemaAuth)], []);
    const baseline = buildFactBase([f(schemaAuth)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
      baseline,
    });
    expect(seed.sql).toContain('CREATE SCHEMA "auth"');
    expect(seed.facts).toBe(1);
  });

  test("raw profile (no assumed schemas) seeds nothing", () => {
    const target = buildFactBase([f(schemaPublic), f(schemaApp)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      assumedSchemas: [],
      assumedRoles: [],
    });
    expect(seed).toEqual({
      sql: "",
      facts: 0,
      schemas: [],
      seededRoutines: new Map(),
    });
  });

  test("empty results are not shared between calls", () => {
    const target = buildFactBase([f(schemaPublic), f(schemaApp)], []);
    const opts = { assumedSchemas: [], assumedRoles: [] };
    const first = deriveAssumedSchemaSeed(target, opts);
    first.schemas.push("leaked");
    first.seededRoutines.set("function:leaked()", "def");
    const second = deriveAssumedSchemaSeed(target, opts);
    expect(second.schemas).toEqual([]);
    expect(second.seededRoutines.size).toBe(0);
  });

  // Unit C: a seeded routine carrying a superuser-only `SET` clause cannot be
  // CREATEd by a non-superuser applier at all (SQLSTATE 42501 at CREATE time),
  // and platform ADP entries fail the same way. The routine's `SET` clause lives
  // inside its semantic `def` payload; the parallel `_configGucs` key is a
  // NON-semantic structured duplicate of the SET GUC NAMES (populated from
  // `pg_proc.proconfig` at extract time, `_`-prefixed ⇒ dropped from hash + diff)
  // that lets the seed DECIDE which routines to skip WITHOUT reading SQL text. A
  // custom profile that assumes `platform` marks its facts reference-only, so
  // they land in the seed.
  const platformPolicy: Policy = {
    id: "test-platform",
    filter: [
      {
        match: { any: [{ schema: "platform" }, { name: "platform" }] },
        action: "exclude",
      },
    ],
    assumedSchemas: ["platform"],
  };
  const schemaPlatform: StableId = { kind: "schema", name: "platform" };
  const noisyFn: StableId = {
    kind: "function",
    schema: "platform",
    name: "noisy",
    args: [],
  };
  const tidyFn: StableId = {
    kind: "function",
    schema: "platform",
    name: "tidy",
    args: [],
  };
  // Mirrors pg_get_functiondef output: SET clauses are header lines before `AS`.
  const noisyDef =
    `CREATE OR REPLACE FUNCTION platform.noisy()\n` +
    ` RETURNS integer\n` +
    ` LANGUAGE sql\n` +
    ` SET search_path TO 'public'\n` +
    ` SET log_min_messages TO 'fatal'\n` +
    `AS $function$SELECT 1$function$`;
  const tidyDef =
    `CREATE OR REPLACE FUNCTION platform.tidy()\n` +
    ` RETURNS integer\n` +
    ` LANGUAGE sql\n` +
    ` SET search_path TO 'public'\n` +
    `AS $function$SELECT 1$function$`;
  const routinePayload = (
    def: string,
    configGucs: string[],
  ): Fact["payload"] => ({
    def,
    returnType: "integer",
    argSignature: "",
    language: "sql",
    isWindow: false,
    // Structured GUC names from proconfig; `_`-prefixed ⇒ non-semantic (excluded
    // from hash + diff), used only for the seed skip decision.
    _configGucs: configGucs,
  });
  const adpFact: Fact = {
    id: {
      kind: "defaultPrivilege",
      role: "admin",
      schema: "platform",
      objtype: "r",
      grantee: "reader",
    },
    payload: { privileges: ["SELECT"], grantable: [] },
  };
  // Snapshot target: a single routine + ADP, so the no-option path can be pinned
  // byte-identical (routine def rendered verbatim, ADP omitted).
  const platformTarget = () =>
    buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        adpFact,
      ],
      [],
    );

  test("susetGucs excludes the whole offending routine (not a stripped copy); a search_path-only routine is seeded intact; ADP omitted", () => {
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        f(tidyFn, routinePayload(tidyDef, ["search_path"])),
        adpFact,
      ],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: ["admin", "reader"],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the WHOLE offending routine is absent — no trace of a stripped version.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("log_min_messages");
    // a routine whose only proconfig GUC is user-context (search_path) is kept.
    expect(seed.sql).toContain("platform.tidy()");
    expect(seed.sql).toContain("SET search_path TO 'public'");
    // ADP is unconditionally omitted (no member-of-role at replay).
    expect(seed.sql).not.toContain("ALTER DEFAULT PRIVILEGES");
  });

  test("a fact depending on the excluded routine is excluded transitively", () => {
    const dependentFn: StableId = {
      kind: "function",
      schema: "platform",
      name: "dependent",
      args: [],
    };
    const dependentDef =
      `CREATE OR REPLACE FUNCTION platform.dependent()\n` +
      ` RETURNS integer\n` +
      ` LANGUAGE sql\n` +
      `AS $function$SELECT platform.noisy()$function$`;
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        f(dependentFn, routinePayload(dependentDef, [])),
      ],
      [{ from: dependentFn, to: noisyFn, kind: "depends" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the excluded routine AND its dependent are both gone; the schema remains.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("dependent");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  });

  test("a container fact excluded via depends does not orphan its CHILD facts (structural cascade)", () => {
    // A view depends (via `depends` edge) on the SUSET-GUC routine, so the
    // depends-edge fixpoint excludes the view. Parent/child containment is NOT
    // a `depends` edge (it's structural, via Fact.parent — see fact.ts), so
    // without a structural cascade the view's column child survives the flat
    // `keptFacts.filter` and buildFactBase throws "references missing parent"
    // because its parent (the view) was excluded.
    const reportsView: StableId = {
      kind: "view",
      schema: "platform",
      name: "reports",
    };
    const reportsIdColumn: StableId = {
      kind: "column",
      schema: "platform",
      table: "reports",
      name: "id",
    };
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(
          noisyFn,
          routinePayload(noisyDef, ["search_path", "log_min_messages"]),
        ),
        { id: reportsView, parent: schemaPlatform, payload: {} },
        { id: reportsIdColumn, parent: reportsView, payload: {} },
      ],
      [{ from: reportsView, to: noisyFn, kind: "depends" }],
    );
    // Before the fix this call throws:
    //   FactBase: fact column|platform|reports|id references missing parent view|platform|reports
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
      susetGucs: new Set(["log_min_messages"]),
    });
    // the excluded routine AND the dependent view AND its column child are all
    // gone; the schema remains.
    expect(seed.sql).not.toContain("noisy");
    expect(seed.sql).not.toContain("reports");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  });

  // A reference-only overlay can DEPEND on a MANAGED fact (one that only comes
  // into existence when the declarative files load, AFTER the seed replays).
  // Field case: a policy on an assumed platform table whose expression calls a
  // user function in a managed schema — the seed used to include it and Postgres
  // failed the whole seed with `schema "app" does not exist`. Such a candidate
  // must be omitted WHOLE (never rewritten), together with everything that
  // depends on it and every fact it structurally contains.
  const appHelperFn: StableId = {
    kind: "function",
    schema: "app",
    name: "helper",
    args: [],
  };
  const appHelperDef =
    `CREATE OR REPLACE FUNCTION app.helper()\n` +
    ` RETURNS integer\n` +
    ` LANGUAGE sql\n` +
    `AS $function$SELECT 1$function$`;

  test("a candidate depending on a MANAGED fact is omitted, transitively", () => {
    const crossLayerFn: StableId = {
      kind: "function",
      schema: "platform",
      name: "cross_layer",
      args: [],
    };
    const downstreamFn: StableId = {
      kind: "function",
      schema: "platform",
      name: "downstream",
      args: [],
    };
    const crossLayerDef =
      `CREATE OR REPLACE FUNCTION platform.cross_layer()\n` +
      ` RETURNS integer\n` +
      ` LANGUAGE sql\n` +
      `AS $function$SELECT app.helper()$function$`;
    const downstreamDef =
      `CREATE OR REPLACE FUNCTION platform.downstream()\n` +
      ` RETURNS integer\n` +
      ` LANGUAGE sql\n` +
      `AS $function$SELECT platform.cross_layer()$function$`;
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(schemaApp),
        f(appHelperFn, routinePayload(appHelperDef, [])),
        f(crossLayerFn, routinePayload(crossLayerDef, [])),
        f(downstreamFn, routinePayload(downstreamDef, [])),
        f(tidyFn, routinePayload(tidyDef, ["search_path"])),
      ],
      [
        { from: crossLayerFn, to: appHelperFn, kind: "depends" },
        { from: downstreamFn, to: crossLayerFn, kind: "depends" },
      ],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
    });
    // the assumed schema and the self-contained platform routine still seed.
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
    expect(seed.sql).toContain("platform.tidy()");
    // the managed-dependency overlay AND its dependent are absent.
    expect(seed.sql).not.toContain("cross_layer");
    expect(seed.sql).not.toContain("downstream");
    // the managed schema and its objects are never seeded.
    expect(seed.sql).not.toContain('"app"');
    expect(seed.sql).not.toContain("app.helper");
    expect(seed.schemas).toEqual(["platform"]);
    expect(seed.facts).toBe(2);
  });

  test("a candidate omitted for a MANAGED dependency does not orphan its CHILD facts", () => {
    // Same structural interplay as the susetGucs case: containment is `Fact.parent`,
    // not a `depends` edge, so omitting the container without its descendants
    // would leave orphaned children and buildFactBase would hard-throw
    // "references missing parent".
    const overlayView: StableId = {
      kind: "view",
      schema: "platform",
      name: "overlay",
    };
    const overlayIdColumn: StableId = {
      kind: "column",
      schema: "platform",
      table: "overlay",
      name: "id",
    };
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(schemaApp),
        f(appHelperFn, routinePayload(appHelperDef, [])),
        f(tidyFn, routinePayload(tidyDef, ["search_path"])),
        {
          id: overlayView,
          parent: schemaPlatform,
          payload: { def: " SELECT app.helper() AS id;" },
        },
        {
          id: overlayIdColumn,
          parent: overlayView,
          payload: { type: "integer", notNull: false },
        },
      ],
      [{ from: overlayView, to: appHelperFn, kind: "depends" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
    });
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
    expect(seed.sql).toContain("platform.tidy()");
    expect(seed.sql).not.toContain("overlay");
    expect(seed.sql).not.toContain("app.helper");
    expect(seed.facts).toBe(2);
  });

  test("a candidate depending on a POLICY-PRUNED fact is omitted", () => {
    // `private` is excluded but NOT assumed: resolveView hard-prunes it and
    // drops the edge, so the view alone makes the dependency look ambient.
    const privatePolicy: Policy = {
      ...platformPolicy,
      filter: [
        ...(platformPolicy.filter ?? []),
        {
          match: { any: [{ schema: "private" }, { name: "private" }] },
          action: "exclude",
        },
      ],
    };
    const schemaPrivate: StableId = { kind: "schema", name: "private" };
    const privateFn: StableId = {
      kind: "function",
      schema: "private",
      name: "f",
      args: [],
    };
    const callsPrivate: StableId = {
      kind: "function",
      schema: "platform",
      name: "calls_private",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(schemaPrivate),
        f(privateFn, routinePayload("CREATE FUNCTION private.f()", [])),
        f(
          callsPrivate,
          routinePayload("CREATE FUNCTION platform.calls_private()", []),
        ),
        f(tidyFn, routinePayload(tidyDef, ["search_path"])),
      ],
      [{ from: callsPrivate, to: privateFn, kind: "depends" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: privatePolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
    });
    expect(seed.sql).toContain("platform.tidy()");
    expect(seed.sql).not.toContain("calls_private");
    expect(seed.facts).toBe(2);
  });

  test("a candidate depending on another REFERENCE-ONLY non-candidate is still seeded", () => {
    // Extension members are reference-only but excluded from the candidate set
    // (CREATE EXTENSION owns their lifecycle). They are ambient in the shadow —
    // an assumed-schema fact depending on one must NOT be omitted.
    const ext: StableId = { kind: "extension", name: "someext" };
    const memberFn: StableId = {
      kind: "function",
      schema: "platform",
      name: "member_fn",
      args: [],
    };
    const userOfMember: StableId = {
      kind: "function",
      schema: "platform",
      name: "uses_member",
      args: [],
    };
    const usesMemberDef =
      `CREATE OR REPLACE FUNCTION platform.uses_member()\n` +
      ` RETURNS integer\n` +
      ` LANGUAGE sql\n` +
      `AS $function$SELECT platform.member_fn()$function$`;
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(ext),
        f(memberFn, routinePayload("CREATE FUNCTION platform.member_fn()", [])),
        f(userOfMember, routinePayload(usesMemberDef, [])),
      ],
      [
        { from: memberFn, to: ext, kind: "memberOfExtension" },
        { from: userOfMember, to: memberFn, kind: "depends" },
      ],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: [],
    });
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
    expect(seed.sql).toContain("platform.uses_member()");
  });

  // `public` and `xext` are hard-pruned, so the member table `public.xt` leaves
  // the view; whether `uses_x` replays depends on the seed creating `xext`.
  const prunedMemberSeed = (
    assumedExtensions: string[],
    installSchema = "public",
    satellites: Fact[] = [],
  ) => {
    const ext: StableId = { kind: "extension", name: "xext" };
    const memberTable: StableId = {
      kind: "table",
      schema: "public",
      name: "xt",
    };
    const usesX: StableId = {
      kind: "function",
      schema: "platform",
      name: "uses_x",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(schemaPublic),
        f(schemaApp),
        f(ext, extensionPayload(installSchema, true)),
        {
          id: memberTable,
          parent: schemaPublic,
          payload: { persistence: "p" },
        },
        f(usesX, routinePayload("CREATE FUNCTION platform.uses_x()", [])),
        ...satellites,
      ],
      [
        { from: memberTable, to: ext, kind: "memberOfExtension" },
        { from: usesX, to: memberTable, kind: "depends" },
      ],
    );
    return deriveAssumedSchemaSeed(target, {
      policy: {
        ...platformPolicy,
        filter: [
          ...(platformPolicy.filter ?? []),
          {
            match: { any: [{ schema: "public" }, { name: "public" }] },
            action: "exclude",
          },
          {
            match: { all: [{ kind: "extension" }, { name: "xext" }] },
            action: "exclude",
          },
        ],
        assumedExtensions,
      },
      assumedSchemas: ["platform"],
      assumedRoles: [],
      assumedExtensions,
    });
  };

  test("a candidate depending on a POLICY-PRUNED extension member is still seeded", () => {
    const seed = prunedMemberSeed(["xext"]);
    expect(seed.sql).toContain('CREATE EXTENSION "xext"');
    expect(seed.sql).toContain("platform.uses_x()");
  });

  test("a candidate depending on a member of a PRUNED, unseeded extension is omitted", () => {
    const seed = prunedMemberSeed([]);
    expect(seed.sql).not.toContain("platform.uses_x()");
    expect(seed.sql).toContain('CREATE SCHEMA "platform"');
  });

  test("a candidate depending on a member of an assumed extension the seed omits is omitted", () => {
    // `xext` is installed in the MANAGED `app`, so the install-schema check
    // omits it, and with it anything using its pruned member table, even one
    // with a managed grant.
    const usesX: StableId = {
      kind: "function",
      schema: "platform",
      name: "uses_x",
      args: [],
    };
    const seed = prunedMemberSeed(["xext"], "app", [
      {
        id: { kind: "acl", target: usesX, grantee: "app_user" },
        parent: usesX,
        payload: {},
      },
    ]);
    expect(seed.sql).not.toContain("xext");
    expect(seed.sql).not.toContain("platform.uses_x()");
  });

  test("without susetGucs: routine def retained verbatim (byte-identical), ADP still omitted", () => {
    const seed = deriveAssumedSchemaSeed(platformTarget(), {
      policy: platformPolicy,
      assumedSchemas: ["platform"],
      assumedRoles: ["admin", "reader"],
    });
    expect(seed.sql).toMatchInlineSnapshot(`
      "SET check_function_bodies = off;

      CREATE SCHEMA "platform";

      CREATE OR REPLACE FUNCTION platform.noisy()
       RETURNS integer
       LANGUAGE sql
       SET search_path TO 'public'
       SET log_min_messages TO 'fatal'
      AS $function$SELECT 1$function$;

      RESET check_function_bodies;
      "
    `);
  });

  test("no policy → nothing is reference-only → seeds nothing", () => {
    // assumedSchemas is non-empty but without a policy resolveView is the
    // identity projection, so no fact is reference-only and the seed is empty.
    const target = buildFactBase([f(schemaPublic), f(schemaAuth)], []);
    const seed = deriveAssumedSchemaSeed(target, {
      assumedSchemas: ["auth"],
      assumedRoles: [],
    });
    expect(seed.sql).toBe("");
    expect(seed.facts).toBe(0);
  });

  test("a profile assuming ONLY publications (no schemas) still seeds them", () => {
    // Codex review on #373: the seed used to gate on assumedSchemas alone, so a
    // custom profile whose only assumed objects are publications derived an
    // EMPTY seed and a membership-only declarative dir could not load into the
    // co-located shadow. The supabase profile masks this (it always assumes
    // schemas); this synthetic profile does not.
    const pubOnlyPolicy: Policy = {
      id: "test-pub-only",
      filter: [
        {
          match: { all: [{ kind: "publication" }, { name: "platform_pub" }] },
          action: "exclude",
        },
      ],
      assumedPublications: ["platform_pub"],
    };
    const platformPub: StableId = { kind: "publication", name: "platform_pub" };
    const target = buildFactBase(
      [
        f(schemaPublic),
        f(platformPub, {
          allTables: false,
          viaRoot: false,
          publish: ["insert", "update", "delete", "truncate"],
        }),
      ],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: pubOnlyPolicy,
      assumedSchemas: [],
      assumedRoles: [],
      assumedPublications: ["platform_pub"],
    });
    expect(seed.sql).toContain('CREATE PUBLICATION "platform_pub"');
    expect(seed.facts).toBe(1);
    expect(seed.schemas).toEqual([]);
  });

  test("omits an assumed extension whose install schema is managed", () => {
    // `app` is created later by the user files; a bare CREATE EXTENSION would
    // land in the wrong schema.
    const ext: StableId = { kind: "extension", name: "platform_ext" };
    const extOnlyPolicy: Policy = {
      id: "test-ext-only",
      filter: [
        {
          match: { all: [{ kind: "extension" }, { name: "platform_ext" }] },
          action: "exclude",
        },
      ],
      assumedExtensions: ["platform_ext"],
    };
    const target = buildFactBase(
      [f(schemaApp), f(ext, extensionPayload("app", true))],
      [],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: extOnlyPolicy,
      assumedSchemas: [],
      assumedRoles: [],
      assumedExtensions: ["platform_ext"],
    });
    expect(seed.sql).toBe("");
  });

  test("an assumed extension depending on POLICY-PRUNED facts is still seeded", () => {
    // Extract folds member objects onto the extension, so it `depends` on its
    // install schema `public`, and on `private` and `private.mood` through a
    // member `ALTER EXTENSION … ADD` put there. `CREATE EXTENSION` needs none,
    // but it never recreates that member, so `uses_ext` is omitted.
    const ext: StableId = { kind: "extension", name: "platform_ext" };
    const schemaPrivate: StableId = { kind: "schema", name: "private" };
    const mood: StableId = { kind: "type", schema: "private", name: "mood" };
    const usesExt: StableId = {
      kind: "function",
      schema: "platform",
      name: "uses_ext",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaPublic),
        f(schemaPrivate),
        f(schemaPlatform),
        { id: mood, parent: schemaPrivate, payload: {} },
        f(ext, extensionPayload("public", true)),
        f(usesExt, routinePayload("CREATE FUNCTION platform.uses_ext()", [])),
      ],
      [
        { from: ext, to: schemaPublic, kind: "depends" },
        { from: ext, to: schemaPrivate, kind: "depends" },
        { from: ext, to: mood, kind: "depends" },
        { from: usesExt, to: ext, kind: "depends" },
      ],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: {
        id: "test-ext-in-pruned-schemas",
        filter: [
          {
            match: {
              any: [
                { schema: ["public", "private", "platform"] },
                { name: ["public", "private", "platform"] },
              ],
            },
            action: "exclude",
          },
          {
            match: { all: [{ kind: "extension" }, { name: "platform_ext" }] },
            action: "exclude",
          },
        ],
        assumedSchemas: ["platform"],
        assumedExtensions: ["platform_ext"],
      },
      assumedSchemas: ["platform"],
      assumedRoles: [],
      assumedExtensions: ["platform_ext"],
    });
    expect(seed.sql).toContain('CREATE EXTENSION "platform_ext"');
    expect(seed.sql).not.toContain("uses_ext");
  });

  test("an assumed extension using a member of an omitted extension is still seeded", () => {
    // `base_ext` is omitted (managed install schema); `platform_ext`'s edge to
    // its member table comes from an added member `CREATE EXTENSION` skips.
    const baseExt: StableId = { kind: "extension", name: "base_ext" };
    const ext: StableId = { kind: "extension", name: "platform_ext" };
    const baseTable: StableId = { kind: "table", schema: "public", name: "bt" };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(schemaApp),
          f(schemaPublic),
          f(baseExt, extensionPayload("app", true)),
          f(ext, extensionPayload("pg_catalog", false)),
          {
            id: baseTable,
            parent: schemaPublic,
            payload: { persistence: "p" },
          },
        ],
        [
          { from: baseTable, to: baseExt, kind: "memberOfExtension" },
          { from: ext, to: baseTable, kind: "depends" },
        ],
      ),
      {
        policy: {
          id: "test-ext-uses-omitted-member",
          filter: [
            { match: { kind: "extension" }, action: "exclude" },
            {
              match: { any: [{ schema: "public" }, { name: "public" }] },
              action: "exclude",
            },
          ],
          assumedExtensions: ["base_ext", "platform_ext"],
        },
        assumedSchemas: [],
        assumedRoles: [],
        assumedExtensions: ["base_ext", "platform_ext"],
      },
    );
    expect(seed.sql).toContain('CREATE EXTENSION "platform_ext"');
    expect(seed.sql).not.toContain("base_ext");
  });

  test("an assumed extension using a POLICY-PRUNED extension's member table is omitted", () => {
    // A member function taking `b_ext`'s table rowtype folds an edge onto the
    // `bschema.bt` table, not onto `b_ext`; `CREATE EXTENSION a_ext` needs it.
    const a: StableId = { kind: "extension", name: "a_ext" };
    const b: StableId = { kind: "extension", name: "b_ext" };
    const bschema: StableId = { kind: "schema", name: "bschema" };
    const bt: StableId = { kind: "table", schema: "bschema", name: "bt" };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(bschema),
          f(a, extensionPayload("pg_catalog", false)),
          f(b, extensionPayload("bschema", false)),
          { id: bt, parent: bschema, payload: { persistence: "p" } },
        ],
        [
          { from: bt, to: b, kind: "memberOfExtension" },
          { from: a, to: bt, kind: "depends" },
        ],
      ),
      {
        policy: {
          id: "test-ext-uses-pruned-member-table",
          filter: [
            { match: { kind: "extension" }, action: "exclude" },
            {
              match: { any: [{ schema: "bschema" }, { name: "bschema" }] },
              action: "exclude",
            },
          ],
          assumedExtensions: ["a_ext"],
        },
        assumedSchemas: [],
        assumedRoles: [],
        assumedExtensions: ["a_ext"],
      },
    );
    expect(seed.sql).toBe("");
  });

  test("an assumed extension with an added member stays omitted when its custom install schema is POLICY-PRUNED", () => {
    // A pruned `extensions` never exists in the shadow, so a bare
    // `CREATE EXTENSION hstore` would land in the wrong schema.
    const ext: StableId = { kind: "extension", name: "hstore" };
    const extensions: StableId = { kind: "schema", name: "extensions" };
    const schemaPrivate: StableId = { kind: "schema", name: "private" };
    const mood: StableId = { kind: "type", schema: "private", name: "mood" };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(extensions),
          f(schemaPrivate),
          f(ext, extensionPayload("extensions", true)),
          { id: mood, parent: schemaPrivate, payload: {} },
        ],
        [
          { from: ext, to: extensions, kind: "depends" },
          { from: ext, to: mood, kind: "depends" },
        ],
      ),
      {
        policy: {
          id: "test-ext-in-pruned-custom-schema",
          filter: [
            { match: { kind: "extension" }, action: "exclude" },
            {
              match: {
                any: [
                  { schema: ["extensions", "private"] },
                  { name: ["extensions", "private"] },
                ],
              },
              action: "exclude",
            },
          ],
          assumedExtensions: ["hstore"],
        },
        assumedSchemas: [],
        assumedRoles: [],
        assumedExtensions: ["hstore"],
      },
    );
    expect(seed.sql).not.toContain("hstore");
  });

  test("an assumed extension using a POLICY-PRUNED extension's members is omitted", () => {
    // A member using `base_ext`'s function or type folds an edge onto
    // `base_ext` itself; `CREATE EXTENSION platform_ext` would fail without it.
    const ext: StableId = { kind: "extension", name: "platform_ext" };
    const baseExt: StableId = { kind: "extension", name: "base_ext" };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [f(ext, extensionPayload("pg_catalog", false)), f(baseExt)],
        [{ from: ext, to: baseExt, kind: "depends" }],
      ),
      {
        policy: {
          id: "test-ext-requires-pruned",
          filter: [{ match: { kind: "extension" }, action: "exclude" }],
          assumedExtensions: ["platform_ext"],
        },
        assumedSchemas: [],
        assumedRoles: [],
        assumedExtensions: ["platform_ext"],
      },
    );
    expect(seed.sql).toBe("");
  });

  // An assumed publication with one membership on `public.t`; extract folds
  // the membership's dependency onto the publication (the `pubrel` CTE).
  const publicationShellSeed = (filter: NonNullable<Policy["filter"]>) => {
    const platformPub: StableId = { kind: "publication", name: "platform_pub" };
    const userTable: StableId = { kind: "table", schema: "public", name: "t" };
    const target = buildFactBase(
      [
        f(schemaPublic),
        f(platformPub, {
          allTables: false,
          viaRoot: false,
          publish: ["insert", "update", "delete", "truncate"],
        }),
        { id: userTable, parent: schemaPublic, payload: { persistence: "p" } },
        {
          id: {
            kind: "publicationRel",
            publication: "platform_pub",
            schema: "public",
            table: "t",
          },
          parent: platformPub,
          payload: { columns: null, where: null },
        },
      ],
      [{ from: platformPub, to: userTable, kind: "depends" }],
    );
    return deriveAssumedSchemaSeed(target, {
      policy: {
        id: "test-pub-shell",
        filter: [
          {
            match: { all: [{ kind: "publication" }, { name: "platform_pub" }] },
            action: "exclude",
          },
          ...filter,
        ],
        assumedPublications: ["platform_pub"],
      },
      assumedSchemas: [],
      assumedRoles: [],
      assumedPublications: ["platform_pub"],
    });
  };

  test("an assumed SHELL keeps its inherited managed dependency (publication members)", () => {
    // #370: an assumed publication is seeded EMPTY — membership is a separate
    // MANAGED `publicationRel` child fact the seed never creates. But extract
    // collapses `pg_publication_rel` catalog rows onto the PUBLICATION id
    // (src/extract/dependencies.ts's `pubrel` CTE), so the publication fact
    // INHERITS a `depends` edge to each managed member table. That edge is not a
    // replay requirement for `CREATE PUBLICATION` with no `FOR TABLE`, so the
    // managed-dependency rule must not omit the publication (which would silently
    // empty the seed and break a membership-only declarative dir).
    const seed = publicationShellSeed([]);
    expect(seed.sql).toContain('CREATE PUBLICATION "platform_pub"');
    // seeded as a bare shell — membership is managed, never seeded.
    expect(seed.sql).not.toMatch(/ADD TABLE|FOR TABLE/i);
    expect(seed.facts).toBe(1);
  });

  test("an assumed publication whose memberships are all POLICY-PRUNED is still seeded empty", () => {
    // `public` is hard-pruned, taking the member table AND its `publicationRel`
    // out of the view; the publication still replays with no members.
    const seed = publicationShellSeed([
      { match: { schema: "public" }, action: "exclude" },
    ]);
    expect(seed.sql).toContain('CREATE PUBLICATION "platform_pub"');
    expect(seed.sql).not.toMatch(/ADD TABLE|FOR TABLE/i);
    expect(seed.facts).toBe(1);
  });

  test("a membership on a managedBy-pruned table still seeds its publication empty", () => {
    // `q_jobs` is pruned (`managedBy`) by an extension the profile does not
    // assume, so its membership is omitted, not the publication.
    const pub: StableId = { kind: "publication", name: "platform_pub" };
    const qext: StableId = { kind: "extension", name: "qext" };
    const queue: StableId = {
      kind: "table",
      schema: "private",
      name: "q_jobs",
    };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(schemaPlatform),
          f({ kind: "schema", name: "private" }),
          f(qext),
          f(pub, { allTables: false, viaRoot: false, publish: ["insert"] }),
          {
            id: queue,
            parent: { kind: "schema", name: "private" },
            payload: { persistence: "p" },
          },
          {
            id: {
              kind: "publicationRel",
              publication: "platform_pub",
              schema: "private",
              table: "q_jobs",
            },
            parent: pub,
            payload: { columns: null, where: null },
          },
        ],
        [
          { from: queue, to: qext, kind: "managedBy" },
          { from: pub, to: queue, kind: "depends" },
          {
            from: {
              kind: "publicationRel",
              publication: "platform_pub",
              schema: "private",
              table: "q_jobs",
            },
            to: queue,
            kind: "depends",
          },
        ],
      ),
      {
        policy: {
          id: "test-pub-pruned-member",
          filter: [
            {
              match: {
                any: [
                  { schema: "private" },
                  { name: ["private", "platform_pub"] },
                ],
              },
              action: "exclude",
            },
          ],
          assumedSchemas: ["private"],
          assumedPublications: ["platform_pub"],
        },
        assumedSchemas: ["private"],
        assumedRoles: [],
        assumedPublications: ["platform_pub"],
      },
    );
    expect(seed.sql).toContain('CREATE PUBLICATION "platform_pub"');
    expect(seed.sql).not.toContain("q_jobs");
  });

  test("a membership pruned apart from its managed table keeps its publication", () => {
    // The filter prunes the `app.u` membership but not `app.u`; the edge it
    // folds onto the publication is not a replay requirement.
    const pub: StableId = { kind: "publication", name: "platform_pub" };
    const kept: StableId = { kind: "table", schema: "platform", name: "t" };
    const managed: StableId = { kind: "table", schema: "app", name: "u" };
    const rel = (schema: string, table: string): Fact => ({
      id: {
        kind: "publicationRel",
        publication: "platform_pub",
        schema,
        table,
      },
      parent: pub,
      payload: { columns: null, where: null },
    });
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(schemaPlatform),
          f(schemaApp),
          f(pub, { allTables: false, viaRoot: false, publish: ["insert"] }),
          { id: kept, parent: schemaPlatform, payload: { persistence: "p" } },
          { id: managed, parent: schemaApp, payload: { persistence: "p" } },
          rel("platform", "t"),
          rel("app", "u"),
        ],
        [
          { from: pub, to: kept, kind: "depends" },
          { from: pub, to: managed, kind: "depends" },
          { from: rel("platform", "t").id, to: kept, kind: "depends" },
          { from: rel("app", "u").id, to: managed, kind: "depends" },
        ],
      ),
      {
        policy: {
          id: "test-pub-pruned-membership",
          filter: [
            {
              match: {
                any: [
                  { schema: "platform" },
                  { name: ["platform", "platform_pub"] },
                  { all: [{ kind: "publicationRel" }, { schema: "app" }] },
                ],
              },
              action: "exclude",
            },
          ],
          assumedSchemas: ["platform"],
          assumedPublications: ["platform_pub"],
        },
        assumedSchemas: ["platform"],
        assumedRoles: [],
        assumedPublications: ["platform_pub"],
      },
    );
    expect(seed.sql).toContain('FOR TABLE "platform"."t"');
  });

  test("a POLICY-PRUNED membership on a partition keeps its publication", () => {
    // Extract resolves the partition's column-list edge to the root's own
    // column (`colanc`), so `platform_pub` depends on managed `app.parent.id`.
    const pub: StableId = { kind: "publication", name: "platform_pub" };
    const schemaPrivate: StableId = { kind: "schema", name: "private" };
    const parentTable: StableId = {
      kind: "table",
      schema: "app",
      name: "parent",
    };
    const child: StableId = { kind: "table", schema: "private", name: "child" };
    const rootColumn: StableId = {
      kind: "column",
      schema: "app",
      table: "parent",
      name: "id",
    };
    const rel: StableId = {
      kind: "publicationRel",
      publication: "platform_pub",
      schema: "private",
      table: "child",
    };
    const seed = deriveAssumedSchemaSeed(
      buildFactBase(
        [
          f(schemaApp),
          f(schemaPrivate),
          f(pub, { allTables: false, viaRoot: false, publish: ["insert"] }),
          {
            id: parentTable,
            parent: schemaApp,
            payload: { persistence: "p", parentTable: null },
          },
          { id: rootColumn, parent: parentTable, payload: { type: "integer" } },
          {
            id: child,
            parent: schemaPrivate,
            payload: {
              persistence: "p",
              parentTable: { schema: "app", name: "parent" },
            },
          },
          { id: rel, parent: pub, payload: { columns: ["id"], where: null } },
        ],
        [
          { from: pub, to: child, kind: "depends" },
          { from: pub, to: rootColumn, kind: "depends" },
          { from: rel, to: child, kind: "depends" },
        ],
      ),
      {
        policy: {
          id: "test-pub-pruned-partition-membership",
          filter: [
            {
              match: {
                any: [
                  { schema: "private" },
                  { name: ["private", "platform_pub"] },
                ],
              },
              action: "exclude",
            },
          ],
          assumedPublications: ["platform_pub"],
        },
        assumedSchemas: [],
        assumedRoles: [],
        assumedPublications: ["platform_pub"],
      },
    );
    expect(seed.sql).toContain('CREATE PUBLICATION "platform_pub"');
  });

  test("a pruned SATELLITE does not make its candidate a shell", () => {
    // supabasePolicy hard-prunes the comment; the managed `app.mood` still omits auth.f.
    const mood: StableId = { kind: "type", schema: "app", name: "mood" };
    const fn: StableId = {
      kind: "function",
      schema: "auth",
      name: "f",
      args: [],
    };
    const target = buildFactBase(
      [
        f(schemaAuth),
        f(schemaApp),
        { id: mood, parent: schemaApp, payload: {} },
        {
          id: fn,
          parent: schemaAuth,
          payload: {
            def: "CREATE FUNCTION auth.f() RETURNS app.mood LANGUAGE sql AS $$select 'a'::app.mood$$",
            returnType: "app.mood",
            argSignature: "",
            language: "sql",
            isWindow: false,
            _configGucs: [],
          },
        },
        {
          id: { kind: "comment", target: fn },
          parent: fn,
          payload: { text: "doc" },
        },
      ],
      [{ from: fn, to: mood, kind: "depends" }],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: supabasePolicy,
      assumedSchemas: supabaseAssumedSchemas,
      assumedRoles: [],
    });
    expect(seed.sql).not.toContain("auth.f()");
    expect(seed.facts).toBe(1);
  });

  test("a POLICY-PRUNED membership does not hide a kept membership's managed dependency", () => {
    // The kept `platform.t (later)` membership folds an edge to the MANAGED
    // column `later` onto the publication; the pruned `private.t` membership
    // must not let the seed list that column before the files create it.
    const pub: StableId = { kind: "publication", name: "platform_pub" };
    const schemaPrivate: StableId = { kind: "schema", name: "private" };
    const kept: StableId = { kind: "table", schema: "platform", name: "t" };
    const pruned: StableId = { kind: "table", schema: "private", name: "t" };
    const later: StableId = {
      kind: "column",
      schema: "platform",
      table: "t",
      name: "later",
    };
    const rel = (schema: string, columns: string[] | null): Fact => ({
      id: {
        kind: "publicationRel",
        publication: "platform_pub",
        schema,
        table: "t",
      },
      parent: pub,
      payload: { columns, where: null },
    });
    const target = buildFactBase(
      [
        f(schemaPlatform),
        f(schemaPrivate),
        f(pub, { allTables: false, viaRoot: false, publish: ["insert"] }),
        { id: kept, parent: schemaPlatform, payload: { persistence: "p" } },
        {
          id: later,
          parent: kept,
          payload: { type: "integer", notNull: false },
        },
        { id: pruned, parent: schemaPrivate, payload: { persistence: "p" } },
        rel("platform", ["later"]),
        rel("private", null),
      ],
      [
        { from: pub, to: later, kind: "depends" },
        { from: pub, to: pruned, kind: "depends" },
      ],
    );
    const seed = deriveAssumedSchemaSeed(target, {
      policy: {
        id: "test-pub-managed-column",
        filter: [
          {
            match: {
              any: [
                { all: [{ kind: "table" }, { schema: "platform" }] },
                { all: [{ kind: "publicationRel" }, { schema: "platform" }] },
                { schema: "private" },
                { name: ["platform", "private", "platform_pub"] },
              ],
            },
            action: "exclude",
          },
        ],
        assumedSchemas: ["platform"],
        assumedPublications: ["platform_pub"],
      },
      assumedSchemas: ["platform"],
      assumedRoles: [],
      assumedPublications: ["platform_pub"],
    });
    expect(seed.sql).toContain('CREATE TABLE "platform"."t"');
    expect(seed.sql).not.toContain("PUBLICATION");
  });
});
