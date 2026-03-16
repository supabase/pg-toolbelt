import { describe, expect, test } from "bun:test";
import {
  parseCompletionShell,
  sanitizeCompletionScript,
} from "./completions.ts";

describe("pgdelta completion sanitization", () => {
  test("parseCompletionShell accepts both flag forms", () => {
    expect(parseCompletionShell(["--completions", "zsh"])).toBe("zsh");
    expect(parseCompletionShell(["--completions=fish"])).toBe("fish");
    expect(parseCompletionShell(["plan"])).toBeUndefined();
  });

  test("sanitizeCompletionScript removes unsupported negated bash flags", () => {
    const script = [
      "_arguments --unsafe --no-unsafe --force --no-force",
      "_flag_groups[--no-unsafe]=1",
      "()",
    ].join("\n");

    expect(sanitizeCompletionScript(script, "bash")).toBe(
      "_arguments --unsafe --force",
    );
  });

  test("sanitizeCompletionScript removes unsupported negated zsh flags", () => {
    const script = [
      "'--unsafe[Allow unsafe mode]'",
      "'--no-unsafe[Disable unsafe mode]'",
      "'--skip-function-validation[Skip validation]'",
      "'--no-skip-function-validation[Disable skip validation]'",
    ].join("\n");

    expect(sanitizeCompletionScript(script, "zsh")).toBe(
      [
        "'--unsafe[Allow unsafe mode]'",
        "'--skip-function-validation[Skip validation]'",
      ].join("\n"),
    );
  });

  test("sanitizeCompletionScript removes unsupported negated fish flags", () => {
    const script = [
      "complete -c pgdelta -l unsafe -d 'Allow unsafe mode'",
      "complete -c pgdelta -l no-unsafe -d 'Disable unsafe mode'",
      "complete -c pgdelta -l skip-function-validation -d 'Skip validation'",
      "complete -c pgdelta -a '--no-skip-function-validation'",
    ].join("\n");

    expect(sanitizeCompletionScript(script, "fish")).toBe(
      [
        "complete -c pgdelta -l unsafe -d 'Allow unsafe mode'",
        "complete -c pgdelta -l skip-function-validation -d 'Skip validation'",
      ].join("\n"),
    );
  });
});
