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

  test("repeated identical create if not exists statements are one object", async () => {
    for (const [statement, consumer] of [
      ["create schema if not exists app;", "create table app.t (id int);"],
      [
        "create extension if not exists hstore with schema public;",
        "comment on extension hstore is 'kv';",
      ],
    ]) {
      const result = await analyzeAndSort([
        statement,
        `-- another file\n${statement}`,
        consumer,
      ]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  test("a plain create or a differing if not exists create still reports duplicates", async () => {
    for (const statements of [
      ["create schema app;", "create schema app;"],
      ["create schema app;", "create schema if not exists app;"],
      [
        "create table if not exists t (a int);",
        "create table if not exists t (b int);",
      ],
      [
        "create schema if not exists app;",
        "-- pg-topo:phase post_data\ncreate schema if not exists app;",
      ],
    ]) {
      const result = await analyzeAndSort(statements);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
        ),
      ).toHaveLength(2);
    }
  });

  test("a copy that matches itself by compatibility behaves like a single statement", async () => {
    const copy =
      "-- pg-topo:requires table:t\ncreate table if not exists app.t (id int);";
    const other = "create table public.t (id int);";
    const result = await analyzeAndSort([
      "create schema app;",
      copy,
      copy,
      other,
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(result.ordered.map((node) => node.sql).slice(1)).toEqual([
      other,
      copy,
      copy,
    ]);
    const selfOnly = await analyzeAndSort([
      "-- pg-topo:requires table:t\ncreate table if not exists public.t (id int);",
      "-- pg-topo:requires table:t\ncreate table if not exists public.t (id int);",
    ]);
    expect(selfOnly.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "UNRESOLVED_DEPENDENCY",
      "UNRESOLVED_DEPENDENCY",
    ]);
  });

  test("copies providing a routine are one object, and a conflicting declaration is still reported", async () => {
    const copy = (signature: string) =>
      `-- pg-topo:provides function:public.f(${signature})\ncreate extension if not exists hstore;`;
    const declaration =
      "create function public.f(variadic a text[]) returns text language sql as $$ select 'x' $$;";
    for (const [statements, duplicates] of [
      [
        [
          copy("variadic pg_catalog.text[]"),
          copy("variadic pg_catalog.text[]"),
        ],
        0,
      ],
      [[copy("pg_catalog.text[]"), copy("pg_catalog.text[]"), declaration], 3],
    ] as const) {
      const result = await analyzeAndSort([...statements]);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
        ),
      ).toHaveLength(duplicates);
    }
  });

  test("a copy with its own requires annotation stays apart, without a false cycle", async () => {
    const result = await analyzeAndSort([
      "create schema if not exists app;",
      "-- pg-topo:requires table:app.t\ncreate schema if not exists app;",
      "create table app.t (id int);",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "DUPLICATE_PRODUCER",
      "DUPLICATE_PRODUCER",
      "DUPLICATE_PRODUCER",
    ]);
  });

  test("a repeated self-referencing create is one object, ordered before its consumers", async () => {
    const createTable =
      "create table if not exists t (id int primary key, parent int references t (id));";
    const consumer = "create table c (t_id int references t (id));";
    const result = await analyzeAndSort([consumer, createTable, createTable]);
    expect(result.diagnostics).toEqual([]);
    expect(result.ordered.map((node) => node.sql)).toEqual([
      createTable,
      createTable,
      consumer,
    ]);
  });

  test("repeated copies add edges linear in copies and consumers", async () => {
    for (const [copy, consumer] of [
      ["create schema if not exists app;", "create table app.t (id int);"],
      [
        "create table if not exists public.t (id int);",
        "-- pg-topo:requires table:t\ncreate view public.v as select 1;",
      ],
    ]) {
      const result = await analyzeAndSort(
        [0, 1, 2].map(
          (index) => `${copy}\n${consumer.replace(/\b([tv]) /, `$1${index} `)}`,
        ),
      );
      expect(result.diagnostics).toEqual([]);
      expect(result.graph.edges).toHaveLength(5);
      expect(result.ordered.map((node) => node.sql).slice(0, 3)).toEqual(
        Array(3).fill(copy),
      );
    }
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
      [
        "-- pg-topo:provides function:public.f(pg_catalog.uuid[])\ncreate function public.f(variadic ids uuid[]) returns int language sql as $$ select 1 $$;",
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

  test("a plain and a variadic declaration of one array signature are the same routine", async () => {
    const result = await analyzeAndSort([
      "create function public.f(a uuid[]) returns int language sql as $$ select 1 $$;",
      "create or replace function public.f(variadic a uuid[]) returns int language sql as $$ select 2 $$;",
    ]);
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "DUPLICATE_PRODUCER",
      ),
    ).toHaveLength(2);
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

  test("an external variadic provider matches like a declared one", async () => {
    const result = await analyzeAndSort(
      [
        "-- pg-topo:requires function:public.g(uuid[])\ncreate view public.v as select public.h(1) as x;",
      ],
      {
        externalProviders: [
          {
            kind: "function",
            schema: "public",
            name: "g",
            signature: "(variadic pg_catalog.uuid[])",
          },
          {
            kind: "function",
            schema: "public",
            name: "h",
            signature:
              "(pg_catalog.int4,pg_catalog.int4,variadic pg_catalog.int4[])",
          },
        ],
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
