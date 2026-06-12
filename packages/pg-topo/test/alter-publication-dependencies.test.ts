import { describe, expect, test } from "bun:test";
import { analyzeAndSort } from "../src/analyze-and-sort";
import { objectRefKey } from "../src/model/object-ref";

const requiredObjectKeys = (
  result: Awaited<ReturnType<typeof analyzeAndSort>>,
): string[] =>
  result.graph.edges
    .flatMap((edge) => {
      if (
        (edge.reason === "requires" || edge.reason === "requires_compatible") &&
        edge.objectRef
      ) {
        return [objectRefKey(edge.objectRef)];
      }
      return [];
    })
    .sort();

describe("ALTER PUBLICATION dependencies", () => {
  test("orders ALTER PUBLICATION multi-table dependencies from real SQL", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders add table public.orders, public.events;",
      "create table public.events(id int primary key);",
      "create publication pub_orders;",
      "create table public.orders(id int primary key);",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const alterPublicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("alter publication pub_orders"),
    );

    expect(alterPublicationIndex).toBeGreaterThanOrEqual(0);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create publication")),
    ).toBeLessThan(alterPublicationIndex);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create table public.events")),
    ).toBeLessThan(alterPublicationIndex);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create table public.orders")),
    ).toBeLessThan(alterPublicationIndex);
    expect(requiredObjectKeys(result)).toEqual([
      "publication::pub_orders:",
      "table:public:events:",
      "table:public:orders:",
    ]);
  });

  test("orders ALTER PUBLICATION multi-schema dependencies from real SQL", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_sales set tables in schema sales, marketing;",
      "create schema marketing;",
      "create publication pub_sales;",
      "create schema sales;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const alterPublicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("alter publication pub_sales"),
    );

    expect(alterPublicationIndex).toBeGreaterThanOrEqual(0);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create publication")),
    ).toBeLessThan(alterPublicationIndex);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create schema marketing")),
    ).toBeLessThan(alterPublicationIndex);
    expect(
      orderedSql.findIndex((sql) => sql.includes("create schema sales")),
    ).toBeLessThan(alterPublicationIndex);
    expect(requiredObjectKeys(result)).toEqual([
      "publication::pub_sales:",
      "schema::marketing:",
      "schema::sales:",
    ]);
  });

  test("orders ALTER PUBLICATION row filter after referenced function", async () => {
    const result = await analyzeAndSort([
      "alter publication pub_orders add table public.orders where (public.is_visible(id));",
      "create table public.orders(id int primary key);",
      "create publication pub_orders;",
      "create function public.is_visible(order_id int) returns boolean language sql immutable as $$ select true $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.is_visible"),
    );
    const alterPublicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("alter publication pub_orders add table"),
    );

    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(alterPublicationIndex).toBeGreaterThanOrEqual(0);
    expect(functionIndex).toBeLessThan(alterPublicationIndex);
    expect(
      result.graph.edges.some(
        (edge) =>
          edge.objectRef?.kind === "function" &&
          edge.objectRef.schema === "public" &&
          edge.objectRef.name === "is_visible",
      ),
    ).toBe(true);
  });

  test("orders CREATE PUBLICATION row filter after referenced function", async () => {
    const result = await analyzeAndSort([
      "create publication pub_orders for table public.orders where (public.is_visible(id));",
      "create table public.orders(id int primary key);",
      "create function public.is_visible(order_id int) returns boolean language sql immutable as $$ select true $$;",
    ]);
    const orderedSql = result.ordered.map((statement) =>
      statement.sql.toLowerCase(),
    );
    const functionIndex = orderedSql.findIndex((sql) =>
      sql.includes("create function public.is_visible"),
    );
    const createPublicationIndex = orderedSql.findIndex((sql) =>
      sql.includes("create publication pub_orders"),
    );

    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(createPublicationIndex).toBeGreaterThanOrEqual(0);
    expect(functionIndex).toBeLessThan(createPublicationIndex);
    expect(requiredObjectKeys(result)).toEqual([
      "function:public:is_visible:(unknown)",
      "table:public:orders:",
    ]);
  });

  test("orders CREATE PUBLICATION tables in schema after referenced schemas", async () => {
    const result = await analyzeAndSort([
      "create publication pub_sales for tables in schema sales, marketing;",
      "create schema marketing;",
      "create schema sales;",
    ]);
    const orderedClasses = result.ordered.map(
      (statement) => statement.statementClass,
    );

    expect(orderedClasses).toEqual([
      "CREATE_SCHEMA",
      "CREATE_SCHEMA",
      "CREATE_PUBLICATION",
    ]);
    expect(requiredObjectKeys(result)).toEqual([
      "schema::marketing:",
      "schema::sales:",
    ]);
  });
});
