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
import { parseFlags, UsageError } from "../flags.ts";

export async function cmdDrift(args: string[]): Promise<void> {
  let parsed;
  try {
    parsed = parseFlags(args, {
      env: { type: "value", required: true },
      snapshot: { type: "value", required: true },
    });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(
        `${err.message}\nUsage: pg-delta-next drift --env <pg-url> --snapshot <file>\n`,
      );
      process.exit(2);
    }
    throw err;
  }

  const { flags } = parsed;
  const envUrl = flags["env"];
  const snapshotPath = flags["snapshot"];

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
