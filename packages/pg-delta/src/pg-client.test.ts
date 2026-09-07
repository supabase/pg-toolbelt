import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";
import { connectWithErrorListener } from "./pg-client.ts";

function fakeClient(): {
  client: PoolClient;
  releases: unknown[][];
  release: PoolClient["release"];
} {
  const releases: unknown[][] = [];
  const release = (...args: Parameters<PoolClient["release"]>): void => {
    releases.push(args);
  };
  const client = Object.assign(new EventEmitter(), {
    release,
  }) as unknown as PoolClient;
  return { client, releases, release };
}

function callbackPool(
  client: PoolClient,
  release: PoolClient["release"],
): Pool {
  return {
    connect(
      callback: (
        error: Error | undefined,
        client: PoolClient,
        release: PoolClient["release"],
      ) => void,
    ) {
      callback(undefined, client, release);
    },
  } as unknown as Pool;
}

describe("connectWithErrorListener", () => {
  test("guards a checked-out client until it is released", async () => {
    const { client, releases, release } = fakeClient();

    const checkedOut = await connectWithErrorListener(
      callbackPool(client, release),
    );

    expect(checkedOut.listenerCount("error")).toBe(1);
    expect(() =>
      checkedOut.emit("error", new Error("connection dropped")),
    ).not.toThrow();

    checkedOut.release(true);
    expect(checkedOut.listenerCount("error")).toBe(0);
    expect(releases).toEqual([[true]]);
  });

  test("does not accumulate listeners when a client is reused", async () => {
    const { client, releases, release } = fakeClient();
    const pool = callbackPool(client, release);

    const first = await connectWithErrorListener(pool);
    first.release();
    const second = await connectWithErrorListener(pool);

    expect(second.listenerCount("error")).toBe(1);
    const releaseError = new Error("discard");
    second.release(releaseError);
    expect(second.listenerCount("error")).toBe(0);
    expect(releases).toEqual([[], [releaseError]]);
  });

  test("rejects a failed checkout", async () => {
    const connectError = new Error("connect failed");
    const pool = {
      connect(callback: (error: Error) => void) {
        callback(connectError);
      },
    } as unknown as Pool;

    expect(connectWithErrorListener(pool)).rejects.toBe(connectError);
  });
});
