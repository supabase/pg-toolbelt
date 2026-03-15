import { ServiceMap } from "effect";

export const WorkingDirectory = ServiceMap.Reference<string>(
  "@pg-topo/WorkingDirectory",
  {
    defaultValue: () => ".",
  },
);
