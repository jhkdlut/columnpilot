import { Clock3, Download, History, Loader2, Play, RotateCcw, TerminalSquare, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ResultTable } from "./result-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { downloadQueryResult, type ExportFormat } from "@/lib/clickhouse/export";
import type { QueryHistoryItem } from "@/lib/clickhouse/query-history";
import type { ClickHouseQueryResult } from "@/lib/clickhouse/types";

export function SqlWorkspace({
  sql,
  setSql,
  result,
  querying,
  runQuery,
  connected,
  database,
  history,
  loadHistory,
  clearHistory,
}: {
  sql: string;
  setSql: (value: string) => void;
  result: ClickHouseQueryResult;
  querying: boolean;
  runQuery: () => void;
  connected: boolean;
  database: string;
  history: QueryHistoryItem[];
  loadHistory: (sql: string) => void;
  clearHistory: () => void;
}) {
  const exportResult = (format: ExportFormat) => {
    if (!result.data.length) return toast.error("当前没有可导出的查询结果");
    downloadQueryResult(result, database, format);
    toast.success(`已导出 ${format.toUpperCase()} 文件`);
  };

  return (
    <div className="mt-6 grid gap-5">
      <QueryEditor sql={sql} setSql={setSql} querying={querying} runQuery={runQuery} />
      <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">查询结果</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {connected ? `${result.rows ?? result.data.length} 行` : "演示结果"} · 耗时 {Math.round((result.statistics?.elapsed ?? 0) * 1000)} ms
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => exportResult("csv")} disabled={!result.data.length}>
              <Download /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportResult("json")} disabled={!result.data.length}>
              <Download /> JSON
            </Button>
            <Badge variant="outline">最多 500 行</Badge>
          </div>
        </div>
        <ResultTable result={result} />
      </section>
      <QueryHistory history={history} loadHistory={loadHistory} clearHistory={clearHistory} />
    </div>
  );
}

function QueryHistory({
  history,
  loadHistory,
  clearHistory,
}: {
  history: QueryHistoryItem[];
  loadHistory: (sql: string) => void;
  clearHistory: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-signal" />查询历史</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">当前页面会话最近 20 条成功查询，不写入本地存储</p>
        </div>
        <Button variant="ghost" size="sm" onClick={clearHistory} disabled={!history.length}>
          <Trash2 /> 清空
        </Button>
      </div>
      {history.length ? (
        <div className="divide-y divide-border">
          {history.map((item) => (
            <button
              key={item.id}
              type="button"
              className="group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => loadHistory(item.sql)}
            >
              <RotateCcw className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:text-signal" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-foreground">{item.sql.replace(/\s+/g, " ")}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock3 className="size-3" />{formatHistoryTime(item.executedAt)}</span>
                  <span>{item.rows} 行</span>
                  <span>{item.elapsedMs} ms</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">成功执行查询后会显示在这里</div>
      )}
    </section>
  );
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function QueryEditor({
  sql,
  setSql,
  querying,
  runQuery,
  compact = false,
}: {
  sql: string;
  setSql: (value: string) => void;
  querying: boolean;
  runQuery: () => void;
  compact?: boolean;
}) {
  return (
    <section className={`${compact ? "mt-5" : ""} overflow-hidden rounded-xl border border-border bg-[#0b0f14] text-slate-100 shadow-[0_18px_50px_rgba(0,0,0,0.16)]`}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium"><TerminalSquare className="size-4 text-signal" /> {compact ? "快速查询" : "query.sql"}</div>
        <span className="font-mono text-[11px] text-slate-500">Ctrl + Enter 运行</span>
      </div>
      <Textarea
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runQuery();
        }}
        className={`${compact ? "min-h-28" : "min-h-64"} resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-[13px] leading-6 text-slate-200 shadow-none focus-visible:ring-0`}
      />
      <div className="flex items-center justify-between border-t border-white/10 px-3 py-2.5">
        <span className="text-xs text-slate-500">只读模式 · 30 秒超时 · 最多 500 行</span>
        <Button size="sm" onClick={runQuery} disabled={querying} className="bg-signal text-slate-950 hover:bg-signal/90">
          {querying ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} 运行查询
        </Button>
      </div>
    </section>
  );
}
