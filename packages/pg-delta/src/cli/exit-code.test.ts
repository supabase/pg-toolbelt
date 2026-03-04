import { describe, expect, test } from "bun:test";
import { getCommandExitCode, setCommandExitCode } from "./exit-code.ts";

describe("exit-code", () => {
  test("getCommandExitCode returns undefined when never set", () => {
    expect(getCommandExitCode()).toBeUndefined();
  });

  test("setCommandExitCode then getCommandExitCode returns the value", () => {
    setCommandExitCode(2);
    expect(getCommandExitCode()).toBe(2);
  });

  test("setCommandExitCode overwrites previous value", () => {
    setCommandExitCode(2);
    setCommandExitCode(0);
    expect(getCommandExitCode()).toBe(0);
  });
});
