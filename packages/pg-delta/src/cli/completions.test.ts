import { describe, expect, test } from "bun:test";
import { runCli } from "../../tests/cli/helpers/run-cli.ts";

describe("pgdelta completions and flag conventions", () => {
  test("zsh completions do not advertise unsupported negated flags", async () => {
    const result = await runCli(["--completions", "zsh"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("--no-unsafe");
    expect(result.stdout).not.toContain("--no-force");
    expect(result.stdout).not.toContain("--no-sql-format");
    expect(result.stdout).not.toContain("--no-no-validate-functions");
  });

  test("declarative apply help exposes the renamed canonical validation flag", async () => {
    const result = await runCli(["declarative", "apply", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("--skip-function-validation");
    expect(result.stdout).not.toContain("--no-validate-functions");
  });
});
