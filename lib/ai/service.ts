import type { ClickHouseConnection } from "../clickhouse/types";
import { RequestError } from "../http/errors";
import { aiQuery, loadSchema, schemaFingerprint } from "./catalog";
import { compilePlan } from "./plan";
import { requireProvider } from "./provider";
import { signTicket, verifyTicket } from "./tickets";
import { list, object, text } from "./validation";
import type { AiExecution, AiSchema, HistoryTurn, PlanPreview, QueryPlan, ResultSample } from "./types";

type SavedPlan = { plan: QueryPlan; fingerprint: string; question: string };

function history(value: unknown, schema: AiSchema): HistoryTurn[] {
  if (value === undefined) return [];
  if (Buffer.byteLength(JSON.stringify(value)) > 24 * 1024) throw new RequestError("追问历史超过大小限制，请清空会话", 413);
  return list(value, 10).map((entry) => {
    const item = object(entry, ["question", "plan"]);
    return { question: text(item.question, 2000), plan: compilePlan(item.plan, schema).plan };
  });
}

export async function planQuestion(connection: ClickHouseConnection, table: string, question: unknown, previous: unknown, requestUrl: string): Promise<PlanPreview | { kind: "clarification"; message: string }> {
  const provider = requireProvider();
  const prompt = text(question, 2000);
  const schema = await loadSchema(connection, table, requestUrl);
  const input = { question: prompt, schema, history: history(previous, schema), now: new Date().toISOString(), timezone: "UTC" as const };
  const response = object(await provider.plan(input), ["kind", "plan", "message"]);
  if (response.kind === "clarification") return { kind: "clarification", message: text(response.message, 2000) };
  if (response.kind !== "plan") throw new RequestError("模型未返回有效查询方案", 502);
  const compiled = compilePlan(response.plan, schema, new Date(input.now));
  const receipt = signTicket("plan", connection, { plan: compiled.plan, fingerprint: schemaFingerprint(schema), question: prompt } satisfies SavedPlan);
  return { kind: "plan", ...compiled, ...receipt, timezone: "UTC" };
}

export async function executePlan(connection: ClickHouseConnection, ticket: unknown, requestUrl: string): Promise<AiExecution> {
  requireProvider();
  const saved = verifyTicket<SavedPlan>(ticket, "plan", connection);
  const schema = await loadSchema(connection, saved.plan.table, requestUrl);
  if (schemaFingerprint(schema) !== saved.fingerprint) throw new RequestError("表结构已变化，请重新生成查询方案", 409);
  const compiled = compilePlan(saved.plan, schema);
  const raw = await aiQuery(connection, compiled.sql, requestUrl, compiled.parameters, compiled.plan.limit + 1);
  const truncated = raw.data.length > compiled.plan.limit;
  const result = { ...raw, data: raw.data.slice(0, compiled.plan.limit), rows: Math.min(raw.data.length, compiled.plan.limit) };
  const sample: ResultSample = { question: saved.question, sql: compiled.sql, parameters: compiled.parameters, meta: raw.meta, rows: [], returnedRows: result.data.length, queryTruncated: truncated, sampleTruncated: result.data.length > 0 };
  for (const row of result.data.slice(0, 20)) {
    sample.rows.push(row);
    if (Buffer.byteLength(JSON.stringify(sample)) > 64 * 1024) { sample.rows.pop(); break; }
  }
  sample.sampleTruncated = sample.rows.length < result.data.length;
  if (Buffer.byteLength(JSON.stringify(sample)) > 64 * 1024) throw new RequestError("结果描述超过解释大小限制", 413);
  const receipt = signTicket("result", connection, sample);
  return {
    result, truncated,
    summary: result.data.length ? `已执行查询，返回 ${result.data.length} 行。${truncated ? "结果达到上限，仍有更多数据，请缩小范围。" : "结果以本次查询条件为准。"}` : "查询成功，当前条件下没有数据。",
    explanationTicket: receipt.ticket, sampleRows: sample.rows.length, sampleTruncated: sample.sampleTruncated,
  };
}

export async function explainResult(connection: ClickHouseConnection, ticket: unknown, consent: unknown) {
  if (consent !== true) throw new RequestError("解释结果前需要确认发送限量查询数据", 400);
  const sample = verifyTicket<ResultSample>(ticket, "result", connection);
  if (sample.rows.length > 20 || Buffer.byteLength(JSON.stringify(sample)) > 64 * 1024) throw new RequestError("结果样本超过限制", 413);
  return { text: text(await requireProvider().explain(sample), 8000) };
}
