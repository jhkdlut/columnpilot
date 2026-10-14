import { NextRequest, NextResponse } from "next/server";
import { catalog, loadSchema, readConnection } from "@/lib/ai/catalog";
import { getProvider } from "@/lib/ai/provider";
import { executePlan, explainResult, planQuestion } from "@/lib/ai/service";
import { object, text } from "@/lib/ai/validation";
import { readBoundedJson } from "@/lib/http/request-body";
import { RequestError } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "cache-control": "no-store" } }); }
function failure(error: unknown) {
  return json({ ok: false, error: error instanceof RequestError ? error.message : "请求失败，请检查连接、数据库权限和输入内容" }, error instanceof RequestError ? error.status : 400);
}

export function GET() {
  try {
    const provider = getProvider();
    return json({ ok: true, result: { mode: provider?.mode ?? "disabled", model: provider?.model ?? "", realModelVerified: false } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = object(await readBoundedJson(request), ["action", "connection", "table", "question", "history", "ticket", "consent"]);
    const connection = readConnection(body.connection);
    let result: unknown;
    switch (body.action) {
      case "databases": case "tables": result = await catalog(connection, request.url, body.action); break;
      case "schema": result = await loadSchema(connection, text(body.table), request.url); break;
      case "plan": result = await planQuestion(connection, text(body.table), body.question, body.history, request.url); break;
      case "execute": result = await executePlan(connection, body.ticket, request.url); break;
      case "explain": result = await explainResult(connection, body.ticket, body.consent); break;
      default: throw new RequestError("不支持的智能问数操作", 400);
    }
    return json({ ok: true, result });
  } catch (error) { return failure(error); }
}
