import { describe, expect, test } from "bun:test";
import type { Change } from "../../change.types.ts";
import { getSchema, PROPERTY_EXTRACTORS } from "./extractors.ts";

describe("getSchema", () => {
  test("returns schema for table", () => {
    const change = {
      objectType: "table",
      table: { schema: "public" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("public");
  });

  test("returns schema for view", () => {
    const change = {
      objectType: "view",
      view: { schema: "app" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("app");
  });

  test("returns schema for enum", () => {
    const change = {
      objectType: "enum",
      enum: { schema: "types" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("types");
  });

  test("returns schema.name for schema type", () => {
    const change = {
      objectType: "schema",
      schema: { name: "auth" },
    } as unknown as Change;
    expect(getSchema(change)).toBe("auth");
  });

  test("returns null for role", () => {
    const change = {
      objectType: "role",
      role: { name: "admin" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });

  test("returns null for publication", () => {
    const change = {
      objectType: "publication",
      publication: { name: "pub1" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });

  test("returns null for language", () => {
    const change = {
      objectType: "language",
      language: { name: "plpgsql" },
    } as unknown as Change;
    expect(getSchema(change)).toBeNull();
  });
});

describe("owner extractor", () => {
  const getOwner = PROPERTY_EXTRACTORS.owner;

  test("returns owner for table", () => {
    const change = {
      objectType: "table",
      table: { owner: "postgres" },
    } as unknown as Change;
    expect(getOwner(change)).toBe("postgres");
  });

  test("returns owner for schema", () => {
    const change = {
      objectType: "schema",
      schema: { owner: "admin" },
    } as unknown as Change;
    expect(getOwner(change)).toBe("admin");
  });

  test("returns role.name for role type", () => {
    const change = {
      objectType: "role",
      role: { name: "supabase_admin" },
    } as unknown as Change;
    expect(getOwner(change)).toBe("supabase_admin");
  });

  test("returns null for user_mapping", () => {
    const change = { objectType: "user_mapping" } as unknown as Change;
    expect(getOwner(change)).toBeNull();
  });
});

describe("PROPERTY_EXTRACTORS", () => {
  test("has all expected keys", () => {
    const expectedKeys = [
      "schema",
      "owner",
      "member",
      "grantee",
      "publication",
      "extension",
      "procedureLanguage",
      "eventTriggerName",
      "procedureBinaryPath",
      "triggerFunctionSchema",
    ];
    expect(Object.keys(PROPERTY_EXTRACTORS).sort()).toEqual(
      expectedKeys.sort(),
    );
  });

  describe("member", () => {
    test("returns member for membership scope", () => {
      const change = {
        scope: "membership",
        member: "app_user",
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.member(change)).toBe("app_user");
    });

    test("returns null for non-membership scope", () => {
      const change = { scope: "object" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.member(change)).toBeNull();
    });
  });

  describe("grantee", () => {
    test("returns grantee for privilege scope", () => {
      const change = {
        scope: "privilege",
        grantee: "reader",
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.grantee(change)).toBe("reader");
    });

    test("returns null for non-privilege scope", () => {
      const change = { scope: "object" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.grantee(change)).toBeNull();
    });
  });

  describe("publication", () => {
    test("returns name for publication type", () => {
      const change = {
        objectType: "publication",
        publication: { name: "my_pub" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.publication(change)).toBe("my_pub");
    });

    test("returns null for non-publication type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.publication(change)).toBeNull();
    });
  });

  describe("extension", () => {
    test("returns name for extension type", () => {
      const change = {
        objectType: "extension",
        extension: { name: "pgcrypto" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.extension(change)).toBe("pgcrypto");
    });

    test("returns null for non-extension type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.extension(change)).toBeNull();
    });
  });

  describe("procedureLanguage", () => {
    test("returns language for procedure type", () => {
      const change = {
        objectType: "procedure",
        procedure: { language: "plpgsql" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.procedureLanguage(change)).toBe("plpgsql");
    });

    test("returns null for non-procedure type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.procedureLanguage(change)).toBeNull();
    });
  });

  describe("eventTriggerName", () => {
    test("returns name for event_trigger type", () => {
      const change = {
        objectType: "event_trigger",
        eventTrigger: { name: "my_trigger" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.eventTriggerName(change)).toBe("my_trigger");
    });

    test("returns null for non-event_trigger type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.eventTriggerName(change)).toBeNull();
    });
  });

  describe("procedureBinaryPath", () => {
    test("returns binary_path for procedure type", () => {
      const change = {
        objectType: "procedure",
        procedure: { binary_path: "/usr/bin/pg" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.procedureBinaryPath(change)).toBe(
        "/usr/bin/pg",
      );
    });

    test("returns null when binary_path is undefined", () => {
      const change = {
        objectType: "procedure",
        procedure: {},
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.procedureBinaryPath(change)).toBeNull();
    });

    test("returns null for non-procedure type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.procedureBinaryPath(change)).toBeNull();
    });
  });

  describe("triggerFunctionSchema", () => {
    test("returns function_schema for trigger type", () => {
      const change = {
        objectType: "trigger",
        trigger: { function_schema: "public" },
      } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.triggerFunctionSchema(change)).toBe("public");
    });

    test("returns null for non-trigger type", () => {
      const change = { objectType: "table" } as unknown as Change;
      expect(PROPERTY_EXTRACTORS.triggerFunctionSchema(change)).toBeNull();
    });
  });
});
