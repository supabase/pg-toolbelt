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
      `${ambiguousDependency?.details?.candidateObjectKeys ?? ""}`,
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
    expect(`${unresolved?.details?.candidateObjectKeys ?? ""}`).toContain(
      "table:analytics:accounts",
    );
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
    const cycleStatements = `${cycleDiagnostic?.details?.cycleStatements ?? ""}`;
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
        `${d.details?.requiredObjectKey ?? ""}`.includes("timezone"),
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
        `${d.details?.requiredObjectKey ?? ""}`.includes("timezone"),
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
        `${d.details?.requiredObjectKey ?? ""}`.includes("function:public:max"),
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
        `${d.details?.requiredObjectKey ?? ""}`.includes("function:public:max"),
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
        `${d.details?.requiredObjectKey ?? ""}`.includes("json_build_object"),
    );
    expect(unresolvedWithout.length).toBeGreaterThan(0);

    const withProviders = await analyzeAndSort(sql, {
      externalProviders: [
        {
          kind: "function",
          schema: "public",
          name: "json_build_object",
          signature: "(any)",
        },
      ],
    });
    const unresolvedWith = withProviders.diagnostics.filter(
      (d) =>
        d.code === "UNRESOLVED_DEPENDENCY" &&
        `${d.details?.requiredObjectKey ?? ""}`.includes("json_build_object"),
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
        `${d.details?.requiredObjectKey ?? ""}`.includes(
          "function:extensions:uuid_generate_v4",
        ),
    );
    expect(unresolved.length).toBeGreaterThan(0);
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
        (String(diagnostic.details?.requiredObjectKey ?? "").includes(
          "initialise_auth_users_email",
        ) ||
          String(diagnostic.details?.requiredObjectKey ?? "").includes(
            "users_select_policy",
          )),
    );

    expect(unresolved.length).toBe(0);
  });
});
