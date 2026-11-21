/** Rule definitions for cluster-level role objects: roles, role memberships,
 *  and default privileges. */
import type { Fact } from "../../core/fact.ts";
import type { PayloadValue } from "../../core/hash.ts";
import { lit, qid, splitOption } from "../render.ts";
import type { ActionSpec, FactView, KindRules } from "../rules.ts";
import {
  defaultPrivilegeCreateActions,
  defaultPrivilegeDropActions,
  p,
  renameRule,
} from "./helpers.ts";

/** Role attribute keyword map (CREATE ROLE / ALTER ROLE flags). */
const ROLE_FLAGS: Record<string, [on: string, off: string]> = {
  superuser: ["SUPERUSER", "NOSUPERUSER"],
  inherit: ["INHERIT", "NOINHERIT"],
  createRole: ["CREATEROLE", "NOCREATEROLE"],
  createDb: ["CREATEDB", "NOCREATEDB"],
  login: ["LOGIN", "NOLOGIN"],
  replication: ["REPLICATION", "NOREPLICATION"],
  bypassRls: ["BYPASSRLS", "NOBYPASSRLS"],
};

function roleFlagSql(payload: Fact["payload"]): string {
  return Object.entries(ROLE_FLAGS)
    .map(([key, [on, off]]) => (payload[key] ? on : off))
    .join(" ");
}

/** Parse a `pg_db_role_setting` search_path value into list elements.
 *  One string literal is one element (`TO 'a, b'` → schema `a, b`).
 *  Per-element literals (`TO 'a', 'b'`) match the catalog list form.
 *  Empty (`TO ''`) stores `search_path=""`; `TO ""` is invalid SQL. */
function searchPathToSql(value: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (value[i] === "," || value[i] === " ")) i++;
    if (i >= value.length) break;
    if (value[i] === '"') {
      let ident = "";
      i++;
      while (i < value.length) {
        if (value[i] === '"' && value[i + 1] === '"') {
          ident += '"';
          i += 2;
          continue;
        }
        if (value[i] === '"') {
          i++;
          break;
        }
        ident += value[i];
        i++;
      }
      parts.push(ident);
    } else {
      let ident = "";
      while (i < value.length && value[i] !== ",") {
        ident += value[i];
        i++;
      }
      const trimmed = ident.trim();
      if (trimmed !== "" || parts.length === 0) parts.push(trimmed);
    }
  }
  if (parts.length === 0) return lit("");
  return parts.map(lit).join(", ");
}

/** `ALTER ROLE <role> SET <key> TO <value>` — the single rendering of a role
 *  GUC config entry, shared by the create rule (materializing config on a fresh
 *  role) and the config set-delta alter (changing it later). `role` is already
 *  quoted by the caller. */
function roleConfigSetSql(role: string, key: string, value: string): string {
  const rendered = key === "search_path" ? searchPathToSql(value) : lit(value);
  return `ALTER ROLE ${role} SET ${qid(key)} TO ${rendered}`;
}

/** The member's INHERIT when the GRANT runs: what a plain grant gives on
 *  PG16+. Undefined when the plan changes it, so INHERIT is spelled out. */
function memberInherits(
  member: string,
  view: FactView,
  sourceView: FactView | undefined,
): boolean | undefined {
  const id = { kind: "role", name: member } as const;
  const desired = view.get(id)?.payload["inherit"];
  const source = sourceView?.get(id)?.payload["inherit"];
  if (source !== undefined && source !== desired) return undefined;
  return desired !== false;
}

/** `GRANT role TO member` whose NEW pg_auth_members row equals the fact: it
 *  spells only the options a plain grant would not give (ADMIN false, SET
 *  true, INHERIT the member's own). A PG <= 15 payload has no INHERIT / SET
 *  and renders as it always did. */
export function membershipGrantSql(
  role: string,
  member: string,
  payload: Readonly<Record<string, PayloadValue>>,
  inheritDefault: boolean | undefined,
): string {
  const options: string[] = [];
  if (payload["admin"] === true) options.push("ADMIN TRUE");
  const inherit = payload["inherit"];
  if (typeof inherit === "boolean" && inherit !== inheritDefault)
    options.push(`INHERIT ${inherit ? "TRUE" : "FALSE"}`);
  if (payload["set"] === false) options.push("SET FALSE");
  const clause =
    options.length === 0
      ? ""
      : options.length === 1 && payload["admin"] === true
        ? " WITH ADMIN OPTION"
        : ` WITH ${options.join(", ")}`;
  return `GRANT ${qid(role)} TO ${qid(member)}${clause}`;
}

/** PG16+ INHERIT / SET of an existing membership, both in one statement: it
 *  updates the row the executing role granted (or adds one) and keeps ADMIN
 *  unless it is raised here too. */
function membershipUseAlter(fact: Fact, admin = false): ActionSpec {
  const id = fact.id as { role: string; member: string };
  const bool = (key: string) => (fact.payload[key] ? "TRUE" : "FALSE");
  return {
    sql: `GRANT ${qid(id.role)} TO ${qid(id.member)} WITH ${admin ? "ADMIN TRUE, " : ""}INHERIT ${bool("inherit")}, SET ${bool("set")}`,
    consumes: [
      { kind: "role", name: id.role },
      { kind: "role", name: id.member },
    ],
  };
}

/** Whether INHERIT or SET changes. A PG <= 15 fact has neither key: not
 *  comparable, so never a change. */
function useChanged(
  fact: Fact,
  sourceView: FactView,
  key: "inherit" | "set",
): boolean {
  const from = sourceView.get(fact.id)?.payload[key];
  const to = fact.payload[key];
  return typeof from === "boolean" && typeof to === "boolean" && from !== to;
}

