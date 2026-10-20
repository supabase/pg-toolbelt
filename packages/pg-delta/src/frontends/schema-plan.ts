/**
 * Library frontend: plan declarative SQL files against a live target using a
 * supplied shadow pool. No argv / stdout / process.exit — callers own both
 * pools (`pool.end()`) and any co-located shadow cleanup.
 */
import type { Pool } from "pg";
import type { ApplyOptions } from "../apply/apply.ts";
import { connectWithErrorListener } from "../pg-client.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import type { FactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import {
  isSameDatabase,
  isSamePostgresLineage,
  observeDatabaseIdentityForMutation,
} from "../database-identity.ts";
import type { ExtractOptions, ExtractResult } from "../extract/extract.ts";
import {
  detectUnmodeledDrift,
  probeUnmodeledIdentities,
  type UnmodeledIdentities,
} from "../extract/unmodeled.ts";
import {
  type IntegrationProfile,
  resolveProfile,
  type ResolveProfileOptions,
  type ResolvedProfile,
} from "../integrations/profile.ts";
import { plan, type Plan, type PlanOptions } from "../plan/plan.ts";
import { qid, splitOption } from "../plan/render.ts";
import type { RenameMode } from "../plan/renames.ts";
import {
  factMatches,
  type FilterRule,
  flattenPolicy,
  isManagedRoleSetting,
  type ManagedRoleSettings,
  type Policy,
  resolveView,
} from "../policy/policy.ts";
import type { ManagementScope } from "../policy/view.ts";
import { planSubjects, settleDesired } from "./settle-desired.ts";
import { scanTokens } from "./sql-format/tokenizer.ts";
import type { ExportManifest } from "./export-manifest.ts";
import {
  findClusterDdlStatements,
  findDefaultPrivilegeStatements,
  findMatchingStatements,
  loadSqlFiles,
  resolveReorderOnFailure,
  ShadowLoadError,
  stripClusterDdl,
  type SqlFile,
} from "./load-sql-files.ts";
import { applyManifestLoadOrder } from "./export-manifest.ts";
import { deriveAssumedSchemaSeed } from "./seed-assumed-schemas.ts";
import {
  analyzeForShadow,
  attachReorderPredecessors,
  classesByFileFromAnalyzed,
  preorderFilesByKind,
  ReorderUnavailableError,
  splitAndReorderFile,
  type OrderedSqlFile,
  type ShadowLoadCycle,
} from "./sql-order.ts";

/**
 * {@link probeUnmodeledIdentities}, pinned to the SAME canonical search_path
 * extraction uses (`extract.ts`: `SET LOCAL search_path TO 'pg_catalog'`).
 *
 * The probes' catalog references (`src/extract/unmodeled.ts`, `PROBES[].from`)
 * are UNQUALIFIED — e.g. `FROM pg_cast c`. Run pool-level, that resolves via
 * whatever default `search_path` the connecting role/database has. A target
 * with `search_path = app, pg_catalog` and a user relation named `app.pg_cast`
 * makes `pg_cast` resolve to the user table FIRST (Postgres searches an
 * EXPLICITLY listed `pg_catalog` in the stated position, not implicitly
 * first) — so the probe reads the wrong relation, either erroring on missing
 * columns or silently reporting nonsense identities. Extraction already pins
 * its path for exactly this reason; the drift probe must match it, via a
 * short, dedicated transaction so the pool's OTHER borrowers keep their own
 * default path (`SET LOCAL` is discarded on COMMIT/ROLLBACK).
 *
 * @param major - The server's PostgreSQL major version (e.g. `17`); it selects
 * which version-gated probes run. `ExtractResult.pgVersion` /
 * `LoadResult.pgVersion` carry `server_version`, so
 * `Number.parseInt(result.pgVersion, 10)` is the usual source (handles
 * `"17.5"` and `"18beta1"` alike).
 */
export async function probeUnmodeledIdentitiesPinned(
  pool: Pool,
  major: number,
): Promise<UnmodeledIdentities> {
  const client = await connectWithErrorListener(pool);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO pg_catalog");
    const result = await probeUnmodeledIdentities(client, major);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** The {@link findClusterDdlStatements} label of `ALTER ROLE|USER|GROUP`. */
const ALTER_ROLE_LABEL = "ALTER ROLE";

export class SchemaFrontendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaFrontendError";
  }
}

/** Discriminated result of {@link prepareSchemaFiles}. */
export type PreparedSchemaFiles =
  | {
      ok: true;
      files: SqlFile[];
      skipped: { file: string; stmt: string }[];
      warnings: string[];
    }
  | { ok: false; message: string };

export interface PrepareSchemaFilesOptions {
  scope: ManagementScope;
  skipClusterDdl?: boolean;
  /** The profile policy's flattened `managedRoleSettings`. With
   *  `isolatedShadow`, `ALTER ROLE` statements are let into the shadow, where
   *  {@link planSchemaFiles} checks in the catalog that they changed only these. */
  managedRoleSettings?: readonly ManagedRoleSettings[];
  isolatedShadow?: boolean;
  /** The export manifest's `roleSettingsFiles`. In database scope they are
   *  dropped whole without an isolated shadow, and keep their `ALTER ROLE`
   *  statements under `skipClusterDdl`. */
  roleSettingsFiles?: readonly string[];
  /** Label used in refusal messages (e.g. a directory path). */
  label?: string;
}

