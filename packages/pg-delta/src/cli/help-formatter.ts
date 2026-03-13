import * as CliOutput from "effect/unstable/cli/CliOutput";

const baseFormatter = CliOutput.defaultFormatter({ colors: false });

export const PgDeltaCliOutputLive = CliOutput.layer({
  ...baseFormatter,
  formatHelpDoc: (doc) =>
    baseFormatter
      .formatHelpDoc(doc)
      .replace(
        "  --completions choice    Print shell completion script",
        "  --completions <bash|zsh|fish|sh>\n                          Print shell completion script",
      )
      .replace(
        "  --log-level choice      Sets the minimum log level",
        "  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>\n                          Sets the minimum log level",
      ),
});