const adminRaised = (fact: Fact, sourceView: FactView): boolean =>
  fact.payload["admin"] === true &&
  sourceView.get(fact.id)?.payload["admin"] !== true;

export const roleRules: Record<string, KindRules> = {
  role: {
    weight: 0,
    rename: renameRule(
      (fact) => `ALTER ROLE ${qid((fact.id as { name: string }).name)}`,
    ),
    // a create rule must materialize EVERY payload attribute not carried by a
    // child fact or edge: CREATE ROLE … WITH <flags>, then one
    // `ALTER ROLE … SET` per desired config entry (review P1 — creating a
    // configured role must not drop its GUC config). Follow-up actions consume
    // the role fact so they order after the CREATE.
    create: (fact) => {
      const role = qid((fact.id as { name: string }).name);
      const specs: ActionSpec[] = [
        { sql: `CREATE ROLE ${role} WITH ${roleFlagSql(fact.payload)}` },
      ];
      for (const entry of (p(fact, "config") as string[] | null) ?? []) {
        const [key, value] = splitOption(entry);
        specs.push({ sql: roleConfigSetSql(role, key, value) });
      }
      return specs;
    },
    drop: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      // No `DROP OWNED BY`: every managed grant, default ACL, and owned
      // object has already been revoked/reassigned/dropped by its own plan
      // action. `DROP OWNED BY` would also sweep up anything the role owns
      // OUTSIDE the managed view, silently destroying unmanaged data — a
      // plain `DROP ROLE` instead fails loud if unmanaged ownership remains.
      return { sql: `DROP ROLE ${name}` };
    },
    attributes: {
      ...Object.fromEntries(
        Object.entries(ROLE_FLAGS).map(([key, [on, off]]) => [
          key,
          {
            alter: (fact: Fact, _from: PayloadValue, to: PayloadValue) => ({
              sql: `ALTER ROLE ${qid((fact.id as { name: string }).name)} WITH ${to ? on : off}`,
            }),
          },
        ]),
      ),
      config: {
        alter: (fact, from, to) => {
          const role = qid((fact.id as { name: string }).name);
          const oldCfg = new Map(
            ((from as string[] | null) ?? []).map(splitOption),
          );
          const newCfg = new Map(
            ((to as string[] | null) ?? []).map(splitOption),
          );
          const specs: ActionSpec[] = [];
          for (const [key] of oldCfg) {
            if (!newCfg.has(key)) {
              specs.push({ sql: `ALTER ROLE ${role} RESET ${qid(key)}` });
            }
          }
          for (const [key, value] of newCfg) {
            if (oldCfg.get(key) !== value) {
              specs.push({ sql: roleConfigSetSql(role, key, value) });
            }
          }
          return specs;
        },
      },
    },
  },

  membership: {
    weight: 1,
    create: (fact, view, _params, sourceView) => {
      const id = fact.id as { role: string; member: string };
      return [
        {
          sql: membershipGrantSql(
            id.role,
            id.member,
            fact.payload,
            memberInherits(id.member, view, sourceView),
          ),
          consumes: [
            { kind: "role", name: id.role },
            { kind: "role", name: id.member },
          ],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { role: string; member: string };
      // NO CASCADE: on PG16+, revoking an ADMIN-OPTION membership with CASCADE
      // also deletes downstream pg_auth_members rows the member granted onward
      // — including ones present on BOTH diff sides that are meant to be kept.
      // Extraction is grantor-blind, so nothing plans a corrective re-grant, and
      // the kept grant is silently destroyed. Plain REVOKE removes only this
      // pair; on PG16+ with a dependent grant it fails LOUDLY ("dependent
      // privileges exist") rather than silently — intended for now (convergent
      // regrant tracked in #333).
      return {
        sql: `REVOKE ${qid(id.role)} FROM ${qid(id.member)}`,
        consumes: [
          { kind: "role", name: id.role },
          { kind: "role", name: id.member },
        ],
      };
    },
    attributes: {
      admin: {
        alter: (fact, _from, to, view, sourceView) => {
          const id = fact.id as { role: string; member: string };
          // a GRANT on an existing row leaves the options it does not name
          if (
            to &&
            (useChanged(fact, sourceView, "inherit") ||
              useChanged(fact, sourceView, "set"))
          )
            return membershipUseAlter(fact, true);
          return {
            sql: to
              ? membershipGrantSql(
                  id.role,
                  id.member,
                  fact.payload,
                  memberInherits(id.member, view, sourceView),
                )
              : `REVOKE ADMIN OPTION FOR ${qid(id.role)} FROM ${qid(id.member)}`,
            consumes: [
              { kind: "role", name: id.role },
              { kind: "role", name: id.member },
            ],
          };
        },
      },
      // one statement sets all: the ADMIN alter wrote it when ADMIN is
      // raised, the INHERIT alter when both options change
      inherit: {
        alter: (fact, _from, _to, _view, sourceView) =>
          adminRaised(fact, sourceView) ||
          !useChanged(fact, sourceView, "inherit")
            ? []
            : membershipUseAlter(fact),
      },
      set: {
        alter: (fact, _from, _to, _view, sourceView) =>
          adminRaised(fact, sourceView) ||
          !useChanged(fact, sourceView, "set") ||
          useChanged(fact, sourceView, "inherit")
            ? []
            : membershipUseAlter(fact),
      },
    },
  },

  defaultPrivilege: {
    weight: 22,
    create: (fact) => defaultPrivilegeCreateActions(fact),
    drop: (fact) => defaultPrivilegeDropActions(fact),
    attributes: { privileges: "replace", grantable: "replace" },
  },
};
