export type QueryHistoryItem = {
  id: string;
  sql: string;
  executedAt: string;
  elapsedMs: number;
  rows: number;
};

export function updateQueryHistory(
  current: QueryHistoryItem[],
  next: QueryHistoryItem,
  limit = 20,
) {
  const sql = next.sql.trim();
  if (!sql || limit <= 0) return current;
  const deduplicated = current.filter((item) => item.sql.trim() !== sql);
  return [{ ...next, sql }, ...deduplicated].slice(0, limit);
}
