/**
 * Segmentation algorithm (stage 6 deliverable 2), pure: hand-built action
 * lists exercise maximal transactional runs, lone nonTransactional
 * actions, and commitBoundaryAfter boundaries.
 */
import { describe, expect, test } from "bun:test";
import { segmentActions } from "./apply.ts";

const txn = (newSegmentBefore = false) => ({
  transactionality: "transactional" as const,
  newSegmentBefore,
});
const nonTxn = () => ({
  transactionality: "nonTransactional" as const,
  newSegmentBefore: false,
});
const boundary = () => ({
  transactionality: "commitBoundaryAfter" as const,
  newSegmentBefore: false,
});

describe("segmentActions", () => {
  test("all-transactional plans run as one segment", () => {
    expect(segmentActions([txn(), txn(), txn()])).toEqual([
      { start: 0, end: 3, transactional: true },
    ]);
  });

  test("a nonTransactional action runs alone between transaction runs", () => {
    expect(segmentActions([txn(), nonTxn(), txn(), txn()])).toEqual([
      { start: 0, end: 1, transactional: true },
      { start: 1, end: 2, transactional: false },
      { start: 2, end: 4, transactional: true },
    ]);
  });

  test("leading and trailing nonTransactional actions", () => {
    expect(segmentActions([nonTxn(), txn(), nonTxn()])).toEqual([
      { start: 0, end: 1, transactional: false },
      { start: 1, end: 2, transactional: true },
      { start: 2, end: 3, transactional: false },
    ]);
  });

  test("newSegmentBefore commits the run containing a commitBoundaryAfter action", () => {
    // ADD VALUE at 1, its first consumer at 3 (marked by the planner)
    expect(
      segmentActions([txn(), boundary(), txn(), txn(true), txn()]),
    ).toEqual([
      { start: 0, end: 3, transactional: true },
      { start: 3, end: 5, transactional: true },
    ]);
  });

  test("a boundary at the very first action opens no empty segment", () => {
    expect(segmentActions([txn(true), txn()])).toEqual([
      { start: 0, end: 2, transactional: true },
    ]);
  });

  test("empty plans yield no segments", () => {
    expect(segmentActions([])).toEqual([]);
  });
});
