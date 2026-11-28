import { expect, test } from "bun:test";
import { fixesFor } from "./fix.ts";

const sqlOf = (metadata: Record<string, unknown>) =>
  fixesFor("rls_policy_always_true", {
    schema: "public",
    name: "t",
    policy_name: "p",
    ...metadata,
  })[0]?.sql;

test("always-true policy fix keeps only the clauses the command allows", () => {
  expect(sqlOf({ command: "INSERT" })).toBe(
    "alter policy p on public.t with check (<condition>);",
  );
  expect(sqlOf({ command: "SELECT" })).toBe(
    "alter policy p on public.t using (<condition>);",
  );
  expect(sqlOf({ command: "DELETE" })).toBe(
    "alter policy p on public.t using (<condition>);",
  );
  for (const command of ["UPDATE", "ALL", undefined]) {
    expect(sqlOf({ command })).toBe(
      "alter policy p on public.t using (<condition>) with check (<condition>);",
    );
  }
});

test("reserved words and odd names are quoted", () => {
  expect(sqlOf({ name: "user", policy_name: "Order" })).toContain(
    'alter policy "Order" on public."user"',
  );
  expect(sqlOf({ name: "order" })).toContain('public."order"');
});
