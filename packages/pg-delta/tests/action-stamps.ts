/**
 * Checks every action's stamped `subject` / `change` against the two fact
 * bases, the deltas and its own SQL. The emitter writes the stamps by hand at
 * each call site and nothing downstream re-derives them, so a wrong stamp
 * would otherwise be trusted silently. Run on every corpus plan.
 */
import type { FactBase } from "../src/core/fact.ts";
import { encodeId, type StableId } from "../src/core/stable-id.ts";
import { relabelRoleNames } from "../src/plan/identity-normalize.ts";
import { buildRuleResolver } from "../src/plan/rules.ts";
import type { Action, Plan } from "../src/plan/plan.ts";
import { lit, qid } from "../src/plan/render.ts";

/** Every name the id carries that a statement about it must spell out. The
 *  schema is left out: `search_path`-relative definitions omit it. */
function namesOf(id: StableId): string[] {
  switch (id.kind) {
    case "comment":
    case "securityLabel":
      return namesOf(id.target);
    case "acl":
      return [
        ...namesOf(id.target),
        id.grantee,
        ...(id.column !== undefined ? [id.column] : []),
      ];
    case "membership":
      return [id.role, id.member];
    case "userMapping":
      return [id.server, id.role];
    case "typeAttribute":
      return [id.type, id.name];
    case "publicationRel":
      return [id.publication, id.table];
    case "publicationSchema":
      return [id.publication, id.schema];
    case "defaultPrivilege":
      return [id.grantee];
    case "extensionIntent":
      return [id.key];
    default:
      return "table" in id ? [id.table, id.name] : [id.name];
  }
}

/** An enum whose value set shrinks is rebuilt: the old type is moved aside
 *  under a temporary name carrying this marker (truncated or numbered when it
 *  would collide), and the statements that follow name it that way. */
const REPLACED_MARKER = "__pgdelta_replaced";

function mentions(sql: string, name: string): boolean {
  if (sql.includes(qid(name)) || sql.includes(lit(name))) return true;
  // unquoted, as PostgreSQL's own deparsers (pg_get_functiondef, …) print it
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(sql);
}

const rulesForId = buildRuleResolver();

const has = (ids: readonly StableId[], id: StableId): boolean =>
  ids.some((other) => encodeId(other) === encodeId(id));

interface PlanContext {
  source: FactBase;
  desired: FactBase;
  inSource: (id: StableId) => boolean;
  /** encoded id + attribute of every `set` delta */
  setDeltas: Set<string>;
  /** rename actions by encoded subject */
  renameOf: Map<string, Action>;
}

function planContext(
  thePlan: Plan,
  source: FactBase,
  desired: FactBase,
): PlanContext {
  // After an accepted role rename every id that embeds the role is written
  // with the NEW name, the one its statement uses. The source state still
  // spells it the old way.
  const oldRoleNames = new Map(
    (thePlan.acceptedRenames ?? []).flatMap(({ from, to }) =>
      from.kind === "role" && to.kind === "role"
        ? [[to.name, from.name] as const]
        : [],
    ),
  );
  return {
    source,
    desired,
    inSource: (id) =>
      source.has(id) || source.has(relabelRoleNames(id, oldRoleNames)),
    setDeltas: new Set(
      thePlan.deltas.flatMap((d) =>
        d.verb === "set" ? [`${encodeId(d.id)}\x00${d.attr}`] : [],
      ),
    ),
    renameOf: new Map(
      thePlan.actions.flatMap((a) =>
        a.change?.kind === "rename" ? [[encodeId(a.subject), a] as const] : [],
      ),
    ),
  };
}

