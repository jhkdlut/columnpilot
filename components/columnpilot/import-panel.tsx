import { AlertTriangle, CheckCircle2, FileCode2, FileUp, Loader2, UploadCloud } from "lucide-react";
import type { ImportJob, TableInfo } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportFormat, ImportPreview } from "@/lib/clickhouse/import-preview";

export function ImportPanel({
  connected,
  file,
  setFile,
  database,
  tables,
  table,
  setTable,
  format,
  setFormat,
  preview,
  previewing,
  importing,
  progress,
  jobs,
  startImport,
}: {
  connected: boolean;
  file: File | null;
  setFile: (file: File | null) => void;
  database: string;
  tables: TableInfo[];
  table: string;
  setTable: (value: string) => void;
  format: ImportFormat;
  setFormat: (value: ImportFormat) => void;
  preview: ImportPreview | null;
  previewing: boolean;
  importing: boolean;
  progress: number;
  jobs: ImportJob[];
  startImport: () => void;
}) {
  const canImport = connected && !!file && !!preview && !preview.errors.length && !previewing && !importing;
  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-signal/10 p-2.5 text-signal"><UploadCloud className="size-5" /></div>
          <div><h2 className="text-sm font-semibold">导入新数据</h2><p className="mt-0.5 text-xs text-muted-foreground">写入现有 ClickHouse 数据表</p></div>
        </div>
        <label className="mt-5 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-background/35 px-5 text-center transition hover:border-signal/50">
          <FileCode2 className="mb-3 size-7 text-muted-foreground" />
          <strong className="text-sm">{file ? file.name : "选择 CSV 或 JSONLines 文件"}</strong>
          <span className="mt-1 text-xs text-muted-foreground">单次最大 8 MB · 不在应用中留存</span>
          <Input type="file" accept=".csv,.jsonl,.ndjson,application/json,text/csv" className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
        </label>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="目标数据库"><Input value={database} disabled /></Field>
          <Field label="目标表">
            <NativeSelect value={table} onChange={(event) => setTable(event.target.value)} disabled={!connected || !tables.length} className="w-full">
              {tables.map((item) => <NativeSelectOption key={`${item.database}.${item.name}`} value={item.name}>{item.name}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <Field label="输入格式" className="sm:col-span-2">
            <NativeSelect value={format} onChange={(event) => setFormat(event.target.value as ImportFormat)} className="w-full">
              <NativeSelectOption value="CSVWithNames">CSVWithNames（首行为字段名）</NativeSelectOption>
              <NativeSelectOption value="CSV">CSV</NativeSelectOption>
              <NativeSelectOption value="JSONEachRow">JSONEachRow</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>

        {previewing && <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在分析文件…</p>}
        {preview && <ImportPreviewBlock preview={preview} />}
        {progress > 0 && <Progress value={progress} className="mt-5 bg-muted [&_[data-slot=progress-indicator]]:bg-signal" />}
        <Button className="mt-5 w-full bg-signal text-slate-950 hover:bg-signal/90" onClick={startImport} disabled={!canImport}>
          {importing ? <Loader2 className="animate-spin" /> : <FileUp />} {connected ? "开始导入" : "连接 ClickHouse 后导入"}
        </Button>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3.5"><h2 className="text-sm font-semibold">最近任务</h2><p className="mt-0.5 text-xs text-muted-foreground">当前会话中的真实导入结果</p></div>
        <Table>
          <TableHeader><TableRow className="bg-muted/35 hover:bg-muted/35"><TableHead>文件</TableHead><TableHead>目标表</TableHead><TableHead>状态</TableHead><TableHead className="text-right">行数</TableHead><TableHead className="text-right">大小</TableHead><TableHead className="text-right">时间</TableHead></TableRow></TableHeader>
          <TableBody>
            {jobs.length ? jobs.map((job, index) => (
              <TableRow key={`${job.file}-${index}`}>
                <TableCell className="font-mono text-xs">{job.file}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{job.target}</TableCell>
                <TableCell><Badge variant="outline" className={job.status === "完成" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : job.status === "失败" ? "border-red-400/25 bg-red-400/10 text-red-300" : "border-signal/25 bg-signal/10 text-signal"}>{job.status}</Badge></TableCell>
                <TableCell className="text-right font-mono text-xs">{job.rows}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{job.size}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{job.time}</TableCell>
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">当前会话还没有导入任务</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function ImportPreviewBlock({ preview }: { preview: ImportPreview }) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border bg-background/35">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          {preview.errors.length ? <AlertTriangle className="size-4 text-red-400" /> : <CheckCircle2 className="size-4 text-emerald-400" />}
          文件预览
        </div>
        <span className="text-xs text-muted-foreground">检测到 {preview.rowCount} 行 · 显示前 {preview.rows.length} 行</span>
      </div>
      {!!preview.errors.length && <div className="border-b border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">{preview.errors.join("；")}</div>}
      {!!preview.warnings.length && <div className="border-b border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">{preview.warnings.join("；")}</div>}
      {!!preview.headers.length && (
        <div className="max-h-64 overflow-auto">
          <Table>
            <TableHeader><TableRow className="bg-muted/50 hover:bg-muted/50">{preview.headers.map((header) => <TableHead key={header} className="whitespace-nowrap font-mono text-[11px]">{header}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{preview.rows.map((row, rowIndex) => <TableRow key={rowIndex}>{preview.headers.map((header, columnIndex) => <TableCell key={`${header}-${columnIndex}`} className="max-w-48 truncate font-mono text-[11px]" title={row[columnIndex] ?? ""}>{row[columnIndex] ?? ""}</TableCell>)}</TableRow>)}</TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`grid gap-1.5 text-sm ${className}`}>{label}{children}</label>;
}
