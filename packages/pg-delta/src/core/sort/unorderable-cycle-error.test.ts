import { describe, expect, test } from "bun:test";
import { createEmptyCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import { BaseChange } from "../objects/base.change.ts";
import { sortChanges } from "./sort-changes.ts";
import { UnorderableCycleError } from "./unorderable-cycle-error.ts";

class MutualCreateChange extends BaseChange {
  readonly operation = "create";
  readonly objectType = "table";
  readonly scope = "object";
  readonly table: { schema: string; name: string };
  private readonly dependsOn: string;

  constructor(name: string, dependsOn: string) {
    super();
    this.table = { schema: "public", name };
    this.dependsOn = dependsOn;
  }

  override get creates() {
    return [`table:public.${this.table.name}`];
  }

  override get requires() {
    return [`table:public.${this.dependsOn}`];
  }

  serialize(): string {
    return `CREATE TABLE public.${this.table.name} ()`;
  }
}

describe("UnorderableCycleError", () => {
  test("sortChanges throws a typed error carrying the offending cycle", async () => {
    const a = new MutualCreateChange("a", "b");
    const b = new MutualCreateChange("b", "a");
    const catalog = await createEmptyCatalog(170000, "postgres");

    let thrown: unknown;
    try {
      sortChanges({ mainCatalog: catalog, branchCatalog: catalog }, [
        a,
        b,
      ] as unknown as Change[]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnorderableCycleError);
    if (!(thrown instanceof UnorderableCycleError)) {
      throw new Error("expected UnorderableCycleError");
    }
    expect(thrown.name).toBe("UnorderableCycleError");
    expect(thrown.message).toContain("CycleError");
    expect(new Set(thrown.cycle)).toEqual(
      new Set<Change>([a, b] as unknown as Change[]),
    );
  });
});
