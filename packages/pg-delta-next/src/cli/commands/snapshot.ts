/**
 * snapshot --source <pg-url> --out <file>
 * Extract from the source database and write a snapshot file.
 * Replaces the old `catalog-export` command.
 */
import { extract } from "../../extract/extract.ts";
import { saveSnapshot } from "../../frontends/snapshot-file.ts";
import { makePool } from "../pool.ts";

export async function cmdSnapshot(args: string[]): Promise<void> {
  let sourceUrl: string | undefined;
  let outPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      sourceUrl = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[++i];
    }
  }

  if (!sourceUrl || !outPath) {
    process.stderr.write(
      "Usage: pg-delta-next snapshot --source <pg-url> --out <file>\n",
    );
    process.exit(2);
  }

  const src = makePool(sourceUrl);
  try {
    process.stderr.write("Extracting...\n");
    const { factBase, pgVersion } = await extract(src.pool);
    saveSnapshot(factBase, pgVersion, outPath);
    process.stderr.write(
      `Snapshot saved to ${outPath} (${factBase.facts().length} facts, pg ${pgVersion})\n`,
    );
  } finally {
    await src.end();
  }
}
