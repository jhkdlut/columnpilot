import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClickHouseQueryResult } from "@/lib/clickhouse/types";

export function ResultTable({ result }: { result: ClickHouseQueryResult }) {
  const meta = result.meta ?? [];
  return (
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
          {result.data?.length ? result.data.map((row, rowIndex) => (
            <TableRow key={rowIndex}>
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
  );
}

function displayValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
