// JSON-lines worker: {"sql": string[], "mode"?: "files"|"validate"} -> result
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeAndSort,
  analyzeAndSortFromFiles,
  validateSqlSyntax,
} from "../../packages/pg-topo/src/index.ts";

const tmpRoot = join(import.meta.dir, ".files", String(process.pid));
let seq = 0;
const key = (id: { filePath: string; statementIndex: number }) =>
  `${id.filePath}#${id.statementIndex}`;

const decoder = new TextDecoder();
let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let out: unknown;
    try {
      const req = JSON.parse(line) as {
        sql: string[];
        mode?: string;
        options?: Parameters<typeof analyzeAndSort>[1];
      };
      if (process.env.PGTOPO_CORPUS)
        appendFileSync(
          process.env.PGTOPO_CORPUS,
          `${JSON.stringify({ mode: req.mode ?? "strings", sql: req.sql, options: req.options ?? undefined })}\n`,
        );
      if (req.mode === "validate") {
        const errors: string[] = [];
        for (const s of req.sql) {
          try {
            await validateSqlSyntax(s);
          } catch (e) {
            errors.push(`${String(e)} :: ${s}`);
          }
        }
        out = {
          ok: true,
          ordered: [],
          diagnostics: errors.map((m) => ({ code: "VALIDATE", message: m })),
        };
      } else {
        let r;
        let dir = "";
        if (req.mode === "files") {
          dir = join(tmpRoot, String(seq++));
          mkdirSync(join(dir, "sub"), { recursive: true });
          // nest every other file to exercise discovery recursion
          req.sql.forEach((s, i) =>
            writeFileSync(
              join(
                dir,
                i % 2 ? "sub" : "",
                `${String(i).padStart(4, "0")}.sql`,
              ),
              s,
            ),
          );
          r = await analyzeAndSortFromFiles([dir], req.options);
        } else {
          r = await analyzeAndSort(req.sql, req.options);
        }
        const sqlOf = new Map(r.ordered.map((s) => [key(s.id), s.sql]));
        out = {
          ok: true,
          ordered: r.ordered.map((s) => ({
            sql: s.sql,
            file: s.id.filePath,
            index: s.id.statementIndex,
            cls: s.statementClass,
            provides: s.provides.map((p) => ({
              kind: p.kind,
              schema: p.schema ?? null,
              name: p.name,
              signature: p.signature ?? null,
            })),
          })),
          diagnostics: r.diagnostics.map((d) => ({
            code: d.code,
            message: d.message,
          })),
          edges: r.graph.edges.map((e) => [
            sqlOf.get(key(e.from)) ?? `?${key(e.from)}`,
            sqlOf.get(key(e.to)) ?? `?${key(e.to)}`,
          ]),
          cycles: r.graph.cycleGroups.map((g) =>
            g.map((id) => sqlOf.get(key(id)) ?? `?${key(id)}`),
          ),
        };
        if (dir) rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      out = { ok: false, error: String((e as Error)?.stack ?? e) };
    }
    process.stdout.write(`${JSON.stringify(out)}\n`);
  }
}
