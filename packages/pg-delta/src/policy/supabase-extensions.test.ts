/**
 * supabase/cli#5555: a declarative sync must not drop platform-managed
 * extensions (the reported `DROP EXTENSION pg_graphql`). Image-provisioned
 * ones (`pg_graphql`, …) stay REFERENCE-ONLY — present so members resolve,
 * never a create/drop delta. `pgsodium` / `wrappers` hard-prune. User
 * extensions (pg_trgm, …) stay fully managed. Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const ext = (name: string, schema: string): Fact => ({
  id: { kind: "extension", name },
  payload: { schema, _relocatable: false },
});
const pgGraphql: StableId = { kind: "extension", name: "pg_graphql" };
const pgTrgm: StableId = { kind: "extension", name: "pg_trgm" };
const wrappers: StableId = { kind: "extension", name: "wrappers" };

describe("supabase policy — platform extensions", () => {
  test("keeps pg_graphql reference-only and a user extension managed", () => {
    const fb = buildFactBase(
      [ext("pg_graphql", "graphql"), ext("pg_trgm", "extensions")],
      [],
    );
    const view = resolveView(fb, supabasePolicy);
    // platform-provisioned → reference-only → never dropped (the #5555 fix)
    expect(view.get(pgGraphql)).toBeDefined();
    expect(view.isReferenceOnly(pgGraphql)).toBe(true);
    // user-declarable → still managed
    expect(view.get(pgTrgm)).toBeDefined();
    expect(view.isReferenceOnly(pgTrgm)).toBe(false);
  });

  test("projects out the wrappers extension (dashboard-installed, CLI-1470)", () => {
    // `wrappers` is installed by the dashboard when the user enables a wrapper
    // integration, so it is never declared in user schema files. Keeping it
    // managed would plan `DROP EXTENSION "wrappers"` on every diff against a
    // project with an integration enabled — and with the wrappers-provisioned
    // FDWs projected out (Rule 6c), that drop is not even appliable: the
    // suppressed FDW's handler/validator dependencies block a bare DROP
    // EXTENSION (PR #401 review, P1).
    const fb = buildFactBase([ext("wrappers", "extensions")], []);
    const view = resolveView(fb, supabasePolicy);
    expect(view.get(wrappers)).toBeUndefined();
  });
});
