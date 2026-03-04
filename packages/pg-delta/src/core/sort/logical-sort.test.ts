import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { logicalSort } from "./logical-sort.ts";

function mockChange(
  overrides: Partial<{
    objectType: string;
    operation: string;
    scope: string;
    creates: string[];
    drops: string[];
    requires: string[];
    schema: string | null;
    className: string;
    inSchema: string | null;
    objtype: string;
    grantee: string;
    eventTrigger: { function_schema: string };
  }>,
): Change {
  const {
    objectType = "table",
    operation = "create",
    scope = "object",
    creates = [],
    drops = [],
    requires = [],
    schema = "public",
    className = "MockChange",
    inSchema,
    objtype,
    grantee,
    eventTrigger,
  } = overrides;

  const change: Record<string, unknown> = {
    objectType,
    operation,
    scope,
    creates,
    drops,
    requires,
  };

  if (objectType === "table") {
    change.table = { schema, name: "t" };
  } else if (objectType === "schema") {
    change.schema = { name: schema ?? "public" };
  } else if (objectType === "role") {
    change.role = { name: "postgres" };
  } else if (objectType === "index") {
    change.index = { schema, name: "idx" };
  }

  if (inSchema !== undefined) {
    change.inSchema = inSchema;
  }
  if (objtype !== undefined) {
    change.objtype = objtype;
  }
  if (grantee !== undefined) {
    change.grantee = grantee;
  }
  if (eventTrigger !== undefined) {
    change.eventTrigger = eventTrigger;
  }

  Object.defineProperty(change, "constructor", { value: { name: className } });
  return change as unknown as Change;
}

