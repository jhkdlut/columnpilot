"use client";

import { useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronDown,
  CircleHelp,
  Columns3,
  Database,
  FileUp,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Table2,
  TerminalSquare,
} from "lucide-react";
import { toast } from "sonner";
import { DEMO_COLUMNS, DEMO_RESULT, DEMO_TABLES, DEFAULT_SQL } from "@/components/columnpilot/demo-data";
import { ImportPanel } from "@/components/columnpilot/import-panel";
import { QueryEditor, SqlWorkspace } from "@/components/columnpilot/query-workspace";
import { ResultTable } from "@/components/columnpilot/result-table";
import type { ColumnInfo, ImportJob, TableInfo, View } from "@/components/columnpilot/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import {
  createImportPreview,
  MAX_IMPORT_BYTES,
  type ImportFormat,
  type ImportPreview,
} from "@/lib/clickhouse/import-preview";
import type {
  ClickHouseConnection as Connection,
  ClickHouseQueryResult as QueryResult,
} from "@/lib/clickhouse/types";

export function ColumnPilotApp() {
  const [view, setView] = useState<View>("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Connection>({ endpoint: "http://localhost:8123", user: "columnpilot", password: "", database: "columnpilot" });
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState({ databases: 8, tables: 146, total_rows: 191_287_400, total_bytes: 25_195_800_000, version: "26.8.1", uptime: 2_641_824 });
  const [tables, setTables] = useState<TableInfo[]>(DEMO_TABLES);
  const [selectedTable, setSelectedTable] = useState<TableInfo>(DEMO_TABLES[0]);
  const [preview, setPreview] = useState<QueryResult>(DEMO_RESULT);
  const [columns, setColumns] = useState<ColumnInfo[]>(DEMO_COLUMNS);
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [queryResult, setQueryResult] = useState<QueryResult>(DEMO_RESULT);
  const [querying, setQuerying] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [explorerTab, setExplorerTab] = useState<"data" | "schema">("data");
  const [search, setSearch] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTable, setImportTable] = useState("sensor_readings");
  const [importFormat, setImportFormat] = useState<ImportFormat>("CSVWithNames");
  const [importColumns, setImportColumns] = useState<ColumnInfo[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewing, setImportPreviewing] = useState(false);
  const importSchemaRequest = useRef(0);
  const importPreviewRequest = useRef(0);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [jobs, setJobs] = useState<ImportJob[]>([]);

  const filteredTables = useMemo(() => tables.filter((item) => `${item.database}.${item.name}`.toLowerCase().includes(search.toLowerCase())), [tables, search]);
  const clusterName = connection ? new URL(connection.endpoint).hostname : "演示集群";

  async function callApi<T = QueryResult>(payload: Record<string, unknown>, activeConnection = connection): Promise<T> {
    if (!activeConnection) throw new Error("请先连接 ClickHouse");
    const response = await fetch("/api/clickhouse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, connection: activeConnection }),
    });
    const json = await response.json() as { ok: boolean; result: unknown; error?: string };
    if (!response.ok || !json.ok) throw new Error(json.error || "请求失败");
    return json.result as T;
  }

  async function testConnection() {
    setConnecting(true);
    try {
      const result = await callApi({ action: "ping" }, draft);
      toast.success(`连接成功：ClickHouse ${result.data?.[0]?.version ?? ""}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function connect() {
    setConnecting(true);
    try {
      await callApi({ action: "ping" }, draft);
      setConnection(draft);
      setJobs([]);
      setDialogOpen(false);
      await loadCluster(draft);
      toast.success("已连接 ClickHouse");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function loadCluster(activeConnection = connection) {
    if (!activeConnection) return;
    setRefreshing(true);
    try {
      const [overviewResult, tablesResult] = await Promise.all([
        callApi({ action: "overview" }, activeConnection),
        callApi({ action: "tables", database: activeConnection.database }, activeConnection),
      ]);
      const metrics = overviewResult.data?.[0] as typeof overview | undefined;
      if (metrics) setOverview(metrics);
      const nextTables = (tablesResult.data ?? []) as unknown as TableInfo[];
      setTables(nextTables);
      if (nextTables[0]) {
        setImportTable(nextTables[0].name);
        await Promise.all([
          chooseTable(nextTables[0], activeConnection),
          loadImportColumns(nextTables[0], activeConnection),
        ]);
      } else {
        setImportColumns([]);
        setImportTable("");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }

  async function chooseTable(table: TableInfo, activeConnection = connection) {
    setSelectedTable(table);
    if (!activeConnection) {
      setPreview(DEMO_RESULT);
      setColumns(DEMO_COLUMNS);
      return;
    }
    setTableLoading(true);
    try {
      const [previewResult, columnResult] = await Promise.all([
        callApi({ action: "preview", database: table.database, table: table.name }, activeConnection),
        callApi({ action: "columns", database: table.database, table: table.name }, activeConnection),
      ]);
      setPreview(previewResult);
      setColumns((columnResult.data ?? []) as unknown as ColumnInfo[]);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTableLoading(false);
    }
  }

  async function loadImportColumns(table: TableInfo, activeConnection = connection) {
    const request = ++importSchemaRequest.current;
    setImportTable(table.name);
    setImportColumns([]);
    if (!activeConnection) {
      return;
    }
    try {
      const result = await callApi({ action: "columns", database: table.database, table: table.name }, activeConnection);
      const nextColumns = (result.data ?? []) as unknown as ColumnInfo[];
      if (request !== importSchemaRequest.current) return;
      setImportColumns(nextColumns);
      if (importFile) await analyzeImportFile(importFile, importFormat, nextColumns);
    } catch (error) {
      if (request !== importSchemaRequest.current) return;
      setImportColumns([]);
      toast.error(errorMessage(error));
    }
  }

  function selectImportTable(name: string) {
    const table = tables.find((item) => item.name === name);
    if (table) void loadImportColumns(table);
  }

  function selectImportFile(file: File | null) {
    setImportFile(file);
    void analyzeImportFile(file, importFormat, importColumns);
  }

  function selectImportFormat(format: ImportFormat) {
    setImportFormat(format);
    void analyzeImportFile(importFile, format, importColumns);
  }

  async function analyzeImportFile(file: File | null, format: ImportFormat, activeColumns: ColumnInfo[]) {
    const request = ++importPreviewRequest.current;
    setImportPreview(null);
    setImportPreviewing(!!file);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportPreview({ headers: [], rows: [], rowCount: 0, errors: ["当前版本单次上传最大 8 MB"], warnings: [] });
      setImportPreviewing(false);
      return;
    }
    try {
      const text = await file.text();
      if (request === importPreviewRequest.current) {
        setImportPreview(createImportPreview(text, format, activeColumns));
      }
    } catch {
      if (request === importPreviewRequest.current) {
        setImportPreview({ headers: [], rows: [], rowCount: 0, errors: ["无法读取导入文件"], warnings: [] });
      }
    } finally {
      if (request === importPreviewRequest.current) setImportPreviewing(false);
    }
  }

  async function runQuery() {
    setQuerying(true);
    try {
      if (!connection) {
        await new Promise((resolve) => setTimeout(resolve, 380));
        setQueryResult(DEMO_RESULT);
        toast.info("当前为演示数据；连接 ClickHouse 后将执行真实查询");
      } else {
        const result = await callApi({ action: "query", sql });
        setQueryResult(result);
        toast.success(`查询完成，返回 ${result.rows ?? result.data?.length ?? 0} 行`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setQuerying(false);
    }
  }

  async function startImport() {
    if (!connection) return toast.error("请先连接 ClickHouse");
    if (!importFile) return toast.error("请选择 CSV 或 JSONEachRow 文件");
    if (!importPreview || importPreview.errors.length) return toast.error("请先修复文件预览中的问题");
    setImporting(true);
    setImportProgress(24);
    try {
      const form = new FormData();
      form.set("file", importFile);
      form.set("connection", JSON.stringify(connection));
      form.set("database", connection.database);
      form.set("table", importTable);
      form.set("format", importFormat);
      setImportProgress(58);
      const response = await fetch("/api/clickhouse/import", { method: "POST", body: form });
      const json = await response.json() as { ok: boolean; summary?: { written_rows?: number | string }; warnings?: string[]; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error || "导入失败");
      setImportProgress(100);
      setJobs((current) => [{ file: importFile.name, target: `${connection.database}.${importTable}`, status: "完成", rows: formatNumber(json.summary?.written_rows ?? importPreview.rowCount), size: formatBytes(importFile.size), time: "刚刚" }, ...current]);
      toast.success("数据已写入 ClickHouse");
      if (json.warnings?.length) toast.warning(json.warnings.join("；"));
      selectImportFile(null);
    } catch (error) {
      setJobs((current) => [{ file: importFile.name, target: `${connection.database}.${importTable}`, status: "失败", rows: "—", size: formatBytes(importFile.size), time: "刚刚" }, ...current]);
      toast.error(errorMessage(error));
    } finally {
      setTimeout(() => setImportProgress(0), 700);
      setImporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-background/95 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="column-mark" aria-hidden="true"><i /><i /><i /></div>
          <span className="text-[15px] font-semibold tracking-tight">ColumnPilot</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">/</span>
          <button className="hidden items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground sm:flex" onClick={() => setDialogOpen(true)}>{clusterName} <ChevronDown className="size-3.5" /></button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className={connection ? "hidden border-emerald-400/25 bg-emerald-400/10 text-emerald-300 sm:flex" : "hidden border-signal/25 bg-signal/10 text-signal sm:flex"}>
            <span className={`size-1.5 rounded-full ${connection ? "bg-emerald-400" : "bg-signal"}`} /> {connection ? "已连接" : "演示模式"}
          </Badge>
          <Button variant="ghost" size="icon-sm" aria-label="帮助" onClick={() => window.open("https://github.com/jhkdlut/columnpilot#readme", "_blank", "noopener,noreferrer")}><CircleHelp /></Button>
          <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} draft={draft} setDraft={setDraft} connecting={connecting} onTest={testConnection} onConnect={connect} />
        </div>
      </header>

      <div className="border-b border-border bg-sidebar px-3 py-2 md:hidden">
        <div className="flex gap-1 overflow-x-auto">{NAV_ITEMS.map((item) => <MobileNav key={item.view} {...item} active={view === item.view} onClick={() => setView(item.view)} />)}</div>
      </div>

      <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 md:grid-cols-[218px_minmax(0,1fr)]">
        <aside className="hidden border-r border-border bg-sidebar px-3 py-5 md:flex md:flex-col">
          <nav className="space-y-1" aria-label="主导航">{NAV_ITEMS.map((item) => <NavItem key={item.view} {...item} active={view === item.view} onClick={() => setView(item.view)} />)}</nav>
          <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">资源</div>
          <nav className="mt-2 space-y-1"><NavItem icon={Database} label="数据库" onClick={() => setView("explorer")} /><NavItem icon={Braces} label="数据字典" onClick={() => setView("explorer")} /><NavItem icon={Settings2} label="连接设置" onClick={() => setDialogOpen(true)} /></nav>
          <div className="mt-auto rounded-lg border border-border bg-background/55 p-3">
            <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted-foreground">数据规模</span><span className="font-mono">{formatBytes(overview.total_bytes)}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-[63%] rounded-full bg-signal" /></div>
            <p className="mt-2 text-xs text-muted-foreground">{connection ? "来自 system.tables" : "演示数据"}</p>
          </div>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1440px]">
            <PageHeader view={view} clusterName={clusterName} version={String(overview.version)} search={search} setSearch={setSearch} refreshing={refreshing} connected={!!connection} onRefresh={() => loadCluster()} />
            {view === "overview" && <Overview metrics={overview} tables={filteredTables} preview={preview} previewTitle={`${selectedTable.database}.${selectedTable.name}`} sql={sql} setSql={setSql} querying={querying} runQuery={runQuery} onBrowseAll={() => setView("explorer")} onShowSchema={() => { setExplorerTab("schema"); setView("explorer"); }} onTable={(table) => { setExplorerTab("data"); setView("explorer"); chooseTable(table); }} />}
            {view === "explorer" && <Explorer tables={filteredTables} selected={selectedTable} preview={preview} columns={columns} loading={tableLoading} tab={explorerTab} setTab={setExplorerTab} onTable={chooseTable} />}
            {view === "sql" && <SqlWorkspace sql={sql} setSql={setSql} result={queryResult} querying={querying} runQuery={runQuery} connected={!!connection} database={connection?.database ?? "demo"} />}
            {view === "imports" && <ImportPanel connected={!!connection} file={importFile} setFile={selectImportFile} database={connection?.database ?? "default"} tables={connection ? tables : []} table={importTable} setTable={selectImportTable} format={importFormat} setFormat={selectImportFormat} preview={importPreview} previewing={importPreviewing} importing={importing} progress={importProgress} jobs={jobs} startImport={startImport} />}
          </div>
        </section>
      </div>
    </main>
  );
}

const NAV_ITEMS: Array<{ view: View; icon: typeof Activity; label: string; badge?: string }> = [
  { view: "overview", icon: Activity, label: "概览" },
  { view: "explorer", icon: Table2, label: "数据浏览" },
  { view: "sql", icon: TerminalSquare, label: "SQL 工作台" },
  { view: "imports", icon: FileUp, label: "导入任务" },
];

function ConnectionDialog({ open, onOpenChange, draft, setDraft, connecting, onTest, onConnect }: { open: boolean; onOpenChange: (open: boolean) => void; draft: Connection; setDraft: (value: Connection) => void; connecting: boolean; onTest: () => void; onConnect: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogTrigger asChild><Button size="sm" className="bg-signal text-slate-950 hover:bg-signal/90"><Plus /> 新建连接</Button></DialogTrigger><DialogContent className="border-border bg-card sm:max-w-xl"><DialogHeader><DialogTitle>连接 ClickHouse</DialogTitle><DialogDescription>使用 ClickHouse HTTP 接口。凭据仅保存在当前页面内存中。</DialogDescription></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><Field label="HTTP(S) 地址" className="sm:col-span-2"><Input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} className="font-mono" /></Field><Field label="用户名"><Input value={draft.user} onChange={(event) => setDraft({ ...draft, user: event.target.value })} /></Field><Field label="密码"><Input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="可留空" /></Field><Field label="默认数据库" className="sm:col-span-2"><Input value={draft.database} onChange={(event) => setDraft({ ...draft, database: event.target.value })} /></Field></div><p className="text-xs text-muted-foreground">开发模式可连接 localhost；生产环境默认仅允许公网 HTTPS 地址。</p><DialogFooter><Button variant="outline" onClick={onTest} disabled={connecting}>{connecting && <Loader2 className="animate-spin" />}测试连接</Button><Button onClick={onConnect} disabled={connecting} className="bg-signal text-slate-950 hover:bg-signal/90">连接</Button></DialogFooter></DialogContent></Dialog>;
}

function PageHeader({ view, clusterName, version, search, setSearch, refreshing, connected, onRefresh }: { view: View; clusterName: string; version: string; search: string; setSearch: (value: string) => void; refreshing: boolean; connected: boolean; onRefresh: () => void }) {
  const titles = { overview: ["数据概览", "查看集群规模、热门数据表和实时样本"], explorer: ["数据浏览", "检查表结构并预览最多 100 行数据"], sql: ["SQL 工作台", "在安全的只读模式下分析 ClickHouse 数据"], imports: ["导入任务", "将 CSV 或 JSONEachRow 文件写入现有数据表"] };
  return <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Server className="size-3.5" /> {clusterName} <span>/</span> ClickHouse {version}</div><h1 className="text-2xl font-semibold tracking-[-0.025em]">{titles[view][0]}</h1><p className="mt-1 text-sm text-muted-foreground">{titles[view][1]}</p></div><div className="flex w-full gap-2 lg:w-auto">{(view === "overview" || view === "explorer") && <div className="relative min-w-0 flex-1 lg:w-80"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 bg-card pl-9" placeholder="搜索数据表…" /></div>}<Button variant="outline" size="icon-lg" onClick={onRefresh} disabled={refreshing || !connected} aria-label={connected ? "刷新" : "连接 ClickHouse 后刷新"}><RefreshCw className={refreshing ? "animate-spin" : ""} /></Button></div></div>;
}

function Overview({ metrics, tables, preview, previewTitle, sql, setSql, querying, runQuery, onTable, onBrowseAll, onShowSchema }: { metrics: Record<string, number | string>; tables: TableInfo[]; preview: QueryResult; previewTitle: string; sql: string; setSql: (value: string) => void; querying: boolean; runQuery: () => void; onTable: (table: TableInfo) => void; onBrowseAll: () => void; onShowSchema: () => void }) {
  return <><div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Database} label="数据库" value={formatNumber(metrics.databases)} note="业务数据库" /><MetricCard icon={Table2} label="数据表" value={formatNumber(metrics.tables)} note="非系统表" /><MetricCard icon={HardDrive} label="有效数据" value={formatBytes(metrics.total_bytes)} note={`${formatNumber(metrics.total_rows)} 行`} /><MetricCard icon={Activity} label="运行时长" value={formatDuration(metrics.uptime)} note="当前节点" /></div><div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.38fr)]"><TableList tables={tables.slice(0, 6)} onTable={onTable} onBrowseAll={onBrowseAll} /><DataPreview result={preview} title={previewTitle} onShowSchema={onShowSchema} /></div><QueryEditor sql={sql} setSql={setSql} querying={querying} runQuery={runQuery} compact /></>;
}

function Explorer({ tables, selected, preview, columns, loading, tab, setTab, onTable }: { tables: TableInfo[]; selected: TableInfo; preview: QueryResult; columns: ColumnInfo[]; loading: boolean; tab: "data" | "schema"; setTab: (value: "data" | "schema") => void; onTable: (table: TableInfo) => void }) {
  return <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]"><section className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border px-4 py-3.5"><h2 className="text-sm font-semibold">{selected.database}</h2><p className="mt-0.5 text-xs text-muted-foreground">{tables.length} 张数据表</p></div><div className="max-h-[650px] overflow-auto p-2">{tables.map((table) => <button key={`${table.database}.${table.name}`} onClick={() => onTable(table)} className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition ${selected.name === table.name ? "bg-signal/10 text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}><Table2 className={selected.name === table.name ? "size-4 text-signal" : "size-4"} /><span className="min-w-0 flex-1 truncate font-mono text-xs">{table.name}</span><span className="font-mono text-[10px]">{formatCompact(table.total_rows)}</span></button>)}</div></section><section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3.5"><div><h2 className="font-mono text-sm font-semibold">{selected.database}.{selected.name}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.engine} · {formatNumber(selected.total_rows)} 行 · {formatBytes(selected.total_bytes)}</p></div>{loading && <Loader2 className="size-4 animate-spin text-signal" />}</div><Tabs value={tab} onValueChange={(value) => setTab(value as "data" | "schema")} className="gap-0"><TabsList variant="line" className="mx-4 mt-2"><TabsTrigger value="data">数据预览</TabsTrigger><TabsTrigger value="schema">表结构</TabsTrigger></TabsList><TabsContent value="data"><ResultTable result={preview} /></TabsContent><TabsContent value="schema"><Table><TableHeader><TableRow className="bg-muted/35 hover:bg-muted/35"><TableHead>#</TableHead><TableHead>字段</TableHead><TableHead>类型</TableHead><TableHead>默认值</TableHead><TableHead>压缩编码</TableHead></TableRow></TableHeader><TableBody>{columns.map((column) => <TableRow key={column.name}><TableCell className="font-mono text-xs text-muted-foreground">{column.position}</TableCell><TableCell className="font-mono text-xs">{column.name}</TableCell><TableCell className="font-mono text-xs text-sky-300">{column.type}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{column.default_expression || "—"}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{column.compression_codec || "—"}</TableCell></TableRow>)}</TableBody></Table></TabsContent></Tabs></section></div>;
}

function TableList({ tables, onTable, onBrowseAll }: { tables: TableInfo[]; onTable: (table: TableInfo) => void; onBrowseAll: () => void }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3.5"><div><h2 className="text-sm font-semibold">热门数据表</h2><p className="mt-0.5 text-xs text-muted-foreground">按磁盘占用排序</p></div><Button variant="ghost" size="sm" onClick={onBrowseAll}>查看全部 <ArrowRight /></Button></div><Table><TableHeader><TableRow className="bg-muted/35 hover:bg-muted/35"><TableHead>表名</TableHead><TableHead>引擎</TableHead><TableHead className="text-right">行数</TableHead><TableHead className="text-right">大小</TableHead></TableRow></TableHeader><TableBody>{tables.map((table) => <TableRow key={`${table.database}.${table.name}`} className="cursor-pointer" onClick={() => onTable(table)}><TableCell className="font-mono text-xs">{table.name}</TableCell><TableCell className="text-xs text-muted-foreground">{table.engine}</TableCell><TableCell className="text-right font-mono text-xs">{formatCompact(table.total_rows)}</TableCell><TableCell className="text-right font-mono text-xs text-muted-foreground">{formatBytes(table.total_bytes)}</TableCell></TableRow>)}</TableBody></Table></section>;
}

function DataPreview({ result, title, onShowSchema }: { result: QueryResult; title: string; onShowSchema: () => void }) { return <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3.5"><div><div className="flex items-center gap-2"><h2 className="font-mono text-sm font-semibold">{title}</h2><Badge variant="secondary">预览</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">最近 {result.data.length} 行</p></div><Button variant="outline" size="sm" onClick={onShowSchema}><Columns3 /> 字段</Button></div><ResultTable result={result} /></section>; }

function MetricCard({ icon: Icon, label, value, note }: { icon: typeof Database; label: string; value: string; note: string }) { return <article className="rounded-xl border border-border bg-card p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className="size-4 text-muted-foreground" /></div><div className="mt-5 flex items-end justify-between gap-2"><strong className="font-mono text-2xl font-semibold tracking-tight">{value}</strong><span className="pb-0.5 text-xs text-muted-foreground">{note}</span></div></article>; }
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) { return <label className={`grid gap-1.5 text-sm ${className}`}>{label}{children}</label>; }
function NavItem({ icon: Icon, label, active, badge, onClick }: { icon: typeof Activity; label: string; active?: boolean; badge?: string; onClick: () => void }) { return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition ${active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}><Icon className={`size-4 ${active ? "text-signal" : ""}`} /><span>{label}</span>{badge && <span className="ml-auto rounded-full bg-signal/15 px-1.5 py-0.5 font-mono text-[10px] text-signal">{badge}</span>}</button>; }
function MobileNav({ icon: Icon, label, active, onClick }: { icon: typeof Activity; label: string; active?: boolean; onClick: () => void }) { return <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick}><Icon className={active ? "text-signal" : ""} />{label}</Button>; }

function formatNumber(value: unknown) { const number = Number(value ?? 0); return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : String(value ?? "—"); }
function formatCompact(value: unknown) { const number = Number(value ?? 0); return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(number) : String(value ?? "—"); }
function formatBytes(value: unknown) { const bytes = Number(value ?? 0); if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB", "PB"]; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`; }
function formatDuration(value: unknown) { const seconds = Number(value ?? 0); if (!Number.isFinite(seconds)) return "—"; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; return `${Math.floor(seconds / 86400)}d`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作失败"; }
