import { afterAll, describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { createTempFixtureHarness } from "./support/temp-fixture";

const fixtures = createTempFixtureHarness("pg-topo-diagnostics-");
const createSqlFixture = fixtures.createSqlFixture;

afterAll(fixtures.cleanup);

describe("diagnostics", () => {
  test("reports duplicate producers with candidate details", async () => {
    const root = await createSqlFixture({
      "00_schema.sql": "create schema app;",
      "01_users_v1.sql": "create table app.users(id int primary key);",
      "02_users_v2.sql":
        "create table app.users(id int primary key, email text not null);",
      "03_view.sql": "create view app.user_ids as select id from app.users;",
    });

    const result = await analyzeAndSort({ roots: [root] });
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
    const root = await createSqlFixture({
      "00_schema.sql": "create schema analytics;",
      "01_table.sql": "create table analytics.accounts(id int primary key);",
      "02_view.sql":
        "create view public.account_ids as select id from public.accounts;",
    });

    const result = await analyzeAndSort({ roots: [root] });
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
    const root = await createSqlFixture({
      "00_v1.sql": "create view public.v1 as select * from public.v2;",
      "01_v2.sql": "create view public.v2 as select * from public.v1;",
    });

    const result = await analyzeAndSort({ roots: [root] });
    const cycleDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
    );

    expect(cycleDiagnostic).toBeDefined();
    expect(cycleDiagnostic?.details?.cycleStatements).toBeDefined();
    expect(`${cycleDiagnostic?.details?.cycleStatements ?? ""}`).toContain(
      "00_v1.sql",
    );
    expect(`${cycleDiagnostic?.details?.cycleStatements ?? ""}`).toContain(
      "01_v2.sql",
    );
  });
});
