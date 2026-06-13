/**
 * drift --env <pg-url> --snapshot <file>
 * Diff the live environment against a saved snapshot.
 * Exit 0 = no drift; exit 1 = drift found.
 * Stage-9 deliverable 7.
 */
import { diff } from "../../core/diff.ts";
import { encodeId } from "../../core/stable-id.ts";
import { extract } from "../../extract/extract.ts";
import { loadSnapshot } from "../../frontends/snapshot-file.ts";
import { makePool } from "../pool.ts";

export async function cmdDrift(args: string[]): Promise<void> {
  let envUrl: string | undefined;
  let snapshotPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]) {
      envUrl = args[++i];
    } else if (args[i] === "--snapshot" && args[i + 1]) {
      snapshotPath = args[++i];
    }
  }

  if (!envUrl || !snapshotPath) {
    process.stderr.write(
      "Usage: pg-delta-next drift --env <pg-url> --snapshot <file>\n",
    );
    process.exit(2);
  }

  const env = makePool(envUrl);
  try {
    const { factBase: snapshotFb, pgVersion: snapshotPgVersion } =
      loadSnapshot(snapshotPath);
    process.stderr.write(
      `Snapshot: ${snapshotFb.facts().length} facts (pg ${snapshotPgVersion})\n`,
    );

    process.stderr.write("Extracting live environment...\n");
    const { factBase: liveFb, pgVersion: livePgVersion } = await extract(
      env.pool,
    );
    process.stderr.write(
      `Live: ${liveFb.facts().length} facts (pg ${livePgVersion})\n`,
    );

    // diff(snapshot, live): adds = live has extra, removes = live is missing
    const deltas = diff(snapshotFb, liveFb);

    if (deltas.length === 0) {
      process.stdout.write("No drift detected.\n");
      process.exit(0);
    }

    process.stdout.write(`Drift detected: ${deltas.length} delta(s)\n\n`);
    for (const d of deltas) {
      let line: string;
      switch (d.verb) {
        case "add":
          line = `+ ${encodeId(d.fact.id)}`;
          break;
        case "remove":
          line = `- ${encodeId(d.fact.id)}`;
          break;
        case "set":
          line = `~ ${encodeId(d.id)} .${d.attr}`;
          break;
        case "link":
          line = `+ link ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`;
          break;
        case "unlink":
          line = `- link ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`;
          break;
      }
      process.stdout.write(`${line}\n`);
    }
    process.exit(1);
  } finally {
    await env.end();
  }
}