function stampViolations(action: Action, ctx: PlanContext): string[] {
  const out: string[] = [];
  const { subject } = action;
  const { source, desired, inSource } = ctx;
  const expect = (ok: boolean, what: string): void => {
    if (!ok) out.push(what);
  };

  const namesRebuiltEnum =
    subject.kind === "type" && action.sql.includes(REPLACED_MARKER);
  // an identity change can address the column's backing sequence alone
  const namesIdentitySequence =
    action.change?.kind === "attribute" &&
    action.change.name === "identity" &&
    action.sql.startsWith("ALTER SEQUENCE");
  for (const name of namesRebuiltEnum || namesIdentitySequence
    ? []
    : namesOf(subject)) {
    expect(mentions(action.sql, name), `statement does not mention "${name}"`);
  }
  expect(
    (action.verb === "alter") === (action.change !== undefined),
    "an alter must carry a change, a create or drop must not",
  );

  if (action.verb === "create") {
    // the target of the plan: the desired state, plus what a policy keeps
    // from the source and the plan has to put back after a wipe
    expect(
      desired.has(subject) || inSource(subject),
      "created subject is in neither state",
    );
    // the leading statement of a create produces its subject; a follow-up
    // produces nothing
    if (action.produces.length > 0) {
      expect(has(action.produces, subject), "leader does not produce subject");
    }
  } else if (action.verb === "drop") {
    expect(inSource(subject), "dropped subject is not in the source state");
    expect(has(action.destroys, subject), "drop does not destroy its subject");
  } else {
    const { change } = action;
    switch (change.kind) {
      case "attribute": {
        // an attribute its kind renders in a statement of its own
        // (`ownStatement`) also accompanies its fact's create or drop
        const created = !inSource(subject) && desired.has(subject);
        const dropped = inSource(subject) && !desired.has(subject);
        const side = created ? desired : dropped ? source : undefined;
        const rule =
          side?.get(subject)?.payload[change.name] !== undefined &&
          subject.kind !== "extensionIntent"
            ? rulesForId(subject).attributes[change.name]
            : undefined;
        if (rule !== undefined && rule !== "replace" && rule.ownStatement) {
          break;
        }
        expect(
          inSource(subject) && desired.has(subject),
          "altered subject must exist in both states",
        );
        expect(
          ctx.setDeltas.has(`${encodeId(subject)}\x00${change.name}`),
          `no set delta for attribute "${change.name}"`,
        );
        break;
      }
      case "owner":
        expect(
          desired
            .outgoingEdges(subject)
            .some(
              (e) =>
                e.kind === "owner" &&
                e.to.kind === "role" &&
                e.to.name === change.to,
            ),
          `desired owner of subject is not "${change.to}"`,
        );
        expect(mentions(action.sql, change.to), "owner role not in statement");
        break;
      case "rename": {
        expect(!source.has(subject), "rename target already in the source");
        expect(desired.has(subject), "rename target is not in the desired");
        expect(has(action.produces, subject), "rename does not produce target");
        // A child that keeps its name across its parent's rename is renamed on
        // its own afterwards, from its old name under the parent's NEW name:
        // the id the statement starts from, in neither state.
        const parent = desired.get(subject)?.parent;
        const parentRename =
          parent === undefined ? undefined : ctx.renameOf.get(encodeId(parent));
        if (parentRename?.change?.kind === "rename" && !inSource(change.from)) {
          // the subject's own id with the old child name: same qualifier
          const fromName = "name" in change.from ? change.from.name : undefined;
          expect(
            "name" in subject &&
              encodeId(change.from) ===
                encodeId({ ...subject, name: fromName } as StableId),
            "child rename source is not the subject under its old name",
          );
          expect(
            source
              .childrenOf(parentRename.change.from)
              .some(
                (child) =>
                  child.id.kind === change.from.kind &&
                  "name" in child.id &&
                  child.id.name === fromName,
              ),
            "child rename source is not a child of the renamed parent",
          );
        } else {
          expect(inSource(change.from), "rename source is not in the source");
          expect(
            has(action.destroys, change.from),
            "rename does not destroy its source",
          );
        }
        break;
      }
      case "defaultPrivileges":
        expect(
          subject.kind === "acl" || subject.kind === "defaultPrivilege",
          "cleanup subject must be a grant or a default privilege",
        );
        expect(
          !desired.has(subject),
          "cleanup revokes something the desired state keeps",
        );
        break;
    }
  }
  return out;
}

export function enforceActionStamps(
  label: string,
  thePlan: Plan,
  source: FactBase,
  desired: FactBase,
): void {
  const ctx = planContext(thePlan, source, desired);
  const problems = thePlan.actions.flatMap((action, index) =>
    stampViolations(action, ctx).map(
      (what) =>
        `  ${index}: ${what}\n     subject ${encodeId(action.subject)}\n     ${action.sql.slice(0, 160)}`,
    ),
  );
  if (problems.length > 0) {
    throw new Error(`[${label}] action stamps:\n${problems.join("\n")}`);
  }
}
