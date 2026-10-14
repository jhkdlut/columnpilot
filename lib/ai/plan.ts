import { RequestError } from "../http/errors";
import { sqlString } from "../clickhouse/server";
import { integer, list, object, text } from "./validation";
import type { AiColumn, AiSchema, Filter, QueryPlan } from "./types";

export function identifier(value: string) {
  return `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
}

export function scalarType(column: AiColumn): string {
  let type = column.type;
  for (let depth = 0; depth < 2; depth++) {
    const wrapper = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(type);
    if (wrapper) type = wrapper[1];
  }
  if (/^Enum(?:8|16)\(/.test(type)) return "String";
  if (/^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|String|Date|Date32|UUID)$/.test(type)) return type;
  if (/^DateTime(?:64\([0-9](?:, '[A-Za-z0-9_+\-/]+')?\)|\('[A-Za-z0-9_+\-/]+'\))?$/.test(type)) return type;
  throw new RequestError(`首版暂不支持字段类型 ${column.name}: ${column.type}`, 400);
}

function numeric(type: string) { return /^(?:U?Int|Float)/.test(type); }

export function compilePlan(value: unknown, schema: AiSchema, now = new Date()) {
  const raw = object(value, ["table", "columns", "filters", "aggregations", "groupBy", "orderBy", "limit"]);
  if (raw.table !== schema.table) throw new RequestError("查询只能使用当前选中的表", 400);
  const fields = new Map(schema.columns.map((column) => [column.name, column]));
  const field = (value: unknown) => {
    const name = text(value);
    const column = fields.get(name);
    if (!column) throw new RequestError(`字段不存在：${name}`, 400);
    scalarType(column);
    return name;
  };
  const names = (value: unknown, max: number) => {
    const result = list(value, max).map(field);
    if (new Set(result).size !== result.length) throw new RequestError("字段不能重复", 400);
    return result;
  };
  const columns = names(raw.columns, 20);
  const groupBy = names(raw.groupBy, 5);
  const aggregations: QueryPlan["aggregations"] = list(raw.aggregations, 5).map((value) => {
    const entry = object(value, ["fn", "column"]);
    if (!["count", "sum", "avg", "min", "max"].includes(String(entry.fn))) throw new RequestError("不支持的聚合函数", 400);
    const fn = entry.fn as QueryPlan["aggregations"][number]["fn"];
    if (fn === "count" && entry.column === undefined) return { fn };
    const column = field(entry.column);
    if (["sum", "avg"].includes(fn) && !numeric(scalarType(fields.get(column)!))) throw new RequestError("求和或平均值需要数值字段", 400);
    return { fn, column };
  });
  if (!columns.length && !aggregations.length) throw new RequestError("请选择字段或聚合指标", 400);
  if (aggregations.length && (columns.length !== groupBy.length || columns.some((name) => !groupBy.includes(name)))) throw new RequestError("聚合查询的普通字段必须与分组字段一致", 400);
  if (!aggregations.length && groupBy.length) throw new RequestError("分组查询需要聚合指标", 400);
  const filters: Filter[] = [];
  for (const entry of list(raw.filters, 20)) {
    const filter = object(entry, ["column", "op", "value"]);
    const column = field(filter.column);
    const type = scalarType(fields.get(column)!);
    const op = text(filter.op) as Filter["op"];
    if (!["eq", "neq", "gt", "gte", "lt", "lte", "contains", "isNull", "notNull", "lastDays"].includes(op)) throw new RequestError("不支持的筛选操作", 400);
    if (op === "isNull" || op === "notNull") {
      if (filter.value !== undefined) throw new RequestError("空值判断不接受参数", 400);
      filters.push({ column, op });
      continue;
    }
    if (op === "lastDays") {
      if (!type.startsWith("Date")) throw new RequestError("相对日期需要日期字段", 400);
      const days = integer(filter.value, 1, 3660);
      const format = (date: Date) => type === "Date" || type === "Date32" ? date.toISOString().slice(0, 10) : date.toISOString();
      filters.push({ column, op: "gte", value: format(new Date(now.getTime() - days * 86_400_000)) }, { column, op: "lt", value: format(now) });
      continue;
    }
    if (op === "contains" && type !== "String") throw new RequestError("包含筛选只支持文本字段", 400);
    let literal: string | number;
    if (numeric(type)) {
      if (typeof filter.value !== "string" && typeof filter.value !== "number") throw new RequestError("数值筛选格式无效", 400);
      literal = String(filter.value);
      if (/^U?Int/.test(type) && typeof filter.value === "number" && !Number.isSafeInteger(filter.value)) throw new RequestError("大整数请使用字符串避免精度丢失", 400);
      if (literal.length > 100 || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(literal) || !Number.isFinite(Number(literal))) throw new RequestError("数值筛选格式无效", 400);
      if (/^U?Int/.test(type) && (!/^-?\d+$/.test(literal) || (type.startsWith("UInt") && literal.startsWith("-")))) throw new RequestError("整数筛选格式无效", 400);
      const integerType = /^(U?)Int(\d+)$/.exec(type);
      if (integerType) {
        const unsigned = integerType[1] === "U";
        const magnitude = BigInt(2) ** BigInt(Number(integerType[2]) - (unsigned ? 0 : 1));
        if (BigInt(literal) < (unsigned ? BigInt(0) : -magnitude) || BigInt(literal) >= magnitude) throw new RequestError("筛选值超出字段整数范围", 400);
      }
      if (type === "Float32" && !Number.isFinite(Math.fround(Number(literal)))) throw new RequestError("筛选值超出 Float32 范围", 400);
    } else {
      literal = text(filter.value, 1000);
      if (type.startsWith("Date") && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(literal) || !Number.isFinite(Date.parse(literal)))) throw new RequestError("日期应使用 UTC ISO 格式", 400);
      if (type.startsWith("Date") && new Date(literal).toISOString().slice(0, 10) !== literal.slice(0, 10)) throw new RequestError("日期不存在", 400);
    }
    filters.push({ column, op, value: literal });
  }
  if (filters.length > 20) throw new RequestError("筛选条件不能超过 20 个", 400);
  const aliases = aggregations.map((_, index) => `metric_${index + 1}`);
  if (aliases.some((alias) => fields.has(alias))) throw new RequestError("表字段与聚合结果名称冲突", 400);
  const outputs = new Set([...columns, ...aliases]);
  const orderBy: QueryPlan["orderBy"] = list(raw.orderBy, 5).map((value) => {
    const entry = object(value, ["column", "direction"]);
    const column = text(entry.column);
    if (!outputs.has(column) || !["asc", "desc"].includes(String(entry.direction))) throw new RequestError("排序必须使用输出字段和 asc/desc", 400);
    return { column, direction: entry.direction as "asc" | "desc" };
  });
  const limit = integer(raw.limit, 1, 500);
  const plan: QueryPlan = { table: schema.table, columns, filters, aggregations, groupBy, orderBy, limit };
  const parameters: Record<string, string> = {};
  const conditions = filters.map((filter, index) => {
    const column = identifier(filter.column);
    if (filter.op === "isNull" || filter.op === "notNull") return `${column} IS ${filter.op === "notNull" ? "NOT " : ""}NULL`;
    const type = scalarType(fields.get(filter.column)!);
    const key = `ai_${index}`;
    parameters[key] = String(filter.value);
    const parameter = `{${key}:String}`;
    const rhs = type.startsWith("DateTime") ? `parseDateTime64BestEffort(${parameter}, 3, 'UTC')` : `CAST(${parameter}, ${sqlString(type)})`;
    if (filter.op === "contains") return `position(${column}, ${parameter}) > 0`;
    const operators = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    return `${column} ${operators[filter.op as keyof typeof operators]} ${rhs}`;
  });
  const selections = [...columns.map(identifier), ...aggregations.map((item, index) => `${item.fn}(${item.column ? identifier(item.column) : ""}) AS ${identifier(aliases[index])}`)];
  const sql = [
    `SELECT ${selections.join(", ")}`,
    `FROM ${identifier(schema.database)}.${identifier(schema.table)}`,
    conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    groupBy.length ? `GROUP BY ${groupBy.map(identifier).join(", ")}` : "",
    orderBy.length ? `ORDER BY ${orderBy.map((item) => `${identifier(item.column)} ${item.direction.toUpperCase()}`).join(", ")}` : "",
    `LIMIT ${limit + 1}`,
  ].filter(Boolean).join("\n");
  return { plan, sql, parameters };
}
