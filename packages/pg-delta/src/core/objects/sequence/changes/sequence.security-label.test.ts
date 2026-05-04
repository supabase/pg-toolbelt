import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { Sequence, type SequenceProps } from "../sequence.model.ts";
import {
  CreateSecurityLabelOnSequence,
  DropSecurityLabelOnSequence,
} from "./sequence.security-label.ts";

const makeSequence = (): Sequence =>
  new Sequence({
    schema: "public",
    name: "s1",
    data_type: "bigint",
    start_value: 1,
    minimum_value: BigInt(1),
    maximum_value: BigInt("9223372036854775807"),
    increment: 1,
    cycle_option: false,
    cache_size: 1,
    persistence: "p",
    owned_by_schema: null,
    owned_by_table: null,
    owned_by_column: null,
    comment: null,
    privileges: [],
    owner: "postgres",
  } as SequenceProps);

describe("sequence.security-label", () => {
  test("create serializes", async () => {
    const sequence = makeSequence();
    const change = new CreateSecurityLabelOnSequence({
      sequence,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.scope).toBe("security_label");
    expect(change.creates).toEqual([
      stableId.securityLabel(sequence.stableId, "dummy"),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON SEQUENCE public.s1 IS 'classified'",
    );
  });

  test("drop serializes to IS NULL", async () => {
    const sequence = makeSequence();
    const change = new DropSecurityLabelOnSequence({
      sequence,
      securityLabel: { provider: "dummy", label: "x" },
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON SEQUENCE public.s1 IS NULL",
    );
  });
});
