import { describe, expect, test } from "bun:test";
import { BasePgModel } from "./base.model.ts";

class NormalizedTestModel extends BasePgModel {
  constructor(
    private readonly id: string,
    private readonly values: string[],
  ) {
    super();
  }

  get stableId() {
    return this.id;
  }

  get identityFields() {
    return { id: this.id };
  }

  get dataFields() {
    return { values: this.values };
  }

  override stableSnapshot() {
    return {
      identity: this.identityFields,
      data: {
        values: [...this.values].sort(),
      },
    };
  }
}

describe("BasePgModel.equals", () => {
  test("uses stable snapshots for normalized equality", () => {
    const main = new NormalizedTestModel("same", ["b", "a"]);
    const branch = new NormalizedTestModel("same", ["a", "b"]);

    expect(main.equals(branch)).toBe(true);
  });
});
