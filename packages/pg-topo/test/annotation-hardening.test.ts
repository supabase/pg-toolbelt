import { describe, expect, test } from "bun:test";
import { parseAnnotations } from "../src/annotations/parse-annotations";

describe("annotation hardening", () => {
  test("parses only leading pg-topo comments for a statement", () => {
    const sql = `
-- pg-topo:requires table:public.users
create function public.fn_a()
returns int
language plpgsql
as $$
begin
  -- pg-topo:requires table:public.secret
  return 1;
end;
$$;
`;
    const result = parseAnnotations(sql);
    const requires = result.annotations.requires.map(
      (ref) => `${ref.kind}:${ref.schema ?? ""}.${ref.name}`,
    );

    expect(requires).toEqual(["table:public.users"]);
  });

  test("reports duplicate phase directives as invalid", () => {
    const sql = `
-- pg-topo:phase bootstrap
-- pg-topo:phase privileges
create schema app;
`;
    const result = parseAnnotations(sql);
    const invalidMessages = result.diagnostics.map(
      (diagnostic) => diagnostic.message,
    );

    expect(
      invalidMessages.some((message) => message.includes("Duplicate phase")),
    ).toBe(true);
  });

  test("reports conflicting requires/provides annotation for same object", () => {
    const sql = `
-- pg-topo:requires table:public.users
-- pg-topo:provides table:public.users
create view public.user_ids as select id from public.users;
`;
    const result = parseAnnotations(sql);
    const invalidMessages = result.diagnostics.map(
      (diagnostic) => diagnostic.message,
    );

    expect(
      invalidMessages.some((message) =>
        message.includes("cannot be both requires and provides"),
      ),
    ).toBe(true);
  });

  test("supports quoted identifiers in annotation references", () => {
    const sql = `
-- pg-topo:requires table:"App"."Users"
select 1;
`;
    const result = parseAnnotations(sql);
    const first = result.annotations.requires[0];

    expect(first?.schema).toBe("App");
    expect(first?.name).toBe("Users");
  });

  // Guards indexOfCharOutsideQuotesAndParens: we must check for the target char
  // (e.g. "(") before updating paren depth, so that when targetChar is "(" we
  // return its index at depth 0 instead of consuming it and never finding the signature.
  test("parses requires/provides with function signature (finds first paren at depth 0)", () => {
    const sql = `
-- pg-topo:requires function:app.do_work(int,uuid)
create function app.caller() returns void language sql as $$ select null $$;
`;
    const result = parseAnnotations(sql);
    const ref = result.annotations.requires[0];

    expect(ref?.kind).toBe("function");
    expect(ref?.schema).toBe("app");
    expect(ref?.name).toBe("do_work");
    expect(ref?.signature).toBe("(int,uuid)");
    expect(result.diagnostics).toHaveLength(0);
  });

  test("reports invalid phase value with suggested fix", () => {
    const sql = `
-- pg-topo:phase invalid_phase
create schema app;
`;
    const result = parseAnnotations(sql);
    const invalid = result.diagnostics.find((d) =>
      d.message.includes("Invalid phase annotation"),
    );
    expect(invalid).toBeDefined();
    expect(invalid?.suggestedFix).toContain("bootstrap");
  });

  test("parses valid depends_on with schema-qualified table names", () => {
    const sql = `
-- pg-topo:depends_on public.t1, app.t2
create table public.t(id int);
`;
    const result = parseAnnotations(sql);
    expect(result.annotations.dependsOn).toHaveLength(2);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("reports unknown annotation directive", () => {
    const sql = `
-- pg-topo:unknown_directive value
create schema app;
`;
    const result = parseAnnotations(sql);
    const invalid = result.diagnostics.find((d) =>
      d.message.includes("Unknown annotation directive"),
    );
    expect(invalid).toBeDefined();
  });

  test("reports invalid requires when object kind is unknown", () => {
    const sql = `
-- pg-topo:requires unknownkind:public.t
select 1;
`;
    const result = parseAnnotations(sql);
    const invalid = result.diagnostics.find(
      (d) =>
        d.message.includes("Unknown object kind") ||
        d.message.includes("Invalid requires"),
    );
    expect(invalid).toBeDefined();
  });

  test("reports invalid requires when kind:value has no colon or missing object name", () => {
    const sql = `
-- pg-topo:requires table
select 1;
`;
    const result = parseAnnotations(sql);
    const invalid = result.diagnostics.find(
      (d) =>
        d.code === "INVALID_ANNOTATION" &&
        (d.message.includes("Expected") || d.message.includes("Invalid")),
    );
    expect(invalid).toBeDefined();
  });
});
