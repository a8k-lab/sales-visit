import { webOperationDeadline } from "@sales-visit/contracts";

export const operationWindowMs = 30000;
// ':' suffixes the unique invocation ID; ';' is the exclusive prefix upper bound.
// The primary-key range lookup avoids an unindexed audit metadata scan.
export const operationRange = (id: string) => [id + ":", id + ";"] as const;
export const operationWriteGuard = `unixepoch('subsec') * 1000 < ?
  AND ? <= unixepoch('subsec') * 1000 + ${operationWindowMs}
  AND NOT EXISTS (SELECT 1 FROM access_audit WHERE id > ? AND id < ?)`;
export const operationWriteBindings = (id: string) => [
  webOperationDeadline(id),
  webOperationDeadline(id),
  ...operationRange(id),
];
