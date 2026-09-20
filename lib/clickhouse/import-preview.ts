export type ImportFormat = "CSV" | "CSVWithNames" | "JSONEachRow";

export type ImportColumn = {
  name: string;
  type: string;
  position: number;
  default_kind?: string;
  default_expression?: string;
};

export type ImportPreview = {
  headers: string[];
  rows: string[][];
  rowCount: number;
  errors: string[];
  warnings: string[];
};

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_PREVIEW_ROWS = 20;

export function createImportPreview(
  text: string,
  format: ImportFormat,
  columns: ImportColumn[],
  maxPreviewRows = MAX_PREVIEW_ROWS,
): ImportPreview {
  const schema = [...columns].sort((left, right) => left.position - right.position);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schema.length) errors.push("无法读取目标表结构");

  if (format === "JSONEachRow") {
    const records: Array<Record<string, unknown>> = [];
    const headers: string[] = [];
    const seenHeaders = new Set<string>();
    const lines = stripBom(text).split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const value = JSON.parse(line) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          errors.push(`第 ${index + 1} 行不是 JSON 对象`);
          continue;
        }
        const record = value as Record<string, unknown>;
        records.push(record);
        for (const key of Object.keys(record)) {
          if (!seenHeaders.has(key)) {
            seenHeaders.add(key);
            headers.push(key);
          }
        }
      } catch {
        errors.push(`第 ${index + 1} 行不是有效的 JSON`);
      }
    }

    if (!records.length && !errors.length) errors.push("文件中没有可导入的数据行");
    validateHeaders(headers, schema, errors, warnings);

    return {
      headers,
      rows: records.slice(0, maxPreviewRows).map((record) =>
        headers.map((header) => displayImportValue(record[header])),
      ),
      rowCount: records.length,
      errors: unique(errors),
      warnings: unique(warnings),
    };
  }

  let parsedRows: string[][];
  try {
    parsedRows = parseCsv(stripBom(text));
  } catch (error) {
    return {
      headers: [],
      rows: [],
      rowCount: 0,
      errors: [error instanceof Error ? error.message : "CSV 解析失败"],
      warnings: [],
    };
  }

  const nonEmptyRows = parsedRows.filter((row) => row.some((cell) => cell.length > 0));
  const headers = format === "CSVWithNames"
    ? (nonEmptyRows.shift() ?? []).map((header) => header.trim())
    : schema.map((column) => column.name);

  if (!headers.length) errors.push(format === "CSVWithNames" ? "CSV 缺少表头" : "目标表没有可导入字段");
  validateHeaders(headers, schema, errors, warnings);

  const width = headers.length;
  const mismatchedIndex = nonEmptyRows.findIndex((row) => row.length !== width);
  if (mismatchedIndex >= 0) {
    const sourceLine = mismatchedIndex + (format === "CSVWithNames" ? 2 : 1);
    errors.push(`第 ${sourceLine} 行包含 ${nonEmptyRows[mismatchedIndex].length} 列，预期 ${width} 列`);
  }
  if (!nonEmptyRows.length && !errors.length) warnings.push("文件只有表头，没有数据行");

  return {
    headers,
    rows: nonEmptyRows.slice(0, maxPreviewRows),
    rowCount: nonEmptyRows.length,
    errors: unique(errors),
    warnings: unique(warnings),
  };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV 包含未闭合的引号");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function validateHeaders(
  headers: string[],
  schema: ImportColumn[],
  errors: string[],
  warnings: string[],
) {
  const emptyHeaders = headers.filter((header) => !header);
  if (emptyHeaders.length) errors.push("字段名不能为空");

  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length) errors.push(`存在重复字段：${unique(duplicates).join("、")}`);

  const schemaNames = new Set(schema.map((column) => column.name));
  const unknown = headers.filter((header) => header && !schemaNames.has(header));
  if (unknown.length) errors.push(`目标表不存在字段：${unique(unknown).join("、")}`);

  const imported = new Set(headers);
  const omitted = schema
    .filter((column) => !imported.has(column.name))
    .map((column) => column.name);
  if (omitted.length) warnings.push(`未提供字段将使用 ClickHouse 默认值：${omitted.join("、")}`);
}

function displayImportValue(value: unknown) {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
