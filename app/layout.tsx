import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ColumnPilot · ClickHouse 数据管理",
  description: "浏览 ClickHouse 数据结构、预览数据、运行 SQL 并管理导入任务。",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className="antialiased">{children}</body></html>;
}
