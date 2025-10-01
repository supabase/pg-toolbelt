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
    const byPrivGrantable = new Map<string, Map<boolean, Set<string>>>();
    for (const i of s.items) {
      if (!byPrivGrantable.has(i.privilege)) {
        byPrivGrantable.set(i.privilege, new Map());
      }
      const byGrantMaybe = byPrivGrantable.get(i.privilege);
      const byGrant = byGrantMaybe ?? new Map<boolean, Set<string>>();
      if (!byPrivGrantable.has(i.privilege)) {
        byPrivGrantable.set(i.privilege, byGrant);
      }
      if (!byGrant.has(i.grantable)) byGrant.set(i.grantable, new Set());
      const setMaybe = byGrant.get(i.grantable);
      const set = setMaybe ?? new Set<string>();
      if (!byGrant.has(i.grantable)) byGrant.set(i.grantable, set);
      for (const c of i.columns) set.add(c);
    }
    for (const [priv, byGrant] of byPrivGrantable) {
      for (const [grantable, colsSet] of byGrant) {
        const cols = [...colsSet].sort();
        changes.push(
          new GrantColumnPrivileges({
            tableId: s.table_stable_id,
            tableNameSql: `${s.schema}.${s.table_name}`,
            grantee: s.grantee,
            privilege: priv,
            columns: cols,
            grantable,
          }),
        );
      }
    }
  }

  for (const id of dropped) {
    const s = main[id];
    if (s.items.length === 0) continue;
    const byPriv = new Map<string, Set<string>>();
    for (const i of s.items) {
      if (!byPriv.has(i.privilege)) byPriv.set(i.privilege, new Set());
      const setMaybe = byPriv.get(i.privilege);
      const set = setMaybe ?? new Set<string>();
      if (!byPriv.has(i.privilege)) byPriv.set(i.privilege, set);
      for (const c of i.columns) set.add(c);
    }
    for (const [priv, colsSet] of byPriv) {
      const cols = [...colsSet].sort();
      changes.push(
        new RevokeColumnPrivileges({
          tableId: s.table_stable_id,
          tableNameSql: `${s.schema}.${s.table_name}`,
          grantee: s.grantee,
          privilege: priv,
          columns: cols,
        }),
      );
    }
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
      // Emit one change per privilege+grantable group
      const group = new Map<string, Map<boolean, Set<string>>>();
      for (const g of grants) {
        if (!group.has(g.privilege)) group.set(g.privilege, new Map());
        const byGrantMaybe = group.get(g.privilege);
        const byGrant = byGrantMaybe ?? new Map<boolean, Set<string>>();
        if (!group.has(g.privilege)) group.set(g.privilege, byGrant);
        if (!byGrant.has(g.grantable)) byGrant.set(g.grantable, new Set());
        const setMaybe = byGrant.get(g.grantable);
        const set = setMaybe ?? new Set<string>();
        if (!byGrant.has(g.grantable)) byGrant.set(g.grantable, set);
        for (const c of g.columns) set.add(c);
      }
      for (const [priv, byGrant] of group) {
        for (const [grantable, colsSet] of byGrant) {
          const cols = [...colsSet].sort();
          changes.push(
            new GrantColumnPrivileges({
              tableId: b.table_stable_id,
              tableNameSql: `${b.schema}.${b.table_name}`,
              grantee: b.grantee,
              privilege: priv,
              columns: cols,
              grantable,
            }),
          );
        }
      }
    }
    if (revokes.length > 0) {
      // Emit one change per privilege group
      const group = new Map<string, Set<string>>();
      for (const r of revokes) {
        if (!group.has(r.privilege)) group.set(r.privilege, new Set());
        const setMaybe = group.get(r.privilege);
        const set = setMaybe ?? new Set<string>();
        if (!group.has(r.privilege)) group.set(r.privilege, set);
        for (const c of r.columns) set.add(c);
      }
      for (const [priv, colsSet] of group) {
        const cols = [...colsSet].sort();
        changes.push(
          new RevokeColumnPrivileges({
            tableId: a.table_stable_id,
            tableNameSql: `${a.schema}.${a.table_name}`,
            grantee: a.grantee,
            privilege: priv,
            columns: cols,
          }),
        );
      }
    }
    if (revokeGrantOption.size > 0) {
      for (const [priv, cols] of revokeGrantOption.entries()) {
        changes.push(
          new RevokeGrantOptionColumnPrivileges({
            tableId: a.table_stable_id,
            tableNameSql: `${a.schema}.${a.table_name}`,
            grantee: a.grantee,
            privilege: priv,
            columns: cols,
          }),
        );
      }
    }
  }

  return changes;
}
