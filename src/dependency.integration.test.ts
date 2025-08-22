import { describe, expect, test } from "vitest";
import { Catalog } from "./catalog.model.ts";
import {
  DependencyModel,
  extractDependencyModel,
  resolveDependencies,
} from "./dependency.ts";
import {
  type Change,
  CreateChange,
  DropChange,
} from "./objects/base.change.ts";

class DummyCreate extends CreateChange {
  readonly stableId: string;
  constructor(stableId: string) {
    super();
    this.stableId = stableId;
  }
  serialize() {
    return `CREATE ${this.stableId}`;
  }
}

class DummyDrop extends DropChange {
  readonly stableId: string;
  constructor(stableId: string) {
    super();
    this.stableId = stableId;
  }
  serialize() {
    return `DROP ${this.stableId}`;
  }
}

function emptyCatalog(): Catalog {
  return new Catalog({
    collations: {},
    compositeTypes: {},
    domains: {},
    enums: {},
    extensions: {},
    procedures: {},
    indexes: {},
    materializedViews: {},
    rlsPolicies: {},
    roles: {},
    schemas: {},
    sequences: {},
    tables: {},
    triggers: {},
    types: {},
    views: {},
  });
}

describe.concurrent("dependency resolution integration", () => {
  test("resolves dependencies without SQL connections (fallback mode)", async () => {
    const cat = emptyCatalog();

    const changes: Change[] = [
      new DummyCreate("table:public.users"),
      new DummyCreate("view:public.user_list"),
    ];

    // Without SQL connections, should only use implicit schema dependencies
    const result = await resolveDependencies(changes, cat, cat);

    // Should maintain order since no explicit dependencies are extracted
    expect(result.length).toBe(2);
    expect((result[0] as DummyCreate).stableId).toBe("table:public.users");
    expect((result[1] as DummyCreate).stableId).toBe("view:public.user_list");
  });

  test("extract dependency model without SQL connections", async () => {
    const cat = emptyCatalog();

    const changes: Change[] = [
      new DummyCreate("table:public.users"),
      new DummyCreate("view:public.user_list"),
    ];

    // Extract dependency model (will use implicit dependencies only)
    const model = await extractDependencyModel(changes, cat, cat);

    // Should have schema dependencies
    const dependencies = model.getAllDependencies();
    expect(dependencies.length).toBeGreaterThan(0);

    // Should have table -> schema dependency
    expect(model.hasDependency("table:public.users", "schema:public")).toBe(
      true,
    );
    expect(model.hasDependency("view:public.user_list", "schema:public")).toBe(
      true,
    );
  });

  test("handles complex object hierarchies with schema dependencies", async () => {
    const cat = emptyCatalog();

    const changes: Change[] = [
      new DummyCreate("schema:app"),
      new DummyCreate("table:app.users"),
      new DummyCreate("view:app.active_users"),
      new DummyCreate("index:app.users_email_idx"),
      new DummyCreate("policy:app.users.user_policy"),
    ];

    const result = await resolveDependencies(changes, cat, cat);

    // Schema should come first
    expect((result[0] as DummyCreate).stableId).toBe("schema:app");

    // All other objects should depend on schema (implicitly)
    const positions = new Map<string, number>();
    result.forEach((change, index) => {
      positions.set((change as DummyCreate).stableId, index);
    });

    const schemaPos = positions.get("schema:app");
    const tablePos = positions.get("table:app.users");
    const viewPos = positions.get("view:app.active_users");
    const indexPos = positions.get("index:app.users_email_idx");
    const policyPos = positions.get("policy:app.users.user_policy");

    expect(schemaPos).toBe(0);
    expect(tablePos).toBeGreaterThan(schemaPos!);
    expect(viewPos).toBeGreaterThan(schemaPos!);
    expect(indexPos).toBeGreaterThan(schemaPos!);
    expect(policyPos).toBeGreaterThan(schemaPos!);
  });

  test("prioritizes explicit dependencies over implicit ones", async () => {
    const cat = emptyCatalog();
    const model = new DependencyModel();

    // Add explicit dependency: view depends on table
    model.addDependency(
      "view:public.user_list",
      "table:public.users",
      "branch",
    );

    const changes: Change[] = [
      new DummyCreate("view:public.user_list"), // dependent
      new DummyCreate("table:public.users"), // dependency
    ];

    const result = await resolveDependencies(changes, cat, cat, model);

    // Table should come before view due to explicit dependency
    expect((result[0] as DummyCreate).stableId).toBe("table:public.users");
    expect((result[1] as DummyCreate).stableId).toBe("view:public.user_list");
  });

  test("handles mixed explicit and implicit dependencies", async () => {
    const cat = emptyCatalog();
    const model = new DependencyModel();

    // Add explicit view -> table dependency
    model.addDependency("view:app.user_summary", "table:app.users", "branch");
    model.addDependency("view:app.user_summary", "table:app.orders", "branch");

    const changes: Change[] = [
      new DummyCreate("schema:app"),
      new DummyCreate("view:app.user_summary"), // depends on tables
      new DummyCreate("table:app.users"), // dependency
      new DummyCreate("table:app.orders"), // dependency
    ];

    const result = await resolveDependencies(changes, cat, cat, model);

    const positions = new Map<string, number>();
    result.forEach((change, index) => {
      positions.set((change as DummyCreate).stableId, index);
    });

    const schemaPos = positions.get("schema:app")!;
    const usersPos = positions.get("table:app.users")!;
    const ordersPos = positions.get("table:app.orders")!;
    const viewPos = positions.get("view:app.user_summary")!;

    // Schema should come first (implicit dependency)
    expect(schemaPos).toBe(0);

    // Tables should come before view (explicit dependencies)
    expect(usersPos).toBeLessThan(viewPos);
    expect(ordersPos).toBeLessThan(viewPos);

    // Tables should come after schema (implicit dependencies)
    expect(usersPos).toBeGreaterThan(schemaPos);
    expect(ordersPos).toBeGreaterThan(schemaPos);
  });

  test("handles DROP operations with dependencies", async () => {
    const cat = emptyCatalog();
    const model = new DependencyModel();

    // For DROP operations, use master catalog dependencies
    model.addDependency(
      "view:public.user_list",
      "table:public.users",
      "master",
    );

    const changes: Change[] = [
      new DummyDrop("table:public.users"), // dependency
      new DummyDrop("view:public.user_list"), // dependent
    ];

    const result = await resolveDependencies(changes, cat, cat, model);

    // View should be dropped before table (dependent before dependency)
    expect((result[0] as DummyDrop).stableId).toBe("view:public.user_list");
    expect((result[1] as DummyDrop).stableId).toBe("table:public.users");
  });

  test("demonstrates real-world schema migration scenario", async () => {
    const cat = emptyCatalog();
    const model = new DependencyModel();

    // Set up realistic dependencies
    model.addDependency(
      "view:public.user_stats",
      "table:public.users",
      "master",
    );
    model.addDependency(
      "view:public.user_stats",
      "table:public.orders",
      "master",
    );
    model.addDependency(
      "index:public.users_email_idx",
      "table:public.users",
      "branch",
    );
    model.addDependency(
      "policy:public.users.user_policy",
      "table:public.users",
      "branch",
    );

    const changes: Change[] = [
      // Drop old objects
      new DummyDrop("view:public.user_stats"),
      new DummyDrop("table:public.orders"),

      // Recreate with modifications
      new DummyCreate("table:public.orders"),
      new DummyCreate("view:public.user_stats"),

      // Add new objects
      new DummyCreate("index:public.users_email_idx"),
      new DummyCreate("policy:public.users.user_policy"),
    ];

    const result = await resolveDependencies(changes, cat, cat, model);

    // Verify the ordering makes sense for a schema migration
    const operations = result.map(
      (c) => `${c.kind.toUpperCase()} ${(c as any).stableId}`,
    );

    // Should drop view before table
    const dropViewIdx = operations.findIndex(
      (op) => op.includes("DROP") && op.includes("user_stats"),
    );
    const dropOrdersIdx = operations.findIndex(
      (op) => op.includes("DROP") && op.includes("orders"),
    );
    expect(dropViewIdx).toBeLessThan(dropOrdersIdx);

    // Should create table before view
    const createOrdersIdx = operations.findIndex(
      (op) => op.includes("CREATE") && op.includes("orders"),
    );
    const createViewIdx = operations.findIndex(
      (op) => op.includes("CREATE") && op.includes("user_stats"),
    );
    expect(createOrdersIdx).toBeLessThan(createViewIdx);

    // Should create table before index and policy
    const createIndexIdx = operations.findIndex(
      (op) => op.includes("CREATE") && op.includes("users_email_idx"),
    );
    const createPolicyIdx = operations.findIndex(
      (op) => op.includes("CREATE") && op.includes("user_policy"),
    );

    // Index and policy depend on users table (which exists), no direct ordering constraint with orders table
    // Just verify they are created (positions should be valid)
    expect(createIndexIdx).toBeGreaterThanOrEqual(0);
    expect(createPolicyIdx).toBeGreaterThanOrEqual(0);
  });
});
