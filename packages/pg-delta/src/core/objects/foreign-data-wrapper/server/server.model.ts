import { sql } from "@ts-safeql/sql-tag";
import type { Pool } from "pg";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";
import {
  type PrivilegeProps,
  privilegePropsSchema,
} from "../../base.privilege-diff.ts";

/**
 * All properties exposed by CREATE SERVER statement are included in diff output.
 * https://www.postgresql.org/docs/17/sql-createserver.html
 *
 * ALTER SERVER statement can be generated for changes to the following properties:
 *  - owner, type, version, options
 * https://www.postgresql.org/docs/17/sql-alterserver.html
 *
 * Servers are not schema-qualified (no schema property).
 */
const serverPropsSchema = z.object({
  name: z.string(),
  owner: z.string(),
  foreign_data_wrapper: z.string(),
  type: z.string().nullable(),
  version: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  comment: z.string().nullable(),
  privileges: z.array(privilegePropsSchema),
  // Parent FDW handler/validator — filter metadata only, not in dataFields.
  wrapper_handler: z.string().nullable().optional(),
  wrapper_validator: z.string().nullable().optional(),
});

type ServerPrivilegeProps = PrivilegeProps;
export type ServerProps = z.infer<typeof serverPropsSchema>;

export class Server extends BasePgModel {
  public readonly name: ServerProps["name"];
  public readonly owner: ServerProps["owner"];
  public readonly foreign_data_wrapper: ServerProps["foreign_data_wrapper"];
  public readonly type: ServerProps["type"];
  public readonly version: ServerProps["version"];
  public readonly options: ServerProps["options"];
  public readonly comment: ServerProps["comment"];
  public readonly privileges: ServerPrivilegeProps[];
  public readonly wrapper_handler: ServerProps["wrapper_handler"];
  public readonly wrapper_validator: ServerProps["wrapper_validator"];

  constructor(props: ServerProps) {
    super();

    // Identity fields
    this.name = props.name;

    // Data fields
    this.owner = props.owner;
    this.foreign_data_wrapper = props.foreign_data_wrapper;
    this.type = props.type;
    this.version = props.version;
    this.options = props.options;
    this.comment = props.comment;
    this.privileges = props.privileges;
    this.wrapper_handler = props.wrapper_handler ?? null;
    this.wrapper_validator = props.wrapper_validator ?? null;
  }

  get stableId(): `server:${string}` {
    return `server:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      owner: this.owner,
      foreign_data_wrapper: this.foreign_data_wrapper,
      type: this.type,
      version: this.version,
      options: this.options,
      comment: this.comment,
      privileges: this.privileges,
    };
  }
}

/**
 * Extract `pg_foreign_server` rows into `Server` models.
 *
 * The returned models carry option values **verbatim** from
 * `pg_foreign_server.srvoptions`, which means cleartext secrets like
 * `password` are present in memory. Always route through
 * `extractCatalog` (which calls `normalizeCatalog`) before emitting
 * options to any output channel — see CLI-1467 and
 * `packages/pg-delta/src/core/objects/foreign-data-wrapper/sensitive-options.ts`.
 */
export async function extractServers(pool: Pool): Promise<Server[]> {
  const { rows: serverRows } = await pool.query<ServerProps>(sql`
      select
        quote_ident(srv.srvname) as name,
        srv.srvowner::regrole::text as owner,
        quote_ident(fdw.fdwname) as foreign_data_wrapper,
        srv.srvtype as type,
        srv.srvversion as version,
        coalesce(srv.srvoptions, array[]::text[]) as options,
        obj_description(srv.oid, 'pg_foreign_server') as comment,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                'privilege', x.privilege_type,
                'grantable', x.is_grantable
              )
              order by x.grantee, x.privilege_type
            )
            from lateral aclexplode(srv.srvacl) as x(grantor, grantee, privilege_type, is_grantable)
          ), '[]'
        ) as privileges,
        case
          when fdw.fdwhandler = 0 then null
          else p_handler.pronamespace::regnamespace::text || '.' || quote_ident(p_handler.proname)
        end as wrapper_handler,
        case
          when fdw.fdwvalidator = 0 then null
          else p_validator.pronamespace::regnamespace::text || '.' || quote_ident(p_validator.proname)
        end as wrapper_validator
      from
        pg_catalog.pg_foreign_server srv
        inner join pg_catalog.pg_foreign_data_wrapper fdw on fdw.oid = srv.srvfdw
        left join pg_catalog.pg_proc p_handler on p_handler.oid = fdw.fdwhandler
        left join pg_catalog.pg_proc p_validator on p_validator.oid = fdw.fdwvalidator
      where
        not fdw.fdwname like any(array['pg\\_%'])
      order by
        srv.srvname
  `);

  // Validate and parse each row using the Zod schema
  const validatedRows = serverRows.map((row: unknown) => {
    const parsed = serverPropsSchema.parse(row);
    // Parse options from PostgreSQL format ['key=value'] to ['key', 'value']
    if (parsed.options && parsed.options.length > 0) {
      const parsedOptions: string[] = [];
      for (const opt of parsed.options) {
        const eqIndex = opt.indexOf("=");
        if (eqIndex > 0) {
          parsedOptions.push(opt.substring(0, eqIndex));
          parsedOptions.push(opt.substring(eqIndex + 1));
        }
      }
      parsed.options = parsedOptions.length > 0 ? parsedOptions : null;
    }
    return parsed;
  });
  return validatedRows.map((row: ServerProps) => new Server(row));
}
