import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "@supabase/pg-topo";
import {
  buildDiagnosticDisplayItems,
  type DiagnosticDisplayEntry,
} from "./declarative-apply.ts";

const unresolvedDiagnostic = (message: string): Diagnostic => ({
  code: "UNRESOLVED_DEPENDENCY",
  message,
  details: {
    requiredObjectKey: "function:public:json_build_object:(unknown,unknown)",
  },
  suggestedFix: "Add the missing statement.",
});

describe("declarative apply diagnostic display grouping", () => {
  test("grouped mode collapses repeated unresolved diagnostics", () => {
    const entries: DiagnosticDisplayEntry[] = [
      {
        diagnostic: unresolvedDiagnostic(
          "No producer found for 'function:public:json_build_object:(unknown,unknown)'.",
        ),
        location: "schemas/public/tables/user.sql:38:1",
        requiredObjectKey:
          "function:public:json_build_object:(unknown,unknown)",
      },
      {
        diagnostic: unresolvedDiagnostic(
          "No producer found for 'function:public:json_build_object:(unknown,unknown)'.",
        ),
        location: "schemas/public/tables/user.sql:45:1",
        requiredObjectKey:
          "function:public:json_build_object:(unknown,unknown)",
      },
    ];

    const displayItems = buildDiagnosticDisplayItems(entries, true);

    expect(displayItems).toHaveLength(1);
    expect(displayItems[0]?.locations).toEqual([
      "schemas/public/tables/user.sql:38:1",
      "schemas/public/tables/user.sql:45:1",
    ]);
  });

  test("ungrouped mode keeps full per-diagnostic detail", () => {
    const entries: DiagnosticDisplayEntry[] = [
      {
        diagnostic: unresolvedDiagnostic(
          "No producer found for 'function:public:json_build_object:(unknown,unknown)'.",
        ),
        location: "schemas/public/tables/user.sql:38:1",
        requiredObjectKey:
          "function:public:json_build_object:(unknown,unknown)",
      },
      {
        diagnostic: unresolvedDiagnostic(
          "No producer found for 'function:public:json_build_object:(unknown,unknown)'.",
        ),
        location: "schemas/public/tables/user.sql:45:1",
        requiredObjectKey:
          "function:public:json_build_object:(unknown,unknown)",
      },
    ];

    const displayItems = buildDiagnosticDisplayItems(entries, false);

    expect(displayItems).toHaveLength(2);
    expect(displayItems[0]?.locations).toEqual([
      "schemas/public/tables/user.sql:38:1",
    ]);
    expect(displayItems[1]?.locations).toEqual([
      "schemas/public/tables/user.sql:45:1",
    ]);
  });
});
