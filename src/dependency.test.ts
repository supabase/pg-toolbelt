import { CycleError } from "graph-data-structure";
import { describe, expect, test } from "vitest";
import { Catalog, emptyCatalog } from "./catalog.model.ts";
import type { PgDepend } from "./depend.ts";
import { DependencyResolver } from "./dependency.ts";
import {
  AlterChange,
  CreateChange,
  DropChange,
} from "./objects/base.change.ts";

describe("DependencyResolver", () => {
  // Helper classes for testing
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

  class DummyAlter extends AlterChange {
    readonly stableId: string;
    constructor(stableId: string) {
      super();
      this.stableId = stableId;
    }
    serialize() {
      return `ALTER ${this.stableId}`;
    }
  }

  // Helper to create a catalog with dependencies
  function createCatalogWithDependencies(dependencies: PgDepend[]): Catalog {
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
      depends: dependencies,
    });
  }

  describe.concurrent("dependency resolution coverage", () => {
    test("empty changes list", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);
      const result = resolver.resolveDependencies([])._unsafeUnwrap();

      // Should return empty list without errors
      expect(result).toEqual([]);
    });

    test("cross-catalog dependencies", () => {
      // Create master catalog with a view
      const masterCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.table1",
          deptype: "n",
        },
      ]);

      // Create branch catalog (empty)
      const branchCatalog = emptyCatalog();

      const resolver = new DependencyResolver(masterCatalog, branchCatalog);

      // Create changes that involve cross-catalog checks
      const changes = [
        new DummyDrop("view:test.view1"),
        new DummyCreate("view:test.view2"),
      ];

      // Test with actual DependencyResolver method
      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should return changes in the correct order
      expect(result.length).toBe(2);
      // The view2 should be created first, then the view1 should be dropped
      expect(result[0]).toEqual(
        expect.objectContaining({
          stableId: "view:test.view2",
          kind: "create",
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          stableId: "view:test.view1",
          kind: "drop",
        }),
      );
    });

    test("mixed operation dependencies", () => {
      // Create catalogs with dependencies
      const masterCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.view1",
          referenced_stable_id: "table:test.table1",
          deptype: "n",
        },
      ]);

      const branchCatalog = emptyCatalog();
      const resolver = new DependencyResolver(masterCatalog, branchCatalog);

      // Create mixed operations
      const changes = [
        new DummyDrop("view:test.view1"),
        new DummyAlter("table:test.table1"),
        new DummyCreate("view:test.view2"),
      ];

      // Test with actual DependencyResolver method
      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Should return all changes
      expect(result.length).toBe(3);
    });

    test("dependency constraints with view depending on table", () => {
      // Create catalog with view depending on table
      const masterCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(masterCatalog, branchCatalog);

      // Create changes where order matters due to dependencies
      const changes = [
        new DummyCreate("view:test.user_view"), // Should come after table
        new DummyCreate("table:test.users"), // Should come first
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify dependency-based ordering
      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");

      // Table should come before view due to dependency
      expect(tableIndex).toBeLessThan(viewIndex);
    });

    test("drop operations with dependencies", () => {
      // Create catalog with view depending on table
      const masterCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
      ]);

      const branchCatalog = emptyCatalog();
      const resolver = new DependencyResolver(masterCatalog, branchCatalog);

      // Create drop changes where order matters
      const changes = [
        new DummyDrop("table:test.users"), // Should come after view drop
        new DummyDrop("view:test.user_view"), // Should come first
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify dependency-based ordering for drops
      expect(result.length).toBe(2);
      const stableIds = result.map((change) => change.stableId);
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");

      // View should be dropped before table due to dependency
      expect(viewIndex).toBeLessThan(tableIndex);
    });

    test("operation priority for different objects", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create multiple operations on different objects to test operation priority
      const changes = [
        new DummyAlter("table:test.users"), // Alter operation
        new DummyCreate("table:test.posts"), // Create operation
        new DummyDrop("table:test.comments"), // Drop operation
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify all operations are preserved
      expect(result.length).toBe(3);

      // Operations should be preserved (order may vary due to dependencies)
      const operations = result.map((change) => change.kind);
      expect(operations).toContain("drop");
      expect(operations).toContain("create");
      expect(operations).toContain("alter");
    });

    test("cycle error from conflicting same object operations", () => {
      const testCatalog = emptyCatalog();
      const resolver = new DependencyResolver(testCatalog, testCatalog);

      // Create conflicting operations on the same object that should cause a cycle
      // DROP and CREATE on the same object can create logical conflicts in the constraint graph
      const changes = [
        new DummyDrop("table:test.users"),
        new DummyCreate("table:test.users"), // This creates a logical cycle with the drop
        new DummyAlter("table:test.users"), // This also conflicts
      ];

      const result = resolver.resolveDependencies(changes);

      // Should return a CycleError due to the conflicting operations
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error instanceof CycleError).toBe(true);
        expect(result.error.message).toBe("Cycle found");
      }
    });

    test("complex dependency chain", () => {
      // Create a complex dependency chain: schema -> table -> view -> materialized view
      const masterCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "materialized_view:test.user_summary",
          referenced_stable_id: "view:test.user_view",
          deptype: "n",
        },
      ]);

      const branchCatalog = createCatalogWithDependencies([
        {
          dependent_stable_id: "table:test.users",
          referenced_stable_id: "schema:test",
          deptype: "n",
        },
        {
          dependent_stable_id: "view:test.user_view",
          referenced_stable_id: "table:test.users",
          deptype: "n",
        },
        {
          dependent_stable_id: "materialized_view:test.user_summary",
          referenced_stable_id: "view:test.user_view",
          deptype: "n",
        },
      ]);

      const resolver = new DependencyResolver(masterCatalog, branchCatalog);

      // Create changes in reverse dependency order
      const changes = [
        new DummyCreate("materialized_view:test.user_summary"),
        new DummyCreate("view:test.user_view"),
        new DummyCreate("table:test.users"),
        new DummyCreate("schema:test"),
      ];

      const result = resolver.resolveDependencies(changes)._unsafeUnwrap();

      // Verify correct dependency ordering
      expect(result.length).toBe(4);
      const stableIds = result.map((change) => change.stableId);

      const schemaIndex = stableIds.indexOf("schema:test");
      const tableIndex = stableIds.indexOf("table:test.users");
      const viewIndex = stableIds.indexOf("view:test.user_view");
      const matViewIndex = stableIds.indexOf(
        "materialized_view:test.user_summary",
      );

      // Verify proper ordering based on dependencies
      expect(schemaIndex).toBeLessThan(tableIndex);
      expect(tableIndex).toBeLessThan(viewIndex);
      expect(viewIndex).toBeLessThan(matViewIndex);
    });
  });
});
