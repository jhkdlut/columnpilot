import { RequestError } from "../http/errors";

export function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("对象格式无效", 400);
  const result = value as Record<string, unknown>;
  if (keys && Object.keys(result).some((key) => !keys.includes(key))) throw new RequestError("包含不支持的字段", 400);
  return result;
}

export function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) {
    throw new RequestError("文本字段为空、过长或包含无效字符", 400);
  }
  return value;
}

export function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new RequestError("列表格式无效或超过上限", 400);
  return value;
}

export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new RequestError("数值超出允许范围", 400);
  return value;
}