/**
 * Validate declarative SQL files for planning: refuse empty/comment-only input
 * (would build an empty shadow and drop-all) and enforce the database-scope
 * cluster-DDL policy.
 */
export function prepareSchemaFiles(
  input: SqlFile[],
  options: PrepareSchemaFilesOptions,
): PreparedSchemaFiles {
  const label = options.label ?? "input";
  const skipClusterDdl = options.skipClusterDdl === true;
  const isolatedShadow = options.isolatedShadow === true;
  const managesRoleSettings = (options.managedRoleSettings ?? []).length > 0;
  const settingsFiles = new Set(
    managesRoleSettings ? (options.roleSettingsFiles ?? []) : [],
  );
  const isSettingsFile = (f: SqlFile): boolean =>
    settingsFiles.has(f.name.split(/[\\/]/).join("/"));
  let files = input;
  const warnings: string[] = [];
  if (options.scope === "database" && !isolatedShadow) {
    for (const f of files.filter(isSettingsFile)) {
      warnings.push(
        `skipped ${f.name}: it holds the export's role settings (ALTER ROLE … SET), which database scope manages only against an isolated shadow.`,
      );
    }
    files = files.filter((f) => !isSettingsFile(f));
  }
  const hasExecutableSql = (fs: SqlFile[]): boolean =>
    fs.some((f) => scanTokens(f.sql).length > 0);

  if (!hasExecutableSql(files)) {
    return {
      ok: false,
      message: `no executable SQL found under ${label} (${files.length} file(s), all missing/empty/comment-only). Refusing to apply an empty desired state (it would drop every managed object on the target).`,
    };
  }

  const skipped: { file: string; stmt: string }[] = [];
  if (options.scope === "database") {
    const keepLabels = (f: SqlFile): string[] =>
      managesRoleSettings &&
      isolatedShadow &&
      (!skipClusterDdl || isSettingsFile(f))
        ? [ALTER_ROLE_LABEL]
        : [];
    const offenders = files
      .map((f) => ({
        name: f.name,
        labels: findClusterDdlStatements(f.sql).filter(
          (label) => !keepLabels(f).includes(label),
        ),
      }))
      .filter((x) => x.labels.length > 0);
    if (offenders.length > 0) {
      if (!skipClusterDdl) {
        const detail = offenders
          .map(({ name, labels }) => `  ${name}: ${labels.join(", ")}`)
          .join("\n");
        const hint =
          managesRoleSettings &&
          offenders.some((o) => o.labels.includes(ALTER_ROLE_LABEL))
            ? `\nThe profile manages role settings (ALTER ROLE … SET) in database scope only against an isolated shadow.`
            : "";
        return {
          ok: false,
          message:
            `scope database does not manage cluster-global roles, but found cluster DDL:\n${detail}\n` +
            `Use scope cluster (with an isolated shadow) to manage roles, or skipClusterDdl to skip these statements.${hint}`,
        };
      }
      files = files.map((f) => {
        const { kept, skipped: sk } = stripClusterDdl(f.sql, keepLabels(f));
        for (const s of sk) {
          skipped.push({ file: f.name, stmt: s.split("\n")[0] ?? "" });
        }
        return { ...f, sql: kept };
      });
      if (!hasExecutableSql(files)) {
        return {
          ok: false,
          message: `after skipClusterDdl, no executable database-scope SQL remains under ${label}. Refusing to apply an empty desired state (it would drop every managed object on the target).`,
        };
      }
    }
  }
  return { ok: true, files, skipped, warnings };
}

export interface ReconcileSchemaManifestFlags {
  profileId?: string;
  scope?: ManagementScope;
  redactSecrets?: boolean;
  /** Digest the caller's resolved profile will subtract; compared to the
   *  manifest when both are present. Pass the key (even as `undefined`) to
   *  enable the baseline check after profile resolution. */
  baselineDigest?: string | undefined;
}

export interface ReconciledSchemaOptions {
  profileId: string | undefined;
  scope: ManagementScope;
  redactSecrets: boolean;
  baselineDigest: string | undefined;
  defaultOwner: string | null | undefined;
}

/**
 * Reconcile caller flags with an export manifest. Fail closed on any
 * contradiction (profile, scope, redaction, baseline). When a flag is omitted,
 * the manifest value (if any) wins; otherwise defaults apply (scope=database,
 * redactSecrets=true).
 */
