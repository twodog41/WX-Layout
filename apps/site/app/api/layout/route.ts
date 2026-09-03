import { OpenAICompatibleProvider, suggestLayout } from "@wx-layout/ai-layout";
import { errorJson, json } from "../../../lib/http";
import { publicAIErrorMessage, requestProviderConfig } from "../../../lib/provider-config";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const markdown = body?.markdown;
  const instruction = body?.instruction;
  const creativity = body?.creativity;
  if (typeof markdown !== "string" || !markdown.trim()) return errorJson("invalid_markdown", "文章正文不能为空。", 400);
  if (markdown.length > 50_000) return errorJson("article_too_large", "当前 AI 排版最多处理 50,000 个字符。", 413);
  if (instruction !== undefined && (typeof instruction !== "string" || instruction.length > 500)) return errorJson("invalid_instruction", "排版要求最多为 500 个字符。", 400);
  if (creativity !== undefined && (typeof creativity !== "number" || !Number.isInteger(creativity) || creativity < 0 || creativity > 100)) {
    return errorJson("invalid_creativity", "创作自由度必须是 0 到 100 的整数。", 400);
  }
  try {
    const config = requestProviderConfig(body?.provider);
    const result = await suggestLayout(
      markdown,
      new OpenAICompatibleProvider(config),
      typeof instruction === "string" ? instruction : undefined,
      typeof creativity === "number" ? creativity : 35
    );
    return json(result);
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : "生成排版建议失败。";
    const message = publicAIErrorMessage(internalMessage);
    const timeout = internalMessage.includes("秒内未响应") || internalMessage.includes("请求超时");
    const configuration = /API 地址|API Key|AI_MODEL|HTTPS|协议|AI 排版面板/.test(internalMessage);
    return errorJson(timeout ? "ai_timeout" : configuration ? "invalid_ai_configuration" : "ai_layout_failed", message, timeout ? 504 : configuration ? 400 : 502);
  }
}
