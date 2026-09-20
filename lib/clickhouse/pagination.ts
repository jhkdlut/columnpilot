export type PaginationWindow = {
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  start: number;
  end: number;
  total: number;
};

export function getPaginationWindow(
  totalRows: number,
  requestedPage: number,
  requestedPageSize: number,
): PaginationWindow {
  const total = Math.max(0, Math.floor(Number.isFinite(totalRows) ? totalRows : 0));
  const pageSize = Math.max(1, Math.floor(Number.isFinite(requestedPageSize) ? requestedPageSize : 25));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.min(Math.max(0, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 0)), pageCount - 1);
  const start = Math.min(total, pageIndex * pageSize);
  const end = Math.min(total, start + pageSize);
  return { pageIndex, pageCount, pageSize, start, end, total };
}
