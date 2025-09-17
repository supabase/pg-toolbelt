import type { Change } from "../../base.change.ts";
import { diffObjects } from "../../base.diff.ts";
import {
  GrantColumnPrivileges,
  RevokeColumnPrivileges,
  RevokeGrantOptionColumnPrivileges,
} from "./changes/column-privilege.alter.ts";
import type { ColumnPrivilegeSet } from "./column-privilege.model.ts";

export function diffColumnPrivileges(
  main: Record<string, ColumnPrivilegeSet>,
  branch: Record<string, ColumnPrivilegeSet>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);
  const changes: Change[] = [];

  for (const id of created) {
    const s = branch[id];
    if (s.items.length === 0) continue;
    changes.push(
      new GrantColumnPrivileges({
        tableId: s.table_stable_id,
        tableNameSql: `${s.schema}.${s.table_name}`,
        grantee: s.grantee,
        items: s.items,
      }),
    );
  }

  for (const id of dropped) {
    const s = main[id];
    if (s.items.length === 0) continue;
    changes.push(
      new RevokeColumnPrivileges({
        tableId: s.table_stable_id,
        tableNameSql: `${s.schema}.${s.table_name}`,
        grantee: s.grantee,
        items: s.items,
      }),
    );
  }

  for (const id of altered) {
    const a = main[id];
    const b = branch[id];
    const byPrivGrantable = (items: typeof a.items) =>
      new Map(
        items.map((i) => [`${i.privilege}:${i.grantable}`, new Set(i.columns)]),
      );
    const aMap = byPrivGrantable(a.items);
    const bMap = byPrivGrantable(b.items);

    const grants: {
      privilege: string;
      grantable: boolean;
      columns: string[];
    }[] = [];
    const revokes: {
      privilege: string;
      grantable: boolean;
      columns: string[];
    }[] = [];
    const revokeGrantOption: Map<string, string[]> = new Map();

    for (const [key, colsB] of bMap) {
      const [priv, grantableStr] = key.split(":");
      const colsA = aMap.get(key) ?? new Set<string>();
      const add = [...colsB.difference(colsA)];
      if (add.length > 0) {
        grants.push({
          privilege: priv,
          grantable: grantableStr === "true",
          columns: add,
        });
      }
    }
    for (const [key, colsA] of aMap) {
      const [priv, grantableStr] = key.split(":");
      const colsB = bMap.get(key) ?? new Set<string>();
      const del = [...colsA.difference(colsB)];
      if (del.length > 0) {
        const wasGrantable = grantableStr === "true";
        const stillHasBase = bMap.get(`${priv}:false`);
        if (wasGrantable && stillHasBase && colsB.size > 0) {
          // Only grant option removed on these columns
          const existing = revokeGrantOption.get(priv) ?? [];
          revokeGrantOption.set(priv, existing.concat(del));
        } else {
          revokes.push({
            privilege: priv,
            grantable: wasGrantable,
            columns: del,
          });
        }
      }
    }

    if (grants.length > 0) {
      changes.push(
        new GrantColumnPrivileges({
          tableId: b.table_stable_id,
          tableNameSql: `${b.schema}.${b.table_name}`,
          grantee: b.grantee,
          items: grants,
        }),
      );
    }
    if (revokes.length > 0) {
      changes.push(
        new RevokeColumnPrivileges({
          tableId: a.table_stable_id,
          tableNameSql: `${a.schema}.${a.table_name}`,
          grantee: a.grantee,
          items: revokes,
        }),
      );
    }
    if (revokeGrantOption.size > 0) {
      const items = [...revokeGrantOption.entries()].map(([priv, cols]) => ({
        privilege: priv,
        columns: cols,
      }));
      changes.push(
        new RevokeGrantOptionColumnPrivileges({
          tableId: a.table_stable_id,
          tableNameSql: `${a.schema}.${a.table_name}`,
          grantee: a.grantee,
          items,
        }),
      );
    }
  }

  return changes;
}
