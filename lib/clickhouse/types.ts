export type ClickHouseConnection = {
  endpoint: string;
  user: string;
  password?: string;
  database: string;
};

export type ClickHouseQueryResult = {
  meta: Array<{ name: string; type: string }>;
  data: Array<Record<string, unknown>>;
  rows?: number;
  statistics?: {
    elapsed?: number;
    rows_read?: number;
    bytes_read?: number;
  };
};
