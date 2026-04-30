import type { CompositeTypeChange } from "./composite-type/changes/composite-type.types.ts";
import type { EnumChange } from "./enum/changes/enum.types.ts";
import type { RangeChange } from "./range/changes/range.types.ts";

/** Union of all type-related change variants (`objectType: "composite_type" | "enum" | "range"`). @category Change Types */
export type TypeChange = CompositeTypeChange | EnumChange | RangeChange;
