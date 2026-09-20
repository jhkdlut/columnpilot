export type View = "overview" | "explorer" | "sql" | "imports";

export type TableInfo = {
  database: string;
  name: string;
  engine: string;
  total_rows: number | string | null;
  total_bytes: number | string | null;
  metadata_modification_time?: string;
};

export type ColumnInfo = {
  name: string;
  type: string;
  position: number;
  default_kind?: string;
  default_expression?: string;
  compression_codec?: string;
};

export type ImportJob = {
  file: string;
  target: string;
  status: "完成" | "失败" | "上传中";
  rows: string;
  size: string;
  time: string;
};
