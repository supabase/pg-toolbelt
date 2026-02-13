import type { CompositeTypeChange } from "./composite-type/changes/composite-type.types.ts";
import type { EnumChange } from "./enum/changes/enum.types.ts";
import type { RangeChange } from "./range/changes/range.types.ts";

export type TypeChange = CompositeTypeChange | EnumChange | RangeChange;
