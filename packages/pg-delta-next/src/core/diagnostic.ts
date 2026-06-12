/**
 * The one shared diagnostic shape used by every layer (stage-1 deliverable 7):
 * extraction's unresolved references, loader rejections, planner failures,
 * apply reports. One shape → one CLI renderer.
 */
import type { StableId } from "./stable-id.ts";

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  subject?: StableId;
  message: string;
  context?: Record<string, unknown>;
}

/** Thrown by public API stubs for not-yet-implemented stages (stage 0). */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`Not implemented: ${feature}`);
    this.name = "NotImplementedError";
  }
}