export function reconcileSchemaManifest(
  manifest: ExportManifest | undefined,
  flags: ReconcileSchemaManifestFlags,
): ReconciledSchemaOptions {
  // profile
  if (
    flags.profileId !== undefined &&
    manifest?.profile !== undefined &&
    flags.profileId !== manifest.profile
  ) {
    throw new SchemaFrontendError(
      `profile "${flags.profileId}" contradicts the export manifest profile (${manifest.profile}); re-export or drop the profile override.`,
    );
  }
  const profileId = flags.profileId ?? manifest?.profile;

  // scope
  if (
    flags.scope !== undefined &&
    manifest?.scope !== undefined &&
    flags.scope !== manifest.scope
  ) {
    throw new SchemaFrontendError(
      `scope ${flags.scope} contradicts the export manifest scope (${manifest.scope}); re-export or drop the scope override.`,
    );
  }
  const scope: ManagementScope = flags.scope ?? manifest?.scope ?? "database";

  // redaction — fail closed when both sides disagree
  if (
    flags.redactSecrets !== undefined &&
    manifest?.redactSecrets !== undefined &&
    flags.redactSecrets !== manifest.redactSecrets
  ) {
    throw new SchemaFrontendError(
      `redactSecrets=${flags.redactSecrets} contradicts the export manifest (redactSecrets=${manifest.redactSecrets}); re-export or drop the redaction override.`,
    );
  }
  const redactSecrets = flags.redactSecrets ?? manifest?.redactSecrets ?? true;

  // baseline — only when the caller supplies a resolved digest to check
  // (`"baselineDigest" in flags`). The pre-resolve pass omits the key so a
  // stamped digest is not treated as "profile declares none".
  if (manifest !== undefined && "baselineDigest" in flags) {
    const stamped = manifest.baselineDigest;
    const resolved = flags.baselineDigest;
    if (stamped !== resolved) {
      if (stamped !== undefined && resolved !== undefined) {
        throw new SchemaFrontendError(
          `baseline mismatch: the export manifest was produced with baseline digest ${stamped.slice(0, 12)} ` +
            `but the profile now resolves to ${resolved.slice(0, 12)}.`,
        );
      }
      if (stamped !== undefined) {
        throw new SchemaFrontendError(
          `baseline mismatch: the export manifest was produced with baseline digest ${stamped.slice(0, 12)} ` +
            `but the profile now declares NO baseline.`,
        );
      }
      throw new SchemaFrontendError(
        `baseline mismatch: the profile declares a baseline (digest ${resolved?.slice(0, 12)}) but the export manifest ` +
          `was produced with NONE.`,
      );
    }
  }

  return {
    profileId,
    scope,
    redactSecrets,
    baselineDigest: manifest?.baselineDigest ?? flags.baselineDigest,
    defaultOwner: manifest?.defaultOwner,
  };
}

export interface PlanSchemaFilesOptions {
  profile: IntegrationProfile;
  /** Explicit scope; reconciled against manifest when both are set. Default: manifest or `"database"`. */
  scope?: ManagementScope;
  /** Export manifest from the directory (or buildSchemaExport). */
  manifest?: ExportManifest;
  redactSecrets?: boolean;
  skipClusterDdl?: boolean;
  /** Load mode: dedicated cluster allows role DDL. Default: false (databaseScratch). */
  isolatedShadow?: boolean;
  /** Seed assumed-schema objects into a co-located (fresh) shadow before load. */
  seedAssumedSchemas?: boolean;
  renames?: RenameMode;
  acceptRenames?: Array<{ from: StableId; to: StableId }>;
  resolveOptions?: Omit<ResolveProfileOptions, "redactSecrets">;
  strictFunctionBodies?: boolean;
  /** Exempt managed tables that already held rows before the shadow load from the
   *  DML observation. Left undefined the loader picks its own default (true for an
   *  isolated shadow, which may be pre-provisioned by a platform). */
  allowPreExistingRows?: boolean;
  /** Make the shadow load's DML observation fatal again (default: warning). */
  strictDataStatements?: boolean;
  /** Proceed when the shadow and the target observe the SAME database identity
   *  (system identifier + database OID) instead of refusing. Physical clones —
   *  a warm shadow cache restored from a PGDATA snapshot of the target cluster —
   *  inherit both, so a genuinely separate shadow server is indistinguishable
   *  from the target here. Off by default; when it is on and the identities do
   *  match, the bypass is reported through {@link PlanSchemaFilesOptions.onWarning}.
   *  A no-op when the identities differ.
   *
   *  For that same exact-identity match, this also exempts the `isolatedShadow`
   *  / cluster-scope PostgreSQL lineage containment check below — a physical
   *  clone shares the target's lineage by construction, so the lineage guard
   *  would otherwise reject the very case this option exists to allow. It does
   *  NOT exempt a same-lineage sibling database (same system identifier,
   *  different database OID); that case still fails `isSameDatabase()` and the
   *  lineage guard still refuses it. */
  allowSameDatabaseIdentity?: boolean;
  /** After default order (and reconnect) stick, allow file-kind then
   *  statement-kind. Default true. Same switch as {@link reorder}. */
  reorderOnFailure?: boolean;
  /** Statement-reorder assist. Default: true. Alias of {@link reorderOnFailure}. */
  reorder?: boolean;
  /** Forwarded to {@link loadSqlFiles}. Default: reconnect-on-stuck. */
  connectionReuse?: "keep" | "reconnect-on-stuck";
  /** Forwarded to {@link loadSqlFiles}. Default: true (per-statement fallback
   *  after a file-atomic failure). `false` restores whole-file rollback. */
  statementFallback?: boolean;
  /** Soft warnings (reorder fallback, ADP caveat, …). */
  onWarning?: (message: string) => void;
  /** Optional rewrite of a ShadowLoadError after reorder (CLI attaches file:line). */
  onShadowLoadError?: (
    error: ShadowLoadError,
    ctx: {
      orderedFiles: OrderedSqlFile[] | null;
      cycles: ShadowLoadCycle[];
      originalSqlByName: Map<string, string>;
    },
  ) => Error;
}

