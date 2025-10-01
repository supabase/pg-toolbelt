import { describe, expect, test } from "vitest";
import { Extension, type ExtensionProps } from "../extension.model.ts";
import {
  AlterExtensionChangeOwner,
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
} from "./extension.alter.ts";

describe.concurrent("extension", () => {
  describe("alter", () => {
    test("update version", () => {
      const props: Omit<ExtensionProps, "version"> = {
        name: "test_extension",
        schema: "public",
        relocatable: true,
        owner: "test",
        comment: null,
      };
      const extension = new Extension({
        ...props,
        version: "1.0",
      });

      const change = new AlterExtensionUpdateVersion({
        extension,
        version: "2.0",
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension UPDATE TO '2.0'",
      );
    });

    test("set schema", () => {
      const props: Omit<ExtensionProps, "schema"> = {
        name: "test_extension",
        relocatable: true,
        version: "1.0",
        owner: "test",
        comment: null,
      };
      const extension = new Extension({
        ...props,
        schema: "public",
      });

      const change = new AlterExtensionSetSchema({
        extension,
        schema: "extensions",
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension SET SCHEMA extensions",
      );
    });

    test("change owner", () => {
      const props: Omit<ExtensionProps, "owner"> = {
        name: "test_extension",
        schema: "public",
        relocatable: true,
        version: "1.0",
        comment: null,
      };
      const extension = new Extension({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterExtensionChangeOwner({
        extension,
        owner: "new_owner",
      });

      expect(change.serialize()).toBe(
        "ALTER EXTENSION test_extension OWNER TO new_owner",
      );
    });
  });
});
