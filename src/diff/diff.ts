import postgres from "postgres";
import { inspect } from "../inspect/inspect.ts";

export async function diff(
  sourceConnectionUrl: string,
  targetConnectionUrl?: string,
  options?: { filters: {} },
) {
  const sourceSql = postgres(sourceConnectionUrl);
  const targetSql = targetConnectionUrl ? postgres(targetConnectionUrl) : null;

  const [sourceInspectionResult, targetInspectionResult] = await Promise.all([
    inspect(sourceSql),
    targetSql ? inspect(targetSql) : null,
  ]);

  console.log(JSON.stringify(sourceInspectionResult, null, 2));
}
