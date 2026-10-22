/**
 * Vendors a released `splinter.sql` into `src/vendor/`.
 *
 *   bun scripts/sync-splinter.ts [--tag 2026.09.1] [--repo <splinter checkout>]
 *   bun scripts/sync-splinter.ts --tag 2026.09.1 --remote
 *
 * Local mode reads `git show <tag>:splinter.sql` from a splinter checkout
 * (`--repo`, else `SPLINTER_REPO`, else ~/Documents/Programming/Supa/splinter).
 * `--remote` fetches raw.githubusercontent.com/supabase/splinter/<tag>/splinter.sql.
 *
 * The file is written byte for byte; `src/vendor/splinter.ts` holds each checked
 * rule's branch of it (see splinter-shape.ts), verified against the tag's
 * `lints/*.sql`. The sync fails if the shape changed or a checked rule is missing.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RULES } from "../src/policy.ts";
import {
  type LintSource,
  renderVendoredModule,
  splitSplinter,
  verifyLintSources,
} from "./splinter-shape.ts";

const { values } = parseArgs({
  options: {
    tag: { type: "string", default: "2026.09.1" },
    repo: { type: "string" },
    remote: { type: "boolean", default: false },
  },
});
const tag = values.tag;
if (!/^[0-9A-Za-z._-]+$/.test(tag)) throw new Error(`invalid tag ${tag}`);

const get = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  return response;
};

let sql: string;
let lints: LintSource[];
if (values.remote) {
  const raw = `https://raw.githubusercontent.com/supabase/splinter/${tag}`;
  sql = await (await get(`${raw}/splinter.sql`)).text();
  const listing = (await (
    await get(
      `https://api.github.com/repos/supabase/splinter/contents/lints?ref=${tag}`,
    )
  ).json()) as { name: string }[];
  lints = await Promise.all(
    listing
      .filter((entry) => entry.name.endsWith(".sql"))
      .map(async ({ name }) => ({
        file: name,
        text: await (await get(`${raw}/lints/${name}`)).text(),
      })),
  );
} else {
  const repo =
    values.repo ??
    process.env["SPLINTER_REPO"] ??
    join(homedir(), "Documents/Programming/Supa/splinter");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  sql = git("show", `${tag}:splinter.sql`);
  lints = git("ls-tree", "--name-only", tag, "lints/")
    .split("\n")
    .filter((path) => path.endsWith(".sql"))
    .map((path) => ({
      file: path.slice("lints/".length),
      text: git("show", `${tag}:${path}`),
    }));
}

const shape = splitSplinter(sql);
verifyLintSources(shape, lints);
const problems = RULES.flatMap((rule) => {
  const found = shape.rules.find((r) => r.name === rule);
  if (found === undefined) return [`rule ${rule} is missing`];
  if (!found.categories.includes("SECURITY"))
    return [`rule ${rule} is not SECURITY`];
  if (found.readsSplinterSettings) {
    return [
      `rule ${rule} reads splinter.* settings; the check block must run the preamble`,
    ];
  }
  return [];
});
if (problems.length > 0) {
  throw new Error(
    `splinter ${tag} cannot be vendored:\n  ${problems.join("\n  ")}`,
  );
}

const vendorDir = join(import.meta.dir, "..", "src", "vendor");
writeFileSync(join(vendorDir, "splinter.sql"), sql);
writeFileSync(
  join(vendorDir, "splinter.ts"),
  renderVendoredModule(sql, tag, RULES),
);
console.log(
  `vendored splinter ${tag}: ${shape.rules.length} rules (= lints/*.sql), ${sql.length} bytes, ${RULES.length} checked`,
);