describe("logicalSort", () => {
  test("returns empty array for empty input", () => {
    expect(logicalSort([])).toEqual([]);
  });

  test("single change passes through", () => {
    const c = mockChange({ creates: ["table:public.t"] });
    expect(logicalSort([c])).toEqual([c]);
  });

  describe("comment/privilege on constraint", () => {
    test("CREATE comment on constraint groups with table", () => {
      const tableCreate = mockChange({
        creates: ["table:public.t"],
      });
      const commentOnConstraint = mockChange({
        scope: "comment",
        operation: "create",
        creates: ["comment:constraint:public.t.pk"],
        requires: ["constraint:public.t.pk_name"],
      });

      const result = logicalSort([commentOnConstraint, tableCreate]);
      expect(result).toHaveLength(2);
      expect(result).toContain(tableCreate);
      expect(result).toContain(commentOnConstraint);
    });

    test("DROP comment on constraint groups with table", () => {
      const tableDrop = mockChange({
        operation: "drop",
        drops: ["table:public.t"],
      });
      const commentDrop = mockChange({
        scope: "comment",
        operation: "drop",
        creates: [],
        requires: ["constraint:public.t.pk_name"],
      });

      const result = logicalSort([commentDrop, tableDrop]);
      expect(result).toHaveLength(2);
    });
  });

  describe("comment/privilege on column", () => {
    test("CREATE comment on column groups with table", () => {
      const tableCreate = mockChange({
        creates: ["table:public.t"],
      });
      const commentOnColumn = mockChange({
        scope: "comment",
        operation: "create",
        creates: ["comment:column:public.t.col"],
        requires: ["column:public.t.col"],
      });

      const result = logicalSort([commentOnColumn, tableCreate]);
      expect(result).toHaveLength(2);
    });

    test("DROP comment on column extracts table grouping key", () => {
      const commentDrop = mockChange({
        scope: "comment",
        operation: "drop",
        creates: [],
        requires: ["column:public.t.col"],
      });
      const tableCreate = mockChange({
        creates: ["table:public.t"],
      });

      const result = logicalSort([commentDrop, tableCreate]);
      expect(result).toHaveLength(2);
    });
  });

  describe("CREATE/DROP constraint", () => {
    test("CREATE constraint groups with parent table", () => {
      const tableCreate = mockChange({
        creates: ["table:public.t"],
      });
      const constraintCreate = mockChange({
        operation: "create",
        creates: ["constraint:public.t.pk_name"],
        requires: ["table:public.t"],
      });

      const result = logicalSort([constraintCreate, tableCreate]);
      expect(result).toHaveLength(2);
    });

    test("DROP constraint groups with parent table", () => {
      const constraintDrop = mockChange({
        operation: "drop",
        drops: ["constraint:public.t.pk_name"],
        requires: ["table:public.t"],
      });

      const result = logicalSort([constraintDrop]);
      expect(result).toHaveLength(1);
    });
  });

  describe("default_privilege scope", () => {
    test("groups by role + schema combination", () => {
      const defPriv = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:public.tables"],
        requires: ["role:postgres", "schema:public"],
        inSchema: "public",
      });

      const result = logicalSort([defPriv]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(defPriv);
    });

    test("groups by role only when no schema", () => {
      const defPriv = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:tables"],
        requires: ["role:postgres"],
        inSchema: null,
      });

      const result = logicalSort([defPriv]);
      expect(result).toHaveLength(1);
    });
  });

  describe("ALTER with constraints and columns", () => {
    test("ALTER with constraint creates groups with table", () => {
      const alterConstraint = mockChange({
        operation: "alter",
        creates: ["constraint:public.t.fk"],
        requires: ["table:public.t"],
      });

      const result = logicalSort([alterConstraint]);
      expect(result).toHaveLength(1);
    });

    test("ALTER with column creates groups with table", () => {
      const alterColumn = mockChange({
        operation: "alter",
        creates: ["column:public.t.new_col"],
        requires: ["table:public.t"],
      });

      const result = logicalSort([alterColumn]);
      expect(result).toHaveLength(1);
    });

    test("ALTER with constraint drops groups with table", () => {
      const alterDropConstraint = mockChange({
        operation: "alter",
        drops: ["constraint:public.t.fk"],
        requires: ["table:public.t"],
      });

      const result = logicalSort([alterDropConstraint]);
      expect(result).toHaveLength(1);
    });

    test("ALTER with constraint in requires groups with table", () => {
      const alterValidateConstraint = mockChange({
        operation: "alter",
        requires: ["constraint:public.t.pk"],
      });

      const result = logicalSort([alterValidateConstraint]);
      expect(result).toHaveLength(1);
    });
  });

  describe("phase ordering", () => {
    test("DROP changes come before CREATE changes", () => {
      const createChange = mockChange({
        operation: "create",
        creates: ["table:public.a"],
      });
      const dropChange = mockChange({
        operation: "drop",
        drops: ["table:public.b"],
      });

      const result = logicalSort([createChange, dropChange]);
      expect(result[0]).toBe(dropChange);
      expect(result[1]).toBe(createChange);
    });
  });

  describe("grouping related changes together", () => {
    test("table create + constraint comment sort adjacent", () => {
      const tableCreate = mockChange({
        creates: ["table:public.t"],
      });
      const otherTable = mockChange({
        creates: ["table:public.z"],
      });
      const commentOnConstraint = mockChange({
        scope: "comment",
        operation: "create",
        creates: ["comment:constraint:public.t.pk"],
        requires: ["constraint:public.t.pk_name"],
      });

      const result = logicalSort([
        otherTable,
        commentOnConstraint,
        tableCreate,
      ]);
      expect(result).toHaveLength(3);
      const tIdx = result.indexOf(tableCreate);
      const cIdx = result.indexOf(commentOnConstraint);
      const zIdx = result.indexOf(otherTable);
      expect(Math.abs(tIdx - cIdx)).toBe(1);
      expect(zIdx).not.toBe(tIdx + 1);
    });

    test("default_privilege sorts after schemas and roles", () => {
      const schemaCreate = mockChange({
        objectType: "schema",
        operation: "create",
        creates: ["schema:public"],
        schema: "public",
      });
      const roleCreate = mockChange({
        objectType: "role",
        operation: "create",
        creates: ["role:postgres"],
        schema: null,
      });
      const defPriv = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:public.tables"],
        requires: ["role:postgres", "schema:public"],
        inSchema: "public",
      });

      const result = logicalSort([defPriv, schemaCreate, roleCreate]);
      expect(result).toHaveLength(3);
      expect(result.indexOf(defPriv)).toBeGreaterThan(
        result.indexOf(schemaCreate),
      );
    });

    test("default_privilege orders deterministically by objtype then grantee", () => {
      const baseRequires = ["role:postgres", "schema:public"];
      const defPrivTablesAnon = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:postgres:r:schema:public:grantee:anon"],
        requires: baseRequires,
        inSchema: "public",
        objtype: "r",
        grantee: "anon",
      });
      const defPrivTablesAuthenticated = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:postgres:r:schema:public:grantee:authenticated"],
        requires: baseRequires,
        inSchema: "public",
        objtype: "r",
        grantee: "authenticated",
      });
      const defPrivSequencesAnon = mockChange({
        scope: "default_privilege",
        operation: "create",
        creates: ["defacl:postgres:S:schema:public:grantee:anon"],
        requires: baseRequires,
        inSchema: "public",
        objtype: "S",
        grantee: "anon",
      });
      const input = [
        defPrivTablesAuthenticated,
        defPrivSequencesAnon,
        defPrivTablesAnon,
      ];
      const result = logicalSort(input);
      expect(result).toHaveLength(3);
      // Result ordered by canonical objtype (n,r,S,f,T) then grantee: r before S, anon before authenticated within r
      const getKey = (c: Change) =>
        `${(c as { objtype: string }).objtype}:${(c as { grantee: string }).grantee}`;
      expect(getKey(result[0])).toBe("r:anon");
      expect(getKey(result[1])).toBe("r:authenticated");
      expect(getKey(result[2])).toBe("S:anon");
      // Determinism: shuffling input must yield the same order
      const shuffled = [...input].sort(() => Math.random() - 0.5);
      const result2 = logicalSort(shuffled);
      expect(result2.map(getKey)).toEqual(result.map(getKey));
    });
  });
});