/** `policy` and its `extends` chain without `managedRoleSettings`. */
function withoutManagedRoleSettings(policy: Policy): Policy {
  const { managedRoleSettings: _dropped, ...rest } = policy;
  return rest.extends === undefined
    ? rest
    : { ...rest, extends: rest.extends.map(withoutManagedRoleSettings) };
}

/** The attributes, comment, and settings (in any database) of the cluster's
 *  roles, or of `roles` only, as subject → state, except the role-wide
 *  settings in `settings`, returned as `managed`. A subject never carries a
 *  setting value. `pg_roles.rolpassword` is always masked, so a password
 *  change does not show. */
async function roleState(
  pool: Pool,
  settings: readonly ManagedRoleSettings[],
  roles?: ReadonlySet<string>,
): Promise<{
  roles: Set<string>;
  state: Map<string, string>;
  managed: { role: string; name: string }[];
}> {
  const { rows } = await pool.query<{
    role: string;
    db: string | null;
    name: string | null;
    state: string;
  }>(`
    SELECT r.rolname::text AS role, NULL::text AS db, NULL::text AS name,
           (pg_catalog.to_jsonb(r) - 'oid' - 'rolconfig'
             || pg_catalog.jsonb_build_object('comment', pg_catalog.shobj_description(r.oid, 'pg_authid')))::text AS state
    FROM pg_catalog.pg_roles r
    UNION ALL
    SELECT r.rolname, d.datname, pg_catalog.split_part(cfg, '=', 1), cfg
    FROM pg_catalog.pg_db_role_setting s
    JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
    LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase,
    LATERAL pg_catalog.unnest(s.setconfig) AS cfg`);
  const q = JSON.stringify;
  const seen = new Set<string>();
  const state = new Map<string, string>();
  const managed: { role: string; name: string }[] = [];
  for (const { role, db, name, state: value } of rows) {
    if (roles !== undefined && !roles.has(role)) continue;
    seen.add(role);
    if (name === null) {
      state.set(`role ${q(role)}`, value);
    } else if (db === null && isManagedRoleSetting(settings, role, name)) {
      managed.push({ role, name });
    } else {
      const where = db === null ? "" : ` in database ${q(db)}`;
      state.set(`role ${q(role)} setting ${q(name)}${where}`, value);
    }
  }
  return { roles: seen, state, managed };
}

/** `current_setting('server_version')` → major (`"17.5"` → 17, `"18beta1"` → 18).
 *  Both `ExtractResult.pgVersion` and `LoadResult.pgVersion` carry that string,
 *  so the drift probe reuses versions already round-tripped rather than asking
 *  each server again. */
function majorOf(pgVersion: string): number {
  return Number.parseInt(pgVersion, 10);
}

export interface PlanSchemaFilesResult {
  plan: Plan;
  loadDiagnostics: Diagnostic[];
  targetDiagnostics: Diagnostic[];
  /**
   * `unmodeled_drift` warnings: unmodeled objects the loaded shadow (desired
   * state) has and the target lacks (docs/architecture/custom-folder.md §7).
   * Unmodeled kinds produce no facts, so the plan can never create them — a
   * planned statement depending on one FAILS on the target. Kept separate from
   * {@link PlanSchemaFilesResult.targetDiagnostics} because this is a comparison
   * of two databases, not the output of extracting either one; a CLI-like
   * frontend should print and gate it alongside the other two sets.
   */
  driftDiagnostics: Diagnostic[];
  skipped: { file: string; stmt: string }[];
  /** Raw target extract used to produce `plan`. Pass to `apply()` as
   *  `sourceFactBase` when the caller still holds exclusive write access
   *  (same-process `schema apply`). The caller is asserting nothing else
   *  wrote between this extract and apply. */
  targetFactBase: FactBase;
  /** Same resolved profile bundles for a subsequent `apply()`. */
  applyOptions: ApplyOptions;
  planOptions: PlanOptions;
  extract: (pool: Pool, options?: ExtractOptions) => Promise<ExtractResult>;
  /** Resolved default owner under database scope (undefined = verbose / N/A). */
  defaultOwner?: string;
  scope: ManagementScope;
  redactSecrets: boolean;
  /** The resolved profile (handlers, baseline meta, …). */
  profile: ResolvedProfile;
}

/**
 * Plan declarative SQL files against a target using a supplied shadow pool.
 * Does not apply and does not end either pool.
 */
