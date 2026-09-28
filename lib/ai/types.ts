import type { ClickHouseQueryResult } from "../clickhouse/types";

export type AiColumn = { name: string; type: string; comment: string };
export type AiSchema = { database: string; table: string; engine: string; columns: AiColumn[] };
export type Filter = {
  column: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "isNull" | "notNull" | "lastDays";
  value?: string | number;
};
export type QueryPlan = {
  table: string;
  columns: string[];
  filters: Filter[];
  aggregations: { fn: "count" | "sum" | "avg" | "min" | "max"; column?: string }[];
  groupBy: string[];
  orderBy: { column: string; direction: "asc" | "desc" }[];
  limit: number;
};
export type HistoryTurn = { question: string; plan: QueryPlan };
export type PlanInput = { question: string; schema: AiSchema; history: HistoryTurn[]; now: string; timezone: "UTC" };
export type ModelPlan = { kind: "plan"; plan: QueryPlan } | { kind: "clarification"; message: string };
export type ResultSample = {
  question: string;
  sql: string;
  parameters: Record<string, string>;
  meta: ClickHouseQueryResult["meta"];
  rows: Record<string, unknown>[];
  returnedRows: number;
  queryTruncated: boolean;
  sampleTruncated: boolean;
};
export type AiProvider = {
  mode: "mock" | "http";
  model: string;
  plan: (input: PlanInput) => Promise<unknown>;
  explain: (sample: ResultSample) => Promise<string>;
};
export type PlanPreview = {
  kind: "plan";
  plan: QueryPlan;
  sql: string;
  parameters: Record<string, string>;
  ticket: string;
  expiresAt: string;
  timezone: "UTC";
};
export type AiExecution = {
  result: ClickHouseQueryResult;
  truncated: boolean;
  summary: string;
  explanationTicket: string;
  sampleRows: number;
  sampleTruncated: boolean;
};
