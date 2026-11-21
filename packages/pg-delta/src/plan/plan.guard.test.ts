/**
 * Guardrail 3: PostgreSQL object-kind knowledge belongs in plan/rules/**.
 *
 * Planner-body modules still contain deliberate legacy FactKind literal
 * occurrences. This per-file count-proxy ratchet pins that footprint: adding
 * an occurrence fails here, while removing one requires lowering the
 * documented baseline in the same change.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import {
  createSourceFile,
  forEachChild,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type Node,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { ALL_FACT_KINDS } from "../core/stable-id.ts";

const PLAN_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FACT_KIND_SET = new Set<string>(ALL_FACT_KINDS);

function isPlannerBodyModuleFilename(name: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/.test(name) && !name.endsWith(".test.ts");
}

// Every production module outside plan/rules/** has an entry, including files
// with zero FactKind literal occurrences. Keep this table sorted by path.
const KIND_LITERAL_BASELINE: Readonly<Record<string, number>> = {
  "artifact.ts": 73,
  // Created lock-holding kinds that occupy a lock-table slot until COMMIT,
  // plus the toast-pair kinds counted at 3 slots. Used by splitPlan packing,
  // not per-object planning knowledge.
  "baseline-commit.ts": 10,
  "graph.ts": 0,
  "hazards.ts": 0,
  "identity-normalize.ts": 17,
  // 28 → 30: mergeCoTargetGrants (multi-grantee GRANT merge) discriminates acl
  // actions via the isAclId type guard — 2 deliberate literals (type + guard).
  // 30 → 29: the ADP gate's `desired.facts()` rescan became a prebuilt objtype
  // index (buildAdpIndex), dropping the redundant `Extract<StableId, { kind:
  // "defaultPrivilege" }>` cast — narrowing on the `!==` check suffices.
  // 29 → 37: overlay REVOKE elision + mergeCoTargetRevokes.
  // 37 → 38: the REVOKE-merge leader skips a column consume (identity-sequence
  // hygiene consumes the column, which is not a grant target).
  // 38 → 42: the co-create elisions count an identity sequence's acl as
  // co-created with its column (sequence target, column parent, table owner).
  // 42 → 41: both passes share isOwnerGrant (one role-edge narrowing).
  // 41 → 40: both passes share materializedObjects (one acl exclusion).
  // 40 → 34: the owner fold, the cleanup-REVOKE merge and the constraint fold
  // read the action's stamped subject and change instead of sniffing the kinds
  // in its produces / consumes.
  "internal.ts": 34,
  "locks.ts": 18,
  // 10 → 11: the extension-replace satellite replay guards on
  // `oldFact.id.kind === "extension"` so a plan with no extension replace
  // never builds the member-closure index — 1 deliberate literal (the closure
  // maps members to owning EXTENSIONS only, so the guard is behavior-neutral).
  // 11 → 15: overlay ADP wipe + emitCreate wipe-then-grant.
  // 15 → 14: overlay tuple match lives in policy.isOverlayDefaultPrivilege.
  // 14 → 16: default-privilege hygiene for an identity column's backing
  // sequence keys off the column fact and narrows the sequence id.
  // 16 → 18: the same hygiene for an in-place ADD IDENTITY.
  // 18 → 19: ADD IDENTITY replays the column's surviving sequence acl children.
  "phases/action-emitter.ts": 19,
  "phases/action-graph.ts": 1,
  // 0 → 43 (owner-envelope PoC): the authorization pass is ABOUT roles,
  // memberships and ACLs — it classifies subjects by those kinds
  // (role/membership/acl/schema, `defaultPrivilege` for FOR ROLE). Not a
  // per-object-kind special case.
  "phases/applier-authorization.ts": 38,
  "phases/change-set.ts": 4,
  "phases/replacement-expansion.ts": 0,
  // 7 → 8: the platform-provisioned assumed-schema-member scan discriminates
  // owner edges to role facts in the RAW extracts (`e.to.kind === "role"`) —
  // 1 deliberate literal, same shape as the dangling-owner auto-add loop.
  // 8 → 9: the source-witnessed role scan probes `source.has({ kind: "role",
  // name })` for each reference `roleReferencesOf` (rules/helpers.ts) returns —
  // 1 deliberate literal; the per-kind reference knowledge lives in the rules.
  // 9 → 10: the collision-scoped INTENT_UNSUPPORTED gate rebuilds the would-be
  // intent id from a diagnostic's context to probe the opposite side's fact
  // base, which needs the kind literal once (`unsupportedIntentId`). Not
  // object-kind KNOWLEDGE — extensionIntent has no rules here, and the error
  // rendering deliberately reads the context instead of re-narrowing the id so
  // the literal stays confined to that one constructor.
  // 10 → 11: overlay hygiene gates policy-only REVOKEs on
  // `rawSource.has({ kind: "role", name })` so alpine apply does not consume
  // assumed overlay roles the dest extract never had.
  "plan.ts": 11,
  // preamble.ts classifies actions into "routine-family or not" for the
  // cosmetic check_function_bodies compaction; the routine kinds themselves
  // come from core ROUTINE_KINDS, leaving only the two extension literals.
  "preamble.ts": 2,
  "project.ts": 0,
  "renames.ts": 0,
  "render-sql.ts": 0,
  "render.ts": 38,
  "rule-flags.ts": 0,
  "rules.ts": 1,
  "safety.ts": 30,
};

function listProductionModules(
  dir: string,
  skipDir: (path: string) => boolean = () => false,
): string[] {
  const modules: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!skipDir(path)) modules.push(...listProductionModules(path, skipDir));
      continue;
    }
    if (!isPlannerBodyModuleFilename(name)) continue;
    modules.push(path);
  }
  return modules.sort();
}

function listPlannerBodyModules(): string[] {
  return listProductionModules(
    PLAN_ROOT,
    (path) => relative(PLAN_ROOT, path).replaceAll("\\", "/") === "rules",
  );
}

function countFactKindLiterals(
  source: string,
  filename = "planner-body.ts",
): number {
  const sourceFile = createSourceFile(
    filename,
    source,
    ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ScriptKind.TSX : ScriptKind.TS,
  );
  let count = 0;

  function visit(node: Node): void {
    if (
      (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) &&
      FACT_KIND_SET.has(node.text)
    ) {
      count += 1;
    }

    forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

function currentKindLiteralCounts(): Record<string, number> {
  return Object.fromEntries(
    listPlannerBodyModules().map((path) => [
      relative(PLAN_ROOT, path).replaceAll("\\", "/"),
      countFactKindLiterals(readFileSync(path, "utf8"), path),
    ]),
  );
}

describe("planner body FactKind literal-count proxy ratchet", () => {
  test("recognizes production TypeScript module filenames", () => {
    for (const name of [
      "artifact.ts",
      "artifact.mts",
      "artifact.cts",
      "artifact.tsx",
      "artifact.test.mts",
      "artifact.test.cts",
      "artifact.test.tsx",
    ]) {
      expect(isPlannerBodyModuleFilename(name)).toBe(true);
    }
    for (const name of ["artifact.test.ts", "artifact.js", "artifact.sql"]) {
      expect(isPlannerBodyModuleFilename(name)).toBe(false);
    }
  });

  test("detects fact-kind literals but ignores comments and unrelated strings", () => {
    const source = `
      if (fact.id.kind === "table") return;
      switch (parent.kind) {
        case 'schema': return;
        case \`role\`: return;
      }
      // if (fact.id.kind === "policy") return;
      /* case "view": return; */
      throw new Error("not-a-kind");
    `;

    expect(countFactKindLiterals(source)).toBe(3);
  });

  test("does not mistake comment markers inside literals for comments", () => {
    const source = `
      const lineCommentText = "literal // text"; const laterKind = "policy";
      const blockCommentText = \`literal /* text \${"view"} */ text\`;
    `;

    expect(countFactKindLiterals(source)).toBe(2);
  });

  test("does not count fact-kind text inside regular expressions", () => {
    const source = String.raw`const pattern = /["table"]/;`;

    expect(countFactKindLiterals(source)).toBe(0);
  });

  test("counts literals after regular expressions inside template interpolations", () => {
    const source = 'const label = `${/}/.test(input) ? "table" : "view"}`;';

    expect(countFactKindLiterals(source)).toBe(2);
  });

  test("parses FactKind literals in TSX modules", () => {
    const source = 'const element = <Widget kind="table" />;';

    expect(countFactKindLiterals(source, "planner-body.tsx")).toBe(1);
  });

  test("does not grow outside plan/rules", () => {
    expect(currentKindLiteralCounts()).toEqual(KIND_LITERAL_BASELINE);
  });
});

/**
 * An action's `produces` / `consumes` / `destroys` are ordering edges. Their
 * first element used to double as "the object this statement is about", which
 * was wrong whenever an edge carried a side-effect id (an identity column's
 * backing sequence, the column a cleanup REVOKE waits for). That question is
 * answered by the stamped `Action.subject`; this keeps the old guess out.
 */
describe("action subject is read, never guessed", () => {
  const SRC_ROOT = join(PLAN_ROOT, "..");
  const POSITIONAL_EDGE_READ =
    /\b(?:produces|consumes|destroys)\s*(?:\?\.)?\[\s*\d+\s*\]/;

  test("no production module indexes an action's ordering edges", () => {
    const offenders = listProductionModules(SRC_ROOT).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          POSITIONAL_EDGE_READ.test(line) && !/^\s*(?:\/\/|\*|\/\*)/.test(line)
            ? [`${relative(SRC_ROOT, path)}:${index + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
