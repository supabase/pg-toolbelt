/** Corpus loader (stage 0): one directory per scenario, a.sql + b.sql. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ScenarioMeta {
  /** Cluster-level state differs (roles/memberships/default privileges):
   *  each side gets its own freshly started cluster. */
  isolatedCluster?: boolean;
  /** Minimum PostgreSQL major version this scenario's DDL needs. */
  minVersion?: number;
}

export interface Scenario {
  name: string;
  a: string;
  b: string;
  seed?: string;
  meta: ScenarioMeta;
}

const CORPUS_DIR = new URL("../corpus", import.meta.url).pathname;

export function loadCorpus(): Scenario[] {
  return readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(CORPUS_DIR, entry.name);
      const seedPath = join(dir, "seed.sql");
      const metaPath = join(dir, "meta.json");
      return {
        name: entry.name,
        a: readFileSync(join(dir, "a.sql"), "utf8"),
        b: readFileSync(join(dir, "b.sql"), "utf8"),
        ...(existsSync(seedPath)
          ? { seed: readFileSync(seedPath, "utf8") }
          : {}),
        meta: existsSync(metaPath)
          ? (JSON.parse(readFileSync(metaPath, "utf8")) as ScenarioMeta)
          : {},
      };
    })
    .sort((x, y) => (x.name < y.name ? -1 : 1));
}
