import { Effect, Schema } from "effect";
import type { Pool } from "pg";
import { extractVersion } from "../../context.ts";
import { CatalogExtractionError } from "../../errors.ts";
import type { DatabaseApi } from "../../services/database.ts";
import { BasePgModel } from "../base.model.ts";

const subscriptionPropsSchema = Schema.mutable(
  Schema.Struct({
    name: Schema.String,
    raw_name: Schema.String,
    owner: Schema.String,
    comment: Schema.NullOr(Schema.String),
    enabled: Schema.Boolean,
    binary: Schema.Boolean,
    streaming: Schema.Literal("off", "on", "parallel"),
    two_phase: Schema.Boolean,
    disable_on_error: Schema.Boolean,
    password_required: Schema.Boolean,
    run_as_owner: Schema.Boolean,
    failover: Schema.Boolean,
    conninfo: Schema.String,
    slot_name: Schema.NullOr(Schema.String),
    slot_is_none: Schema.Boolean,
    replication_slot_created: Schema.Boolean,
    synchronous_commit: Schema.String,
    publications: Schema.mutable(Schema.Array(Schema.String)),
    origin: Schema.Literal("any", "none"),
  }),
);

export type SubscriptionProps = typeof subscriptionPropsSchema.Type;

export class Subscription extends BasePgModel {
  public readonly name: SubscriptionProps["name"];
  public readonly raw_name: SubscriptionProps["raw_name"];
  public readonly owner: SubscriptionProps["owner"];
  public readonly comment: SubscriptionProps["comment"];
  public readonly enabled: SubscriptionProps["enabled"];
  public readonly binary: SubscriptionProps["binary"];
  public readonly streaming: SubscriptionProps["streaming"];
  public readonly two_phase: SubscriptionProps["two_phase"];
  public readonly disable_on_error: SubscriptionProps["disable_on_error"];
  public readonly password_required: SubscriptionProps["password_required"];
  public readonly run_as_owner: SubscriptionProps["run_as_owner"];
  public readonly failover: SubscriptionProps["failover"];
  public readonly conninfo: SubscriptionProps["conninfo"];
  public readonly slot_name: SubscriptionProps["slot_name"];
  public readonly slot_is_none: SubscriptionProps["slot_is_none"];
  public readonly replication_slot_created: SubscriptionProps["replication_slot_created"];
  public readonly synchronous_commit: SubscriptionProps["synchronous_commit"];
  public readonly publications: SubscriptionProps["publications"];
  public readonly origin: SubscriptionProps["origin"];

  constructor(props: SubscriptionProps) {
    super();

    this.name = props.name;
    this.raw_name = props.raw_name;
    this.owner = props.owner;
    this.comment = props.comment;
    this.enabled = props.enabled;
    this.binary = props.binary;
    this.streaming = props.streaming;
    this.two_phase = props.two_phase;
    this.disable_on_error = props.disable_on_error;
    this.password_required = props.password_required;
    this.run_as_owner = props.run_as_owner;
    this.failover = props.failover;
    this.conninfo = props.conninfo;
    this.slot_name = props.slot_name;
    this.slot_is_none = props.slot_is_none;
    this.replication_slot_created = props.replication_slot_created;
    this.synchronous_commit = props.synchronous_commit;
    this.publications = [...props.publications].sort((a, b) =>
      a.localeCompare(b),
    );
    this.origin = props.origin;
  }

  get stableId(): `subscription:${string}` {
    return `subscription:${this.name}`;
  }

  get identityFields() {
    return {
      name: this.name,
    };
  }

  get dataFields() {
    return {
      raw_name: this.raw_name,
      owner: this.owner,
      comment: this.comment,
      enabled: this.enabled,
      binary: this.binary,
      streaming: this.streaming,
      two_phase: this.two_phase,
      disable_on_error: this.disable_on_error,
      password_required: this.password_required,
      run_as_owner: this.run_as_owner,
      failover: this.failover,
      conninfo: this.conninfo,
      slot_name: this.slot_name,
      slot_is_none: this.slot_is_none,
      replication_slot_created: this.replication_slot_created,
      synchronous_commit: this.synchronous_commit,
      publications: this.publications,
      origin: this.origin,
    };
  }
}

export async function extractSubscriptions(
  pool: Pool,
): Promise<Subscription[]> {
  const version = await extractVersion(pool);
  const isPostgres16OrGreater = version >= 160000;
  const isPostgres17OrGreater = version >= 170000;
  const isPostgres17_2OrGreater = version >= 170002; // failover added in 17.2 (170002)
  const isPostgres17_3OrGreater = version >= 170003; // origin column added in 17.3

  // Build the query dynamically based on PostgreSQL version
  const passwordRequiredExpr = isPostgres16OrGreater
    ? "s.subpasswordrequired"
    : "true";
  const runAsOwnerExpr = isPostgres17OrGreater ? "s.subrunasowner" : "false";
  const failoverExpr = isPostgres17_2OrGreater ? "s.subfailover" : "false";
  const originExpr = isPostgres17_3OrGreater
    ? "case s.suborigin when 'none' then 'none' else 'any' end"
    : "'any'";

  const queryText = `
      with extension_oids as (
        select objid
        from pg_depend d
        where d.refclassid = 'pg_extension'::regclass
          and d.classid = 'pg_subscription'::regclass
      ),
      scoped_subscriptions as (
        select s.*
        from pg_subscription s
        where s.subdbid = (select oid from pg_database where datname = current_database())
      )
      select
        quote_ident(s.subname) as name,
        s.subname::text as raw_name,
        s.subowner::regrole::text as owner,
        obj_description(s.oid, 'pg_subscription') as comment,
        s.subenabled as enabled,
        s.subbinary as binary,
        case s.substream::text
          when 'f' then 'off'
          when 't' then 'on'
          when 'p' then 'parallel'
          else 'off'
        end as streaming,
        (s.subtwophasestate <> 'd') as two_phase,
        s.subdisableonerr as disable_on_error,
        ${passwordRequiredExpr} as password_required,
        ${runAsOwnerExpr} as run_as_owner,
        ${failoverExpr} as failover,
        s.subconninfo as conninfo,
        case
          when s.subslotname is null then null
          when s.subslotname = s.subname then null
          else s.subslotname::text
        end as slot_name,
        s.subslotname is null as slot_is_none,
        (r.slot_name is not null) as replication_slot_created,
        s.subsynccommit as synchronous_commit,
        coalesce(
          (
            select json_agg(quote_ident(pub) order by quote_ident(pub))
            from unnest(s.subpublications) as pub
          ),
          '[]'::json
        ) as publications,
        ${originExpr} as origin
      from scoped_subscriptions s
      left join pg_replication_slots r
        on r.slot_name = s.subslotname
       and r.datoid = s.subdbid
      left join extension_oids e on e.objid = s.oid
      where e.objid is null
      order by s.subname
  `;

  const { rows } = await pool.query<SubscriptionProps>(queryText);

  const validated = rows.map((row) =>
    Schema.decodeUnknownSync(subscriptionPropsSchema)(row),
  );
  return validated.map((row) => new Subscription(row));
}

// ============================================================================
// Effect-native version
// ============================================================================

export const extractSubscriptionsEffect = (
  db: DatabaseApi,
): Effect.Effect<Subscription[], CatalogExtractionError> =>
  Effect.tryPromise({
    try: () => extractSubscriptions(db.getPool()),
    catch: (err) =>
      new CatalogExtractionError({
        message: `extractSubscriptions failed: ${err instanceof Error ? err.message : err}`,
        extractor: "extractSubscriptions",
        cause: err,
      }),
  });
