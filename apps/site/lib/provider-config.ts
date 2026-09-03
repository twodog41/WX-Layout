import type { AIProtocol } from "@wx-layout/ai-layout";

export interface RequestProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol: AIProtocol;
}

export function requestProviderConfig(value: unknown): RequestProviderConfig {
  if (!value || typeof value !== "object") throw new Error("请在 AI 排版面板中填写 API 配置。" );
  const input = value as Record<string, unknown>;
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const protocol = input.protocol;
  if (!apiKey || apiKey.length > 4096) throw new Error("请填写有效的 API Key。" );
  if (!model || model.length > 200) throw new Error("请填写有效的模型 ID。" );
  if (protocol !== "responses" && protocol !== "chat-completions") throw new Error("请选择有效的 API 协议。" );
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("API 地址不是有效 URL。" );
  }
  if (url.protocol !== "https:") throw new Error("网页版只能连接使用 HTTPS 的模型 API。" );
  if (url.username || url.password) throw new Error("API 地址中不能包含用户名或密码。" );
  return { apiKey, model, protocol, baseUrl: url.toString().replace(/\/$/, "") };
}

export function publicAIErrorMessage(message: string): string {
  if (/"(?:origin|code|path)"\s*:|expected array to have|ZodError/i.test(message)) {
    return "模型返回的排版方案格式不完整，已安全拒绝。请重新生成；若仍出现，可适当降低创作自由度。";
  }
  return message;
}
