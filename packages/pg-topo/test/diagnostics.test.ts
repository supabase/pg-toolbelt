import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";

describe("diagnostics", () => {
  test("reports duplicate producers with candidate details", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.users(id int primary key);",
      "create table app.users(id int primary key, email text not null);",
      "create view app.user_ids as select id from app.users;",
    ]);
    const duplicateDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
    );
    const ambiguousDependency = duplicateDiagnostics.find((diagnostic) =>
      diagnostic.message.includes("Ambiguous dependency"),
    );

    expect(duplicateDiagnostics.length).toBeGreaterThan(0);
    expect(ambiguousDependency).toBeDefined();
    expect(
      JSON.stringify(ambiguousDependency?.details?.candidateObjectKeys),
    ).toContain("table:app:users");
  });

  test("includes candidate producers for unresolved dependencies", async () => {
    const result = await analyzeAndSort([
      "create schema analytics;",
      "create table analytics.accounts(id int primary key);",
      "create view public.account_ids as select id from public.accounts;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "UNRESOLVED_DEPENDENCY",
    );

    expect(unresolved).toBeDefined();
    expect(unresolved?.details?.candidateObjectKeys).toBeDefined();
    expect(JSON.stringify(unresolved?.details?.candidateObjectKeys)).toContain(
      "table:analytics:accounts",
    );
  });

  test("reports unresolved publication for ALTER SUBSCRIPTION ADD PUBLICATION", async () => {
    const result = await analyzeAndSort([
      "alter subscription sub_orders add publication pub_events;",
      "create subscription sub_orders connection 'host=localhost port=5432 dbname=postgres' publication pub_orders with (connect = false);",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "publication::pub_events:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved table for ALTER PUBLICATION DROP TABLE", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders drop table public.orders;",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "table:public:orders:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved schema for ALTER PUBLICATION DROP TABLES IN SCHEMA", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_sales drop tables in schema sales;",
      "create publication pub_sales;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey === "schema::sales:",
    );

    expect(unresolved).toBeDefined();
  });

  test("reports unresolved row filter function for ALTER PUBLICATION ADD TABLE", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders add table public.orders where (public.is_visible(id));",
      "create table public.orders(id int primary key);",
      "create publication pub_orders;",
    ]);
    const unresolved = result.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        diagnostic.details?.requiredObjectKey ===
          "function:public:is_visible:(unknown)",
    );

    expect(unresolved).toBeDefined();
  });

  test("cycle diagnostics include statement participants", async () => {
    const result = await analyzeAndSort([
      "create view public.v1 as select * from public.v2;",
      "create view public.v2 as select * from public.v1;",
    ]);
    const cycleDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    );

    expect(cycleDiagnostic).toBeDefined();
    expect(cycleDiagnostic?.details?.cycleStatements).toBeDefined();
    const cycleStatements = JSON.stringify(
      cycleDiagnostic?.details?.cycleStatements,
    );
    expect(cycleStatements).toContain("<input:");
  });

  test("externalProviders suppresses UNRESOLVED_DEPENDENCY for provided objects", async () => {
    const sql = [
      "create schema analytics;",
      "create table analytics.accounts(id int primary key);",
      "create view public.account_ids as select id from public.accounts;",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const externalProviders = [
      { kind: "table" as const, schema: "public", name: "accounts" },
    ];
    const withProviders = await analyzeAndSort(sql, { externalProviders });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) => d.code === "UNRESOLVED_DEPENDENCY",
    );
    expect(unresolvedWith.length).toBeLessThan(unresolvedWithout.length);
  });

  test("externalProviders with signature mismatch uses compatibility (e.g. timezone)", async () => {
    const sql = [
      "create table public.events(ts timestamptz default timezone('utc'::text, now()) not null);",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const timezoneUnresolved = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes("timezone"),
    );
    expect(timezoneUnresolved.length).toBeGreaterThan(0);

    const externalProviders = [
      {
        kind: "function" as const,
        schema: "public",
        name: "timezone",
        signature: "(text,timestamp with time zone)",
      },
    ];
    const withProviders = await analyzeAndSort(sql, { externalProviders });
    const timezoneUnresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes("timezone"),
    );
    expect(timezoneUnresolvedWith.length).toBe(0);
  });

  test("external aggregate providers satisfy function-call requirements", async () => {
    const sql = [
      "create table public.accounts(id int);",
      "create view public.max_account as select max(id) from public.accounts;",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:public:max",
        ),
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "aggregate",
          schema: "public",
          name: "max",
          signature: "(integer)",
        },
      ],
    });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:public:max",
        ),
    );
    expect(unresolvedWith.length).toBe(0);
  });

  test("external variadic providers satisfy unknown-arity calls", async () => {
    const sql = [
      "create table public.events(meta jsonb default json_build_object('a', 1));",
    ];
    const withoutProviders = await analyzeAndSort(sql);
    const unresolvedWithout = withoutProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "json_build_object",
        ),
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "function",
          schema: "public",
          name: "json_build_object",
          signature: "(VARIADIC any)",
        },
      ],
    });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "json_build_object",
        ),
    );
    expect(unresolvedWith.length).toBe(0);
  });

  test("strict extension schema behavior remains unchanged", async () => {
    const sql = [
      "create table public.ids(id uuid default extensions.uuid_generate_v4());",
    ];
    const withMismatchedProvider = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "function",
          schema: "public",
          name: "uuid_generate_v4",
          signature: "()",
        },
      ],
    });
    const unresolved = withMismatchedProvider.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        JSON.stringify(d.details?.requiredObjectKey).includes(
          "function:extensions:uuid_generate_v4",
        ),
    );
    expect(unresolved.length).toBeGreaterThan(0);
  });

  test("multiple producers for same constraint add requires_constraint_key edges", async () => {
    const result = await analyzeAndSort([
      "create schema app;",
      "create table app.t(id int primary key);",
      "create table app.t(id int primary key, x int);",
      "create table app.ref(id int references app.t(id));",
    ]);
    const duplicateTable = result.diagnostics.filter(
      (d) => d.code === "DUPLICATE_PRODUCER",
    );
    expect(duplicateTable.length).toBeGreaterThan(0);
    expect(
      result.graph.edges.some((e) => e.reason === "requires_constraint_key"),
    ).toBe(true);
  });

  test("comment on trigger and policy resolve to existing producers", async () => {
    const sql = [
      "create schema auth;",
      "create table auth.users(id bigint primary key, email text, deleted_at timestamptz);",
      "create function auth.touch_users_updated_at() returns trigger language plpgsql as $$ begin return new; end; $$;",
      "create trigger initialise_auth_users_email before insert or update on auth.users for each row execute function auth.touch_users_updated_at();",
      "create policy users_select_policy on auth.users for select using (deleted_at is null);",
      "comment on trigger initialise_auth_users_email on auth.users is 'init email';",
      "comment on policy users_select_policy on auth.users is 'policy docs';",
    ];

    const result = await analyzeAndSort(sql);
    const unresolved = result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === "UNRESOLVED_DEPENDENCY" &&
        (JSON.stringify(diagnostic.details?.requiredObjectKey).includes(
          "initialise_auth_users_email",
        ) ||
          JSON.stringify(diagnostic.details?.requiredObjectKey).includes(
            "users_select_policy",
          )),
    );

    expect(unresolved.length).toBe(0);
  });

  test("overloads that differ by an array or output parameter do not collide", async () => {
    for (const sql of [
      [
        "create function public.f(k text, id uuid) returns int language sql as $$ select 1 $$;",
        "create function public.f(k text, ids uuid[]) returns int language sql as $$ select 1 $$;",
      ],
      [
        "create function public.f(a int) returns int language sql as $$ select 1 $$;",
        "create function public.f(a int[][]) returns int language sql as $$ select 1 $$;",
      ],
      [
        "create aggregate public.f(int) (sfunc = int4pl, stype = int);",
        "create aggregate public.f(int[][]) (sfunc = array_cat, stype = int[]);",
      ],
      [
        "create function public.f(id uuid) returns int language sql as $$ select 1 $$;",
        "create function public.f(variadic ids uuid[]) returns int language sql as $$ select 1 $$;",
      ],
      [
        "create function public.f(k uuid, id uuid) returns int language sql as $$ select 1 $$;",
        "create function public.f(k uuid) returns table (id uuid) language sql as $$ select null::uuid $$;",
      ],
      [
        "create function public.f(a int, b int) returns int language sql as $$ select 1 $$;",
        "create function public.f(a int, out b int[]) language sql as $$ select null::int[] $$;",
      ],
      [
        "create procedure public.p(a int, b int) language sql as $$ select 1 $$;",
        "create procedure public.p(a int, out b int[]) language sql as $$ select null::int[] $$;",
      ],
    ]) {
      const result = await analyzeAndSort(sql);
      expect({
        sql,
        duplicates: result.diagnostics.filter(
          (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
        ),
      }).toEqual({ sql, duplicates: [] });
    }
  });

  test("a call orders after every routine Postgres could resolve it to", async () => {
    const fn = (signature: string, body = "select 1") =>
      `create function public.${signature} language sql as $$ ${body} $$;`;
    const readsView = "select count(*)::int from public.v";
    // Each case lists the consumer first, then the edges that must reach it.
    for (const [sql, edges] of [
      [
        [
          "create view public.v as select public.f('k', array[]::uuid[]) as x;",
          fn("f(k text, ids uuid[]) returns int"),
          fn("f(k text, id uuid) returns int"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(null::int[]) as x;",
          fn("f(a int[][]) returns int"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(null::uuid, null::uuid) as x;",
          fn("f(variadic ids uuid[]) returns int"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(variadic array[]::uuid[]) as x;",
          fn("f(variadic ids uuid[]) returns int"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(variadic array[]::uuid[]) as x;",
          fn("f(a uuid[]) returns int"),
          fn("f(a uuid) returns int", readsView),
        ],
        ["1 -> 0", "0 -> 2"],
      ],
      [
        [
          "create view public.v as select public.f(1) as x;",
          fn(
            "f(a int, b int default 0, variadic c int[] default '{}') returns int",
          ),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(variadic '{a}'::text[]) as x;",
          fn("f(variadic b text[]) returns int"),
          fn("f(a text) returns int", readsView),
        ],
        ["1 -> 0", "0 -> 2"],
      ],
      [
        [
          "create view public.v as select public.f(null::text[]) as x;",
          fn("f(a text[], b int default 1) returns int"),
          fn("f(variadic a text[]) returns int", readsView),
        ],
        ["1 -> 0", "0 -> 2"],
      ],
      [
        [
          "create view public.v as select public.f(null::text) as x;",
          fn("f(a text, b text) returns int"),
          fn("f(variadic a text[]) returns int"),
        ],
        ["1 -> 0", "2 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(1) as x;",
          fn("f(out a int[], b int)"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.f(null::int[]) as x;",
          fn("f(out a int[], b int[])", "select b"),
        ],
        ["1 -> 0"],
      ],
      [
        [
          "create view public.v as select public.r('{1}'::int[], '{2}'::int[]) as x;",
          "create type public.r as range (subtype = int4[]);",
        ],
        ["1 -> 0"],
      ],
      [
        [
          "comment on procedure public.p(int, int) is 'x';",
          "create procedure public.p(a int, out b int) language sql as $$ select 1 $$;",
        ],
        ["1 -> 0"],
      ],
    ] as const) {
      const result = await analyzeAndSort([...sql]);
      expect({
        sql,
        diagnostics: result.diagnostics,
        edges: result.graph.edges.map(
          (edge) =>
            `${edge.from.filePath.replace(/\D/g, "")} -> ${edge.to.filePath.replace(/\D/g, "")}`,
        ),
      }).toEqual({ sql, diagnostics: [], edges: [...edges] });
    }
  });
});
