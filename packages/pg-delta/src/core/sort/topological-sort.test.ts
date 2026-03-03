import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import {
  findCycle,
  formatCycleError,
  performStableTopologicalSort,
} from "./topological-sort.ts";
import type { Constraint } from "./types.ts";

function mockChange(name: string, creates: string[] = []): Change {
  const change = {
    objectType: "table",
    operation: "create" as const,
    scope: "object",
    creates,
    drops: [],
    requires: [],
    serialize: () => "",
  };
  Object.defineProperty(change, "constructor", { value: { name } });
  return change as unknown as Change;
}

describe("performStableTopologicalSort", () => {
  test("no edges returns identity order", () => {
    const result = performStableTopologicalSort(3, []);
    expect(result).toEqual([0, 1, 2]);
  });

  test("linear chain produces correct order", () => {
    const result = performStableTopologicalSort(3, [
      [0, 1],
      [1, 2],
    ]);
    expect(result).toEqual([0, 1, 2]);
  });

  test("reversed linear chain reorders correctly", () => {
    const result = performStableTopologicalSort(3, [
      [2, 1],
      [1, 0],
    ]);
    expect(result).toEqual([2, 1, 0]);
  });

  test("diamond dependency resolves correctly", () => {
    const result = performStableTopologicalSort(4, [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  test("cycle returns null", () => {
    const result = performStableTopologicalSort(2, [
      [0, 1],
      [1, 0],
    ]);
    expect(result).toBeNull();
  });

  test("stable ordering among unconstrained nodes", () => {
    const result = performStableTopologicalSort(5, [[3, 4]]);
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  test("duplicate edges are handled", () => {
    const result = performStableTopologicalSort(2, [
      [0, 1],
      [0, 1],
    ]);
    expect(result).toEqual([0, 1]);
  });

  test("single node returns identity", () => {
    const result = performStableTopologicalSort(1, []);
    expect(result).toEqual([0]);
  });
});

describe("findCycle", () => {
  test("no edges means no cycle", () => {
    expect(findCycle(3, [])).toBeNull();
  });

  test("linear chain has no cycle", () => {
    expect(
      findCycle(3, [
        [0, 1],
        [1, 2],
      ]),
    ).toBeNull();
  });

  test("simple cycle is detected", () => {
    const cycle = findCycle(2, [
      [0, 1],
      [1, 0],
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle?.length).toBeGreaterThanOrEqual(2);
  });

  test("three-node cycle is detected", () => {
    const cycle = findCycle(3, [
      [0, 1],
      [1, 2],
      [2, 0],
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle?.length).toBe(3);
  });

  test("self-loop is detected", () => {
    const cycle = findCycle(1, [[0, 0]]);
    expect(cycle).not.toBeNull();
  });

  test("cycle in subgraph is found", () => {
    const cycle = findCycle(4, [
      [0, 1],
      [2, 3],
      [3, 2],
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain(2);
    expect(cycle).toContain(3);
  });
});

describe("formatCycleError", () => {
  test("basic format without cycleEdges", () => {
    const changes = [
      mockChange("CreateTable", ["table:public.a"]),
      mockChange("CreateTable", ["table:public.b"]),
    ];

    const message = formatCycleError([0, 1], changes);
    expect(message).toContain("CycleError");
    expect(message).toContain("2 changes");
    expect(message).toContain("CreateTable");
    expect(message).toContain("table:public.a");
    expect(message).toContain("table:public.b");
    expect(message).toContain("circular dependency");
    expect(message).not.toContain("Cycle path");
  });

  test("catalog source with dependentStableId", () => {
    const changes = [
      mockChange("CreateTable", ["table:public.a"]),
      mockChange("CreateView", ["view:public.v"]),
    ];

    const constraint: Constraint = {
      sourceChangeIndex: 0,
      targetChangeIndex: 1,
      source: "catalog",
      reason: {
        dependentStableId: "view:public.v",
        referencedStableId: "table:public.a",
      },
    };

    const message = formatCycleError([0, 1], changes, [
      { sourceIndex: 0, targetIndex: 1, constraint },
    ]);
    expect(message).toContain("Cycle path");
    expect(message).toContain("source: catalog");
    expect(message).toContain("Dependency: view:public.v → table:public.a");
    expect(message).toContain("Cycle-breaking filter did not match");
    expect(message).toContain("cycle-breaking filters were unable");
  });

  test("explicit source without dependentStableId", () => {
    const changes = [
      mockChange("CreateTable"),
      mockChange("CreateView", ["view:public.v"]),
    ];

    const constraint: Constraint = {
      sourceChangeIndex: 0,
      targetChangeIndex: 1,
      source: "explicit",
      reason: {
        referencedStableId: "table:public.a",
      },
    };

    const message = formatCycleError([0, 1], changes, [
      { sourceIndex: 0, targetIndex: 1, constraint },
    ]);
    expect(message).toContain("source: explicit");
    expect(message).toContain("Requires: table:public.a");
    expect(message).toContain(
      "Explicit requirement without created IDs (not filtered)",
    );
  });

  test("custom source constraint", () => {
    const changes = [
      mockChange("CreateTable", ["table:public.a"]),
      mockChange("CreateTable", ["table:public.b"]),
    ];

    const constraint: Constraint = {
      sourceChangeIndex: 0,
      targetChangeIndex: 1,
      source: "custom",
    };

    const message = formatCycleError([0, 1], changes, [
      { sourceIndex: 0, targetIndex: 1, constraint },
    ]);
    expect(message).toContain("source: custom");
    expect(message).toContain("Custom constraint (never filtered)");
  });

  test("edge not found in cycleEdges", () => {
    const changes = [
      mockChange("CreateTable", ["table:public.a"]),
      mockChange("CreateTable", ["table:public.b"]),
      mockChange("CreateView", ["view:public.v"]),
    ];

    const unrelatedConstraint: Constraint = {
      sourceChangeIndex: 2,
      targetChangeIndex: 0,
      source: "custom",
    };

    const message = formatCycleError([0, 1], changes, [
      { sourceIndex: 2, targetIndex: 0, constraint: unrelatedConstraint },
    ]);
    expect(message).toContain("(edge not found)");
  });

  test("explicit source with dependentStableId uses filter message", () => {
    const changes = [
      mockChange("CreateTable", ["table:public.a"]),
      mockChange("CreateView", ["view:public.v"]),
    ];

    const constraint: Constraint = {
      sourceChangeIndex: 0,
      targetChangeIndex: 1,
      source: "explicit",
      reason: {
        dependentStableId: "view:public.v",
        referencedStableId: "table:public.a",
      },
    };

    const message = formatCycleError([0, 1], changes, [
      { sourceIndex: 0, targetIndex: 1, constraint },
    ]);
    expect(message).toContain("Dependency: view:public.v → table:public.a");
    expect(message).toContain("Cycle-breaking filter did not match");
  });

  test("change with many creates truncates", () => {
    const changes = [
      mockChange("CreateTable", [
        "table:public.a",
        "table:public.b",
        "table:public.c",
      ]),
    ];

    const message = formatCycleError([0], changes);
    expect(message).toContain("table:public.a, table:public.b...");
    expect(message).not.toContain("table:public.c");
  });
});
