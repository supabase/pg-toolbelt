import type { PGClient } from "../../types.ts";
import type { SequenceDefinition } from "./types.ts";

export async function extractSequenceDefinitions(
  db: PGClient,
): Promise<SequenceDefinition[]> {
  const sequences = await db.sql<SequenceDefinition>`
    select 
      n.nspname || '.' || c.relname as id,
      n.nspname as schema_name,
      c.relname as sequence_name,
      pg_catalog.format_type(s.seqtypid, null) as data_type,
      s.seqstart as start_value,
      s.seqmin as minimum_value,
      s.seqmax as maximum_value,
      s.seqincrement as increment,
      s.seqcycle as cycle,
      s.seqcache as cache_size
    from pg_sequence s
    join pg_class c on c.oid = s.seqrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_%'
    order by n.nspname, c.relname;
  `;

  return sequences.rows;
}
