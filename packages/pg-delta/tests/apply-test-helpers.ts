/** Shared fixtures for apply integration tests that wrap the pool. */
import type pg from "pg";
import type { Action, Plan } from "../src/plan/plan.ts";
import { ENGINE_VERSION, stampPlanId } from "../src/plan/plan.ts";

export function queryText(first: unknown): string {
  if (typeof first === "string") return first;
  if (
    first !== null &&
    typeof first === "object" &&
    "text" in first &&
    typeof (first as { text: unknown }).text === "string"
  ) {
    return (first as { text: string }).text;
  }
  return String(first);
}

function tapQueries(client: pg.PoolClient, queries: string[]): void {
  const origQuery = client.query.bind(client) as (...a: unknown[]) => unknown;
  (client as { query: unknown }).query = (...qa: unknown[]) => {
    queries.push(queryText(qa[0]));
    return origQuery(...qa);
  };
}

export async function withApplyQueries<T>(
  pool: pg.Pool,
  fn: () => Promise<T>,
): Promise<{ result: T; queries: string[] }> {
  const queries: string[] = [];
  const origConnect = pool.connect.bind(pool);
  (pool as { connect: unknown }).connect = (
    callback?: (
      error?: Error,
      client?: pg.PoolClient,
      release?: (releaseError?: Error | boolean) => void,
    ) => void,
  ) => {
    if (typeof callback === "function") {
      return origConnect((error, client, release) => {
        if (error !== undefined || client === undefined) {
          callback(error, client, release);
          return;
        }
        tapQueries(client, queries);
        callback(undefined, client, release);
      });
    }
    return origConnect().then((client) => {
      tapQueries(client, queries);
      return client;
    });
  };
  try {
    return { result: await fn(), queries };
  } finally {
    (pool as { connect: unknown }).connect = origConnect;
  }
}

export function txnAction(sql: string, extra: Partial<Action> = {}): Action {
  return {
    sql,
    verb: "create",
    produces: [],
    consumes: [],
    destroys: [],
    releases: [],
    transactionality: "transactional",
    lockClass: "none",
    newSegmentBefore: false,
    dataLoss: "none",
    rewriteRisk: false,
    ...extra,
  } as Action;
}

export function planFromActions(actions: Action[]): Plan {
  return stampPlanId({
    formatVersion: 1,
    engineVersion: ENGINE_VERSION,
    source: { fingerprint: "a".repeat(64) },
    target: { fingerprint: "b".repeat(64) },
    preamble: [],
    deltas: [],
    filteredDeltas: [],
    renameCandidates: [],
    actions,
    safetyReport: {
      destructiveActions: 0,
      rewriteRiskActions: 0,
      nonTransactionalActions: 0,
      lockClasses: {},
    },
  });
}
