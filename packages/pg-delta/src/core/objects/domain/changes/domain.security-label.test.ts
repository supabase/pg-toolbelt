import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { Domain, type DomainProps } from "../domain.model.ts";
import {
  CreateSecurityLabelOnDomain,
  DropSecurityLabelOnDomain,
} from "./domain.security-label.ts";

const makeDomain = (): Domain =>
  new Domain({
    schema: "public",
    name: "email_t",
    base_type: "text",
    base_type_schema: "pg_catalog",
    not_null: false,
    type_modifier: -1,
    array_dimensions: 0,
    collation: null,
    default_bin: null,
    default_value: null,
    owner: "postgres",
    comment: null,
    constraints: [],
    privileges: [],
  } as DomainProps);

describe("domain.security-label", () => {
  test("create serializes", async () => {
    const domain = makeDomain();
    const change = new CreateSecurityLabelOnDomain({
      domain,
      securityLabel: { provider: "dummy", label: "classified" },
    });
    expect(change.scope).toBe("security_label");
    expect(change.creates).toEqual([
      stableId.securityLabel(domain.stableId, "dummy"),
    ]);
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON DOMAIN public.email_t IS 'classified'",
    );
  });

  test("drop serializes to IS NULL", async () => {
    const domain = makeDomain();
    const change = new DropSecurityLabelOnDomain({
      domain,
      securityLabel: { provider: "dummy", label: "x" },
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "SECURITY LABEL FOR dummy ON DOMAIN public.email_t IS NULL",
    );
  });
});
