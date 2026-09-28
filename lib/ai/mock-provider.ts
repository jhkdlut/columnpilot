import type { AiProvider, ModelPlan, PlanInput, QueryPlan } from "./types";

export function mockPlan(input: PlanInput): ModelPlan {
  const question = input.question.trim();
  const plan: QueryPlan = { table: input.schema.table, columns: [], filters: [], aggregations: [], groupBy: [], orderBy: [], limit: 100 };
  let match: RegExpExecArray | null;
  if (/^查看前 (\d+) 条记录$/.test(question)) {
    plan.columns = input.schema.columns.slice(0, 10).map((column) => column.name);
    plan.limit = Number(/^查看前 (\d+) 条记录$/.exec(question)![1]);
  } else if (question === "统计记录总数") {
    plan.aggregations = [{ fn: "count" }];
  } else if ((match = /^(?:最近 (\d+) 天)?按 (\S+) 统计 (\S+) 的(平均值|总和|最小值|最大值)$/.exec(question))) {
    plan.columns = [match[2]];
    plan.groupBy = [match[2]];
    const fn = { 平均值: "avg", 总和: "sum", 最小值: "min", 最大值: "max" }[match[4]] as "avg" | "sum" | "min" | "max";
    plan.aggregations = [{ fn, column: match[3] }];
    plan.orderBy = [{ column: "metric_1", direction: "desc" }];
    if (match[1]) {
      const time = input.schema.columns.find((column) => column.type.startsWith("DateTime"));
      if (!time) return { kind: "clarification", message: "请选择包含 DateTime 字段的表，或移除最近天数条件。" };
      plan.filters.push({ column: time.name, op: "lastDays", value: Number(match[1]) });
    }
  } else if ((match = /^(\S+) 最大的 (\d+) 条记录$/.exec(question))) {
    plan.columns = [...new Set([match[1], ...input.schema.columns.slice(0, 9).map((column) => column.name)])];
    plan.orderBy = [{ column: match[1], direction: "desc" }];
    plan.limit = Number(match[2]);
  } else if ((match = /^筛选 (\S+) (=|!=|>=|<=|>|<|包含) (.+)$/.exec(question))) {
    plan.columns = [...new Set([match[1], ...input.schema.columns.slice(0, 9).map((column) => column.name)])];
    const operators = { "=": "eq", "!=": "neq", ">=": "gte", "<=": "lte", ">": "gt", "<": "lt", 包含: "contains" } as const;
    plan.filters = [{ column: match[1], op: operators[match[2] as keyof typeof operators], value: match[3] }];
  } else if ((match = /^改为最近 (\d+) 天$/.exec(question))) {
    const previous = input.history.at(-1)?.plan;
    const time = input.schema.columns.find((column) => column.type.startsWith("DateTime"));
    if (!previous || !time) return { kind: "clarification", message: "先生成一个查询，并选择包含 DateTime 字段的表。" };
    return { kind: "plan", plan: { ...previous, filters: [...previous.filters.filter((filter) => filter.column !== time.name), { column: time.name, op: "lastDays", value: Number(match[1]) }] } };
  } else if ((match = /^只看 (\S+) = (.+)$/.exec(question))) {
    const previous = input.history.at(-1)?.plan;
    if (!previous) return { kind: "clarification", message: "请先生成一个查询，再追加字段条件。" };
    return { kind: "plan", plan: { ...previous, filters: [...previous.filters.filter((filter) => filter.column !== match![1]), { column: match[1], op: "eq", value: match[2] }] } };
  } else {
    return { kind: "clarification", message: "模拟模式仅支持页面列出的示例句式。请使用实际字段名；复杂问题和数据修改不在本版范围内。" };
  }
  return { kind: "plan", plan };
}

export const mockProvider: AiProvider = {
  mode: "mock",
  model: "deterministic-fixtures",
  plan: async (input) => mockPlan(input),
  explain: async (sample) => `模拟解释：本次查询返回 ${sample.returnedRows} 行，提供了 ${sample.rows.length} 行用于解释。${sample.queryTruncated || sample.sampleTruncated ? "数据范围有限，不能据此推断全表结论。" : "结果范围以已执行的 SQL 条件为准。"}此文本来自固定联调逻辑，尚未接入真实模型。`,
};