export async function planSchemaFiles(
  targetPool: Pool,
  shadowPool: Pool,
  inputFiles: SqlFile[],
  options: PlanSchemaFilesOptions,
): Promise<PlanSchemaFilesResult> {
  // First-pass reconcile without baseline (profile not resolved yet).
  const pre = reconcileSchemaManifest(options.manifest, {
    profileId: options.profile.id,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.redactSecrets !== undefined
      ? { redactSecrets: options.redactSecrets }
      : {}),
  });

  if (pre.scope === "cluster" && options.isolatedShadow !== true) {
    throw new SchemaFrontendError(
      "scope cluster manages cluster-global roles and must run against a dedicated shadow cluster; pass isolatedShadow: true.",
    );
  }

  const managedRoleSettings =
    options.profile.policy !== undefined
      ? flattenPolicy(options.profile.policy).managedRoleSettings
      : [];
  const prepared = prepareSchemaFiles(inputFiles, {
    scope: pre.scope,
    skipClusterDdl: options.skipClusterDdl === true,
    managedRoleSettings,
    isolatedShadow: options.isolatedShadow === true,
    ...(options.manifest?.roleSettingsFiles !== undefined
      ? { roleSettingsFiles: options.manifest.roleSettingsFiles }
      : {}),
  });
  if (!prepared.ok) {
    throw new SchemaFrontendError(prepared.message);
  }
  for (const warning of prepared.warnings) options.onWarning?.(warning);
  const files = prepared.files;
  // Any ALTER ROLE left was let through on purpose (cluster scope, or managed
  // role settings against an isolated shadow).
  const declaresRoleSettings = files.some((f) =>
    findClusterDdlStatements(f.sql).includes(ALTER_ROLE_LABEL),
  );

  // This public frontend owns mutation of the supplied shadow. Observe both
  // pools before profile resolution or SQL loading so a target alias cannot be
  // used as its own shadow, and an isolation assertion cannot disable shared-
  // cluster containment on a sibling database from the target lineage.
  const targetIdentity = await observeDatabaseIdentityForMutation(
    targetPool,
    "planSchemaFiles target safety",
  );
  const shadowIdentity = await observeDatabaseIdentityForMutation(
    shadowPool,
    "planSchemaFiles shadow safety",
  );
  const sameDatabaseIdentity = isSameDatabase(targetIdentity, shadowIdentity);
  if (sameDatabaseIdentity) {
    if (options.allowSameDatabaseIdentity !== true) {
      throw new SchemaFrontendError(
        `planSchemaFiles: shadow and target are the same observed database (${targetIdentity.database}); refusing to load declarative SQL. ` +
          `A physically cloned shadow (e.g. a warm shadow cache restored from a PGDATA snapshot of the target cluster) inherits the target's ` +
          `system identifier and database OIDs and reports as the same database here; if the shadow is known to be a separate server, ` +
          `pass allowSameDatabaseIdentity: true to bypass this check`,
      );
    }
    options.onWarning?.(
      `shadow and target report the same database identity (system identifier + database OID) for "${targetIdentity.database}". ` +
        `This is expected for a physically restored/cloned shadow; the same-database safety guard was explicitly bypassed ` +
        `(allowSameDatabaseIdentity / --allow-same-database-identity), and the lineage containment checks below were exempted ` +
        `for this exact-identity match too. If the shadow is NOT a separate server, declarative SQL is being loaded into the target itself.`,
    );
  }
  // The bypass attests "my shadow is a physical clone of the target" — it exempts
  // lineage containment ONLY for that exact-identity match, never for a same-lineage
  // sibling database (same systemIdentifier, different databaseOid), which is a
  // genuinely different database on the same cluster and must still be refused.
  const trustedCloneBypass =
    options.allowSameDatabaseIdentity === true && sameDatabaseIdentity;
  if (
    options.isolatedShadow === true &&
    isSamePostgresLineage(targetIdentity, shadowIdentity) &&
    !trustedCloneBypass
  ) {
    throw new SchemaFrontendError(
      "planSchemaFiles: an isolated shadow requires a different PostgreSQL lineage; the supplied shadow shares the target lineage " +
        "(same-lineage sibling databases are not covered by allowSameDatabaseIdentity)",
    );
  }

  const redactSecrets = pre.redactSecrets;
  const ctx = await resolveProfile(targetPool, options.profile, {
    ...options.resolveOptions,
    redactSecrets,
  });

  // Second-pass: baseline digest now known.
  reconcileSchemaManifest(options.manifest, {
    profileId: options.profile.id,
    scope: pre.scope,
    redactSecrets,
    baselineDigest: ctx.baseline?.digest,
  });

  const scope = pre.scope;

  // Default owner (database scope): stamped role must match target connection.
  let applyDefaultOwner: string | undefined;
  if (scope === "database") {
    const mdo = options.manifest?.defaultOwner;
    if (typeof mdo === "string") {
      const cu = (
        await targetPool.query<{ u: string }>(`SELECT current_user AS u`)
      ).rows[0]?.u;
      if (cu !== mdo) {
        throw new SchemaFrontendError(
          `the export's default owner "${mdo}" does not match the target ` +
            `connection role "${cu}". Objects the export left implicitly owned by "${mdo}" ` +
            `would reload owned by "${cu}", producing spurious ownership drift.`,
        );
      }
      const scu = (
        await shadowPool.query<{ u: string }>(`SELECT current_user AS u`)
      ).rows[0]?.u;
      if (scu !== mdo) {
        throw new SchemaFrontendError(
          `the export's default owner "${mdo}" does not match the shadow ` +
            `connection role "${scu}". Objects the export left implicitly owned by "${mdo}" ` +
            `would load into the shadow owned by "${scu}", producing spurious ownership drift.`,
        );
      }
      applyDefaultOwner = mdo;
    } else {
      // null (verbose) or absent (pre-feature / hand-authored): no suppression.
      applyDefaultOwner = undefined;
      if (mdo === undefined && options.manifest !== undefined) {
        // manifest present but field absent — note only when we have a manifest
        // without the field (pre-feature). Hand-authored (no manifest) is silent.
        if (!("defaultOwner" in options.manifest)) {
          options.onWarning?.(
            "the directory records no default owner, so it is applied verbose " +
              "(all ownership honored as written). Re-export with the current pg-delta to " +
              "record a default owner.",
          );
        }
      }
    }
  }

  // Extension shadow precheck
  for (const handler of ctx.handlers) {
    const precheck = handler.shadowPrecheck;
    if (precheck === undefined) continue;
    const matched = files.filter(
      (f) =>
        findMatchingStatements(f.sql, (s) => precheck.matchesStatement(s))
          .length > 0,
    );
    if (matched.length === 0) continue;
    const verdict = await precheck.capable((sql) =>
      shadowPool.query(sql).then((r) => r.rows),
    );
    if (!verdict.capable) {
      throw new SchemaFrontendError(
        `${matched.length} file(s) contain ${handler.extension} statements ` +
          `(${matched.map((f) => f.name).join(", ")}) but the shadow database cannot ` +
          `execute them: ${verdict.reason}.`,
      );
    }
  }

  const targetResult = await ctx.extract(targetPool, { redactSecrets });

  // Only an isolated shadow may load and reset managed role settings. Any other
  // shadow holds its cluster's own values (the target's, for a co-located one),
  // so the plan leaves them unmanaged instead of diffing against those. So do
  // files that neither declare one nor come from an export that records them:
  // an older export never wrote them, and must not plan their RESET.
  const managesRoleSettings =
    managedRoleSettings.length > 0 &&
    options.isolatedShadow === true &&
    (options.manifest?.roleSettingsFiles !== undefined || declaresRoleSettings);
  const unmanagedRoleSettings =
    managedRoleSettings.length > 0 && !managesRoleSettings;
  if (unmanagedRoleSettings) {
    const masked: string[] = [];
    for (const fact of targetResult.factBase.facts()) {
      const config = fact.payload["config"];
      if (fact.id.kind !== "role" || !Array.isArray(config)) continue;
      const role = fact.id.name;
      const names = (config as string[])
        .map((entry) => splitOption(entry)[0])
        .filter((name) =>
          isManagedRoleSetting(managedRoleSettings, role, name),
        );
      if (names.length > 0) masked.push(`${role}: ${names.join(", ")}`);
    }
    if (masked.length > 0) {
      const [why, remedy] =
        options.isolatedShadow === true
          ? [
              "the files declare none and the export manifest does not record them",
              "Re-export with the current pg-delta to manage them.",
            ]
          : [
              "the shadow is not isolated",
              "Plan against an isolated shadow (isolatedShadow: true) to manage them.",
            ];
      options.onWarning?.(
        `the target has role settings the profile manages (${masked.join("; ")}), but ${why}, ` +
          `so they are left unmanaged: the plan neither sets nor resets them. ${remedy}`,
      );
    }
  }

  const assumedTargetRoles =
    scope === "database"
      ? targetResult.factBase
          .facts()
          .filter((f) => f.id.kind === "role")
          .map((f) => (f.id as { name: string }).name)
      : [];

  const flatProfile = ctx.planOptions.policy
    ? flattenPolicy(ctx.planOptions.policy)
    : undefined;
  let seededSchemas: string[] = [];
  let seededRoutines = new Map<string, string>();
  if (options.seedAssumedSchemas === true) {
    const profileAssumedSchemas = flatProfile?.assumedSchemas ?? [];
    const profileAssumedPublications = flatProfile?.assumedPublications ?? [];
    const profileAssumedExtensions = flatProfile?.assumedExtensions ?? [];
    // gate on ANY assumed kind: a profile assuming only publications or
    // extensions still needs its shadow seeded
    if (
      profileAssumedSchemas.length > 0 ||
      profileAssumedPublications.length > 0 ||
      profileAssumedExtensions.length > 0
    ) {
      const seed = deriveAssumedSchemaSeed(targetResult.factBase, {
        ...(ctx.planOptions.policy ? { policy: ctx.planOptions.policy } : {}),
        ...(ctx.planOptions.capability
          ? { capability: ctx.planOptions.capability }
          : {}),
        ...(ctx.planOptions.baseline
          ? { baseline: ctx.planOptions.baseline }
          : {}),
        assumedSchemas: profileAssumedSchemas,
        assumedPublications: profileAssumedPublications,
        assumedExtensions: profileAssumedExtensions,
        assumedRoles: [
          ...(flatProfile?.assumedRoles ?? []),
          ...assumedTargetRoles,
        ],
        ...(ctx.susetGucs !== undefined ? { susetGucs: ctx.susetGucs } : {}),
      });
      if (seed.sql !== "") {
        const seedClient = await connectWithErrorListener(shadowPool);
        try {
          // Same PG 16+ CREATEROLE non-superuser grant as loadSqlFiles: seed SQL
          // may CREATE SCHEMA … AUTHORIZATION for assumed owners.
          try {
            await seedClient.query(
              `SELECT set_config('createrole_self_grant', 'set, inherit', false)`,
            );
          } catch {
            /* PG < 16 or GUC unavailable */
          }
          await seedClient.query(seed.sql);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new SchemaFrontendError(
            `Failed to seed the co-located shadow with the target's assumed-schema objects: ${msg}`,
          );
        } finally {
          seedClient.release();
        }
        seededSchemas = seed.schemas;
        seededRoutines = seed.seededRoutines;
      }
    }
  }

  const reorderOnFailure = resolveReorderOnFailure(options);
  let orderedFiles: OrderedSqlFile[] | null = null;
  let cycles: ShadowLoadCycle[] = [];
  const loadInput = applyManifestLoadOrder(files, options.manifest?.loadOrder);
  let analyzed: Awaited<ReturnType<typeof analyzeForShadow>> | null = null;
  if (reorderOnFailure) {
    try {
      analyzed = await analyzeForShadow(files);
    } catch (err) {
      if (!(err instanceof ReorderUnavailableError)) throw err;
      options.onWarning?.(
        "reorder assist unavailable (optional peer @supabase/pg-topo not installed). Loading files raw at file granularity.",
      );
    }
    if (analyzed !== null) {
      orderedFiles = analyzed.files;
      cycles = analyzed.cycles;
      const parseErrors = analyzed.diagnostics.filter(
        (d) => d.code === "PARSE_ERROR" || d.code === "DISCOVERY_ERROR",
      );
      if (parseErrors.length > 0) {
        options.onWarning?.(
          `pg-topo could not parse ${parseErrors.length} input(s) — file-kind escalate will use filename hints when a file has no class.`,
        );
      }
    }
  }

  const adpFiles = files.filter(
    (f) => findDefaultPrivilegeStatements(f.sql).length > 0,
  );
  if (adpFiles.length > 0) {
    options.onWarning?.(
      "raw loading may apply ALTER DEFAULT PRIVILEGES AFTER objects created in the same load, so objects relying on ADP-implicit default grants may not receive them. Grant those privileges explicitly (as schema export does).",
    );
  }

  const originalSqlByName = new Map(files.map((f) => [f.name, f.sql]));
  const filenameFallback =
    analyzed !== null &&
    analyzed.diagnostics.some(
      (d) => d.code === "PARSE_ERROR" || d.code === "DISCOVERY_ERROR",
    );

  // A reused shadow server still holds the managed role settings of an earlier
  // load (they are cluster-global), so a line deleted from the files would never
  // plan its RESET. Clear them first.
  const roleStateBefore = managesRoleSettings
    ? await roleState(shadowPool, managedRoleSettings)
    : undefined;
  for (const { role, name } of roleStateBefore?.managed ?? []) {
    await shadowPool.query(`ALTER ROLE ${qid(role)} RESET ${qid(name)}`);
  }

  let loadResult;
  try {
    loadResult = await loadSqlFiles(loadInput, shadowPool, {
      extract: (p, o) => ctx.extract(p, { ...o, redactSecrets }),
      ...(seededSchemas.length > 0 ? { seededSchemas, seededRoutines } : {}),
      // assumed (platform) schemas are not the user's to manage — never probed
      assumedSchemas: flatProfile?.assumedSchemas ?? [],
      strictFunctionBodies: options.strictFunctionBodies === true,
      strictDataStatements: options.strictDataStatements === true,
      // undefined = let the loader default it from the mode
      ...(options.allowPreExistingRows !== undefined
        ? { allowPreExistingRows: options.allowPreExistingRows }
        : {}),
      ...(options.isolatedShadow === true
        ? { mode: "isolatedCluster" as const }
        : {}),
      ...(options.statementFallback !== undefined
        ? { statementFallback: options.statementFallback }
        : {}),
      reorderOnFailure,
      ...(options.connectionReuse !== undefined
        ? { connectionReuse: options.connectionReuse }
        : {}),
      ...(options.onWarning !== undefined
        ? { onWarning: options.onWarning }
        : {}),
      ...(analyzed !== null
        ? {
            enrichLoadAssistFailures: (failures) =>
              attachReorderPredecessors(failures, analyzed, originalSqlByName),
            reorderFilesByKind: (pending: SqlFile[]) =>
              preorderFilesByKind(
                pending,
                classesByFileFromAnalyzed(analyzed),
                { filenameFallback },
              ),
            splitFileByKind: (file: SqlFile) =>
              splitAndReorderFile(file, analyzed),
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ShadowLoadError && orderedFiles) {
      if (options.onShadowLoadError !== undefined) {
        throw options.onShadowLoadError(error, {
          orderedFiles,
          cycles,
          originalSqlByName,
        });
      }
    }
    throw error;
  }

  // Database scope lets ALTER ROLE into the isolated shadow only for managed
  // settings; the catalog says what the files actually changed. New roles are
  // left out: CREATE ROLE is refused statically, and one created in a DO block
  // loaded before this feature too.
  if (
    roleStateBefore !== undefined &&
    scope === "database" &&
    declaresRoleSettings
  ) {
    const before = roleStateBefore.state;
    const after = (
      await roleState(shadowPool, managedRoleSettings, roleStateBefore.roles)
    ).state;
    const changes = [...new Set([...before.keys(), ...after.keys()])]
      .filter((subject) => before.get(subject) !== after.get(subject))
      .sort();
    if (changes.length > 0) {
      throw new SchemaFrontendError(
        `the declarative files changed cluster-level role state that database scope does not manage ` +
          `(only the role settings the profile manages may change): ${changes.join("; ")}. Use scope cluster to manage roles.`,
      );
    }
  }

  // Pre-flight guard for the delivery model (docs/architecture/custom-folder.md
  // §7). Raw SQL — `_custom/` included — runs only in the disposable shadow, so
  // the shadow can legitimately hold unmodeled objects the target has never
  // received. Those produce no facts, meaning the diff below is blind to them
  // and the plan cannot create them; a generated statement depending on one
  // fails on the target. Compare the two catalogs and say so BEFORE handing the
  // plan over. Two probe queries per plan, deliberately uncached: the answer is
  // about live state and a stale "no drift" would be worse than no check.
  const driftDiagnostics = detectUnmodeledDrift(
    await probeUnmodeledIdentitiesPinned(
      shadowPool,
      majorOf(loadResult.pgVersion),
    ),
    await probeUnmodeledIdentitiesPinned(
      targetPool,
      majorOf(targetResult.pgVersion),
    ),
  );

  /* The seed never replays default privileges, which are per database, so a
   * co-located shadow cannot reproduce the ACLs they give extension members. */
  let policy =
    unmanagedRoleSettings && ctx.planOptions.policy !== undefined
      ? withoutManagedRoleSettings(ctx.planOptions.policy)
      : ctx.planOptions.policy;
  if (options.seedAssumedSchemas === true && policy !== undefined) {
    const adpSchemas = new Set(
      targetResult.factBase
        .facts()
        .flatMap((f) =>
          f.id.kind === "defaultPrivilege" ? [f.id.schema] : [],
        ),
    );
    const schemas = (flatProfile?.assumedSchemas ?? []).filter(
      (s) => adpSchemas.has(s) || adpSchemas.has(null),
    );
    if (schemas.length > 0) {
      const rule: FilterRule = {
        match: {
          all: [
            { kind: "acl" },
            { target: { schema: schemas } },
            { ownedByExtension: "*" },
          ],
        },
        action: "exclude",
        audit: {
          reasonCode: "co-located-shadow.member-acl",
          classification: "acknowledged",
        },
      };
      const view = resolveView(
        targetResult.factBase,
        policy,
        ctx.planOptions.capability,
        ctx.planOptions.baseline,
      );
      for (const fact of view.facts()) {
        if (!factMatches(rule.match, fact, view)) continue;
        targetResult.diagnostics.push({
          code: "unmanaged_member_acl",
          severity: "warning",
          subject: fact.id,
          message:
            "left unmanaged: a co-located shadow does not replay the target's default privileges, so it cannot reproduce grants on extension members in this schema; plan with an explicit --shadow to manage it",
        });
      }
      policy = { ...policy, filter: [rule, ...(policy.filter ?? [])] };
    }
  }

  const planOptions: PlanOptions = {
    renames: options.renames ?? "off",
    scope,
    ...(options.acceptRenames !== undefined && options.acceptRenames.length > 0
      ? { acceptRenames: options.acceptRenames }
      : {}),
    ...ctx.planOptions,
    ...(policy !== undefined ? { policy } : {}),
    ...(assumedTargetRoles.length > 0
      ? {
          assumedRoles: [
            ...(ctx.planOptions.assumedRoles ?? []),
            ...assumedTargetRoles,
          ],
        }
      : {}),
    ...(applyDefaultOwner !== undefined
      ? { defaultOwner: applyDefaultOwner }
      : {}),
    // stamp the redaction mode the extracts (and thus the fingerprint) were
    // taken under, so a plan archived via `schema apply --out-plan` replays
    // through `apply --plan` with the SAME re-extract mode — an unstamped
    // unredacted plan would read as redacted and trip the fingerprint gate
    // on an unchanged target.
    redactSecrets,
  };

  let thePlan = plan(targetResult.factBase, loadResult.factBase, planOptions);
  // Only definitions this plan would emit can carry first-deparse text the
  // target will not reproduce; a converged plan is empty and skips this.
  const touched = planSubjects(thePlan);
  const settle =
    touched.size === 0
      ? undefined
      : await settleDesired(
          shadowPool,
          targetResult.factBase,
          loadResult.factBase,
          { only: touched },
        );
  if (settle?.changed === true) {
    thePlan = plan(targetResult.factBase, settle.factBase, planOptions);
  }

  return {
    plan: thePlan,
    loadDiagnostics: [
      ...loadResult.diagnostics,
      ...(settle?.diagnostics ?? []),
    ],
    targetDiagnostics: targetResult.diagnostics,
    driftDiagnostics,
    skipped: prepared.skipped,
    targetFactBase: targetResult.factBase,
    applyOptions: ctx.applyOptions,
    planOptions,
    extract: ctx.extract,
    ...(applyDefaultOwner !== undefined
      ? { defaultOwner: applyDefaultOwner }
      : {}),
    scope,
    redactSecrets,
    profile: ctx,
  };
}
