"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Download, Loader2, Play, RotateCcw, Send, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ResultTable } from "./result-table";
import { downloadQueryResult } from "@/lib/clickhouse/export";
import type { ClickHouseConnection } from "@/lib/clickhouse/types";
import type { AiExecution, AiSchema, HistoryTurn, PlanPreview } from "@/lib/ai/types";

type Status = { mode: "disabled" | "mock" | "http"; model: string };
type Catalog = { items: { name: string; engine?: string }[]; truncated: boolean };

async function requestAi<T>(body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/ai", body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  } : { signal, cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !json.ok) throw new Error(json.error || "智能问数请求失败");
  return json.result as T;
}

export function AiWorkspace({ connection, openSql }: { connection: ClickHouseConnection | null; openSql: (sql: string) => void }) {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestAi<Status>(undefined, controller.signal).then(setStatus).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  return <div className="mt-6 space-y-5">
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><Bot className="size-5 text-signal" />智能问数</h2>
      <p className="mt-2 text-sm text-muted-foreground">选择一张表，用自然语言描述筛选和统计需求。查看方案后执行，只读查询最多显示 500 行。</p>
      {status?.mode === "mock" && <p className="mt-3 rounded-md bg-amber-400/10 p-3 text-sm text-amber-200">模拟联调模式：使用固定句式生成方案，查询会读取真实 ClickHouse 数据。尚未接入真实模型。</p>}
      {status?.mode === "http" && <p className="mt-3 text-sm text-muted-foreground">模型：{status.model} · 通用 HTTP 接口 · 真实模型接入尚待验收</p>}
      {status?.mode === "disabled" && <p className="mt-3 text-sm text-muted-foreground">尚未启用智能问数。部署时设置 COLUMNPILOT_AI_MODE=mock 可体验模拟联调；原有查询和导入功能不受影响。</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {!connection && <p className="mt-3 text-sm text-muted-foreground">请先连接 ClickHouse。</p>}
    </section>
    {connection && status && status.mode !== "disabled" && <DatabasePicker connection={connection} status={status} openSql={openSql} />}
  </div>;
}

function DatabasePicker({ connection, status, openSql }: { connection: ClickHouseConnection; status: Status; openSql: (sql: string) => void }) {
  const [database, setDatabase] = useState(connection.database);
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestAi<Catalog>({ action: "databases", connection }, controller.signal).then(setCatalog).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [connection]);
  const names = [...new Set([connection.database, ...(catalog?.items.map((item) => item.name) ?? [])])];
  return <div className="space-y-4">
    <label className="grid max-w-md gap-2 text-sm">当前问数数据库
      <NativeSelect aria-label="问数数据库" value={database} onChange={(event) => setDatabase(event.target.value)}>{names.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect>
    </label>
    {catalog?.truncated && <p className="text-xs text-muted-foreground">只列出前 100 个数据库；可通过连接设置指定其他数据库。</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <TablePicker key={database} connection={connection} database={database} status={status} openSql={openSql} />
  </div>;
}

function TablePicker({ connection, database, status, openSql }: { connection: ClickHouseConnection; database: string; status: Status; openSql: (sql: string) => void }) {
  const [tables, setTables] = useState<Catalog>();
  const [table, setTable] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    requestAi<Catalog>({ action: "tables", connection: { ...connection, database } }, controller.signal).then((result) => {
      setTables(result);
      setTable(result.items[0]?.name ?? "");
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [connection, database]);
  return <div className="space-y-4">
    <label className="grid max-w-md gap-2 text-sm">数据表
      <NativeSelect aria-label="问数数据表" value={table} onChange={(event) => setTable(event.target.value)} disabled={!tables?.items.length}>
        {!tables?.items.length && <NativeSelectOption value="">{tables ? "没有可用表" : "读取数据表…"}</NativeSelectOption>}
        {tables?.items.map((item) => <NativeSelectOption key={item.name} value={item.name}>{item.name} · {item.engine}</NativeSelectOption>)}
      </NativeSelect>
    </label>
    {tables?.truncated && <p className="text-xs text-muted-foreground">当前列表仅显示前 500 张表。</p>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {table && <SchemaSession key={table} connection={connection} database={database} table={table} status={status} openSql={openSql} />}
  </div>;
}

function SchemaSession({ connection, database, table, status, openSql }: { connection: ClickHouseConnection; database: string; table: string; status: Status; openSql: (sql: string) => void }) {
  const [schema, setSchema] = useState<AiSchema>();
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    requestAi<AiSchema>({ action: "schema", connection: { ...connection, database }, table }, controller.signal).then(setSchema).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [connection, database, table]);
  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!schema) return <p className="text-sm text-muted-foreground">正在检查表结构与读取权限…</p>;
  return <section className="space-y-4">
    <details className="rounded-lg border border-border bg-card p-3 text-sm"><summary className="cursor-pointer">本次结构上下文：{schema.database}.{schema.table} · {schema.columns.length} 个字段</summary><p className="mt-2 text-xs text-muted-foreground">提问会发送问题、所选表结构和最近最多 10 轮查询方案。默认不发送数据行，时间口径为 UTC。</p><div className="mt-2 flex flex-wrap gap-2">{schema.columns.map((column) => <span key={column.name} className="rounded bg-muted px-2 py-1 font-mono text-xs" title={column.comment}>{column.name}: {column.type}</span>)}</div></details>
    <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setSession((value) => value + 1)}><RotateCcw />清空问数会话</Button></div>
    <QuestionSession key={session} connection={{ ...connection, database }} schema={schema} status={status} openSql={openSql} />
  </section>;
}

function QuestionSession({ connection, schema, status, openSql }: { connection: ClickHouseConnection; schema: AiSchema; status: Status; openSql: (sql: string) => void }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<HistoryTurn[]>([]);
  const [preview, setPreview] = useState<PlanPreview>();
  const [execution, setExecution] = useState<AiExecution>();
  const [clarification, setClarification] = useState("");
  const [explanation, setExplanation] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const run = async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(label); setError("");
    try { await work(controller.signal); } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "请求失败"); }
    finally { if (!controller.signal.aborted) { pending.current = null; setBusy(""); } }
  };
  const generate = () => run("生成方案", async (signal) => {
    setPreview(undefined); setExecution(undefined); setExplanation(""); setClarification(""); setConsent(false);
    const response = await requestAi<PlanPreview | { kind: "clarification"; message: string }>({ action: "plan", connection, table: schema.table, question, history }, signal);
    if (signal.aborted) return;
    if (response.kind === "clarification") { setClarification(response.message); return; }
    setPreview(response);
    const turns = [...history, { question, plan: response.plan }].slice(-10);
    while (new TextEncoder().encode(JSON.stringify(turns)).byteLength > 24 * 1024) turns.shift();
    setHistory(turns);
  });
  const numeric = schema.columns.find((column) => /^(?:U?Int|Float)/.test(column.type));
  const group = schema.columns.find((column) => /String/.test(column.type));
  const examples = ["查看前 20 条记录", "统计记录总数", ...(numeric ? [`${numeric.name} 最大的 5 条记录`] : []), ...(numeric && group ? [`按 ${group.name} 统计 ${numeric.name} 的平均值`] : []), ...(history.length ? ["改为最近 30 天"] : [])];
  return <div className="space-y-4">
    {!!history.length && <details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer">本次会话 · {history.length} 轮方案（不代表已执行）</summary><ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground">{history.map((turn, index) => <li key={index}>{turn.question}</li>)}</ol></details>}
    <section className="rounded-xl border border-border bg-card p-4">
      <label htmlFor="ai-question" className="text-sm font-medium">你想了解哪些数据？</label>
      <Textarea id="ai-question" value={question} maxLength={2000} disabled={!!busy} onChange={(event) => setQuestion(event.target.value)} className="mt-2 min-h-28" placeholder="例如：按 device_id 统计 value 的平均值" />
      <div className="mt-3 flex flex-wrap gap-2">{examples.map((example) => <Button key={example} size="sm" variant="outline" disabled={!!busy} onClick={() => setQuestion(example)}>{example}</Button>)}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{status.mode === "mock" ? "模拟模式支持以上句式；生成方案不会执行查询。" : "生成方案后检查查询条件，再执行。"}</span><Button disabled={!!busy || !question.trim()} onClick={generate}>{busy === "生成方案" ? <Loader2 className="animate-spin" /> : <Send />}生成查询方案</Button></div>
    </section>
    {busy && <p role="status" className="text-sm text-muted-foreground">正在{busy}…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-400/30 p-3 text-sm text-red-300">{error}</p>}
    {clarification && <p className="rounded-lg border border-border bg-card p-4 text-sm">{clarification}</p>}
    {preview && <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="font-medium">{execution ? "已执行的查询方案" : "查询方案 · 尚未执行"}</h3>
      <p className="text-sm text-muted-foreground">读取 {schema.database}.{preview.plan.table}，应用 {preview.plan.filters.length} 个筛选条件，{preview.plan.aggregations.length ? `计算 ${preview.plan.aggregations.length} 个聚合指标` : `返回 ${preview.plan.columns.length} 个字段`}，最多显示 {preview.plan.limit} 行。UTC 时间口径；额外读取一行用于判断截断。</p>
      <pre className="overflow-auto rounded-lg bg-background p-3 text-xs">{preview.sql}</pre>
      {!!Object.keys(preview.parameters).length && <div><p className="mb-1 text-xs text-muted-foreground">实际参数（执行时与 SQL 分开传递）</p><pre className="overflow-auto rounded-lg bg-background p-3 text-xs">{JSON.stringify(preview.parameters, null, 2)}</pre></div>}
      <div className="flex flex-wrap gap-2"><Button disabled={!!busy || !!execution} onClick={() => run("执行查询", async (signal) => {
        const result = await requestAi<AiExecution>({ action: "execute", connection, ticket: preview.ticket }, signal);
        if (!signal.aborted) setExecution(result);
      })}><Play />执行只读查询</Button><Button variant="outline" disabled={!!busy} onClick={() => {
        // Preserve the parameterized statement and values together; the SQL workbench
        // does not bind API parameters, so this is an inspection copy only.
        openSql(`-- 智能问数参数：${JSON.stringify(preview.parameters).replaceAll("\n", " ")}\n-- 参数化 SQL 请在智能问数中执行，或在工作台手动替换参数。\n${preview.sql}`);
      }}><TerminalSquare />在 SQL 工作台查看</Button></div>
    </section>}
    {execution && <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-3 border-b border-border p-4"><p role="status" className="text-sm">{execution.summary}</p><p className="text-xs text-muted-foreground">耗时 {Math.round((execution.result.statistics?.elapsed ?? 0) * 1000)} ms · 导出仅包含当前返回的 {execution.result.data.length} 行</p><div className="flex gap-2">{(["csv", "json"] as const).map((format) => <Button key={format} variant="outline" size="sm" disabled={!execution.result.data.length} onClick={() => downloadQueryResult(execution.result, schema.database, format)}><Download />{format.toUpperCase()}</Button>)}</div></div>
      <ResultTable result={execution.result} />
      <div className="space-y-3 border-t border-border p-4"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={!!busy || !!explanation} onChange={(event) => setConsent(event.target.checked)} className="mt-1" /><span>允许向配置的模型发送本次问题、查询条件和最多 {execution.sampleRows} 行结果（总样本不超过 64 KiB）以解释结果。{execution.sampleTruncated ? "样本不包含全部返回数据。" : ""}</span></label><Button variant="outline" disabled={!consent || !!busy || !!explanation} onClick={() => run("解释结果", async (signal) => {
        const result = await requestAi<{ text: string }>({ action: "explain", connection, ticket: execution.explanationTicket, consent }, signal);
        if (!signal.aborted) setExplanation(result.text);
      })}><Bot />解释结果</Button>{explanation && <p className="whitespace-pre-wrap text-sm">{explanation}</p>}</div>
    </section>}
  </div>;
}
