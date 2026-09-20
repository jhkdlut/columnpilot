"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPaginationWindow } from "@/lib/clickhouse/pagination";
import type { ClickHouseQueryResult } from "@/lib/clickhouse/types";

export function ResultTable({ result }: { result: ClickHouseQueryResult }) {
  const [requestedPage, setRequestedPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const meta = result.meta ?? [];
  const rows = result.data ?? [];
  const page = getPaginationWindow(rows.length, requestedPage, pageSize);
  const visibleRows = rows.slice(page.start, page.end);
  return (
    <div>
      <div className="max-h-[520px] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="bg-muted/70 hover:bg-muted/70">
              {meta.map((column) => (
                <TableHead key={column.name} className="font-mono text-xs">
                  <span>{column.name}</span>
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">{column.type}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length ? visibleRows.map((row, rowIndex) => (
              <TableRow key={page.start + rowIndex}>
                {meta.map((column) => (
                  <TableCell
                    key={column.name}
                    className="max-w-64 truncate font-mono text-xs"
                    title={displayValue(row[column.name])}
                  >
                    {displayValue(row[column.name])}
                  </TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={Math.max(meta.length, 1)} className="h-32 text-center text-muted-foreground">
                  查询未返回数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
        <span aria-live="polite">
          {page.total ? `${page.start + 1}–${page.end} / ${page.total} 行` : "0 行"}
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            每页
            <NativeSelect
              size="sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setRequestedPage(0);
              }}
              aria-label="每页显示行数"
            >
              {[25, 50, 100].map((size) => <NativeSelectOption key={size} value={size}>{size}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <span className="min-w-16 text-center">{page.pageIndex + 1} / {page.pageCount}</span>
          <Button variant="outline" size="icon-sm" aria-label="上一页" disabled={page.pageIndex === 0} onClick={() => setRequestedPage(page.pageIndex - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="下一页" disabled={page.pageIndex >= page.pageCount - 1} onClick={() => setRequestedPage(page.pageIndex + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function displayValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
