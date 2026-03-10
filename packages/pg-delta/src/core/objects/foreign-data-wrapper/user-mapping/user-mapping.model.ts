import { sql } from "@ts-safeql/sql-tag";
import { Effect, Schema } from "effect";
import type { Pool } from "pg";
import { CatalogExtractionError } from "../../../errors.ts";
import type { DatabaseApi } from "../../../services/database.ts";
import { BasePgModel } from "../../base.model.ts";

/**
 * All properties exposed by CREATE USER MAPPING statement are included in diff output.
 * https://www.postgresql.org/docs/17/sql-createusermapping.html
 *
 * ALTER USER MAPPING statement can be generated for changes to the following properties:
 *  - options
 * https://www.postgresql.org/docs/17/sql-alterusermapping.html
 *
 * User mappings are not schema-qualified (no schema property).
 * User can be a role name, CURRENT_USER, PUBLIC, etc.
 */
const userMappingPropsSchema = Schema.mutable(
  Schema.Struct({
    user: Schema.String,
    server: Schema.String,
    options: Schema.NullOr(Schema.mutable(Schema.Array(Schema.String))),
  }),
);

export type UserMappingProps = typeof userMappingPropsSchema.Type;

export class UserMapping extends BasePgModel {
  public readonly user: UserMappingProps["user"];
  public readonly server: UserMappingProps["server"];
  public readonly options: UserMappingProps["options"];

  constructor(props: UserMappingProps) {
    super();

    // Identity fields
    this.user = props.user;
    this.server = props.server;

    // Data fields
    this.options = props.options;
  }

  get stableId(): `userMapping:${string}:${string}` {
    return `userMapping:${this.server}:${this.user}`;
  }

  get identityFields() {
    return {
      user: this.user,
      server: this.server,
    };
  }

  get dataFields() {
    return {
      options: this.options,
    };
  }
}

export async function extractUserMappings(pool: Pool): Promise<UserMapping[]> {
  const { rows: mappingRows } = await pool.query<UserMappingProps>(sql`
      select
        case
          when um.umuser = 0 then 'PUBLIC'
          else um.umuser::regrole::text
        end as user,
        quote_ident(srv.srvname) as server,
        coalesce(um.umoptions, array[]::text[]) as options
      from
        pg_catalog.pg_user_mapping um
        inner join pg_catalog.pg_foreign_server srv on srv.oid = um.umserver
        inner join pg_catalog.pg_foreign_data_wrapper fdw on fdw.oid = srv.srvfdw
      where
        not fdw.fdwname like any(array['pg\\_%'])
      order by
        srv.srvname, um.umuser
  `);

  // Validate and parse each row using the schema
  const validatedRows = mappingRows.map((row: unknown) => {
    const parsed = Schema.decodeUnknownSync(userMappingPropsSchema)(row);
    // Parse options from PostgreSQL format ['key=value'] to ['key', 'value']
    let options = parsed.options;
    if (options && options.length > 0) {
      const parsedOptions: string[] = [];
      for (const opt of options) {
        const eqIndex = opt.indexOf("=");
        if (eqIndex > 0) {
          parsedOptions.push(opt.substring(0, eqIndex));
          parsedOptions.push(opt.substring(eqIndex + 1));
        }
      }
      options = parsedOptions.length > 0 ? parsedOptions : null;
    }
    return { ...parsed, options };
  });
  return validatedRows.map((row: UserMappingProps) => new UserMapping(row));
}

// ============================================================================
// Effect-native version
// ============================================================================

export const extractUserMappingsEffect = (
  db: DatabaseApi,
): Effect.Effect<UserMapping[], CatalogExtractionError> =>
  Effect.tryPromise({
    try: () => extractUserMappings(db.getPool()),
    catch: (err) =>
      new CatalogExtractionError({
        message: `extractUserMappings failed: ${err instanceof Error ? err.message : err}`,
        extractor: "extractUserMappings",
        cause: err,
      }),
  });
