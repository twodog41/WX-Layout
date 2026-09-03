import { layoutPlanJsonSchema } from "./schema.js";
import { buildLayoutInput, creativityProfile, layoutSystemPrompt } from "./prompt.js";
import type { LayoutProvider, LayoutProviderRequest } from "./types.js";

export type AIProtocol = "responses" | "chat-completions";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol?: AIProtocol;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path}`;
}

function isDeepSeekEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function parseJsonText(value: string): unknown {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  const candidates = [
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
    fenced,
    firstObject >= 0 && lastObject > firstObject ? trimmed.slice(firstObject, lastObject + 1) : undefined
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next common provider response shape.
    }
  }
  throw new Error("模型没有返回可用的结构化排版结果。请使用 Responses 协议后重试。" );
}

function extractResponsesText(response: unknown): string {
  if (!response || typeof response !== "object") throw new Error("模型响应不是有效对象。");
  const record = response as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) throw new Error("模型响应缺少 output_text。" );

  // Responses providers such as DeepSeek can place a reasoning item before the
  // final assistant message. Only the message's output_text is user-visible.
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.type !== "message") continue;
    const content = itemRecord.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type !== "output_text") continue;
      const text = partRecord.text;
      if (typeof text === "string") return text;
    }
  }
  throw new Error("模型响应中没有可读取的文本。" );
}

function extractChatText(response: unknown): string {
  if (!response || typeof response !== "object") throw new Error("模型响应不是有效对象。");
  const choices = (response as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("模型响应缺少 choices。" );
  const first = choices[0];
  if (!first || typeof first !== "object") throw new Error("模型响应 choices 无效。" );
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") throw new Error("模型响应缺少 message。" );
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") throw new Error("模型响应缺少文本内容。" );
  return content;
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = `模型服务返回 HTTP ${response.status}`;
  try {
    const body = await response.json() as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export class OpenAICompatibleProvider implements LayoutProvider {
  readonly #options: Required<Omit<OpenAICompatibleProviderOptions, "fetch">> & { fetch: typeof globalThis.fetch };

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.apiKey) throw new Error("缺少 AI_API_KEY。" );
    if (!options.model) throw new Error("缺少 AI_MODEL。" );
    this.#options = {
      ...options,
      protocol: options.protocol ?? "responses",
      fetch: options.fetch ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? 90_000
    };
  }

  async createPlan(request: LayoutProviderRequest): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);

    try {
      const isResponses = this.#options.protocol === "responses";
      const isDeepSeek = isDeepSeekEndpoint(this.#options.baseUrl);
      const url = endpoint(this.#options.baseUrl, isResponses ? "responses" : "chat/completions");
      const input = buildLayoutInput(request);
      const profile = creativityProfile(request.creativity);
      const deepSeekTemperature = 0.2 + (profile.level / 100) * 0.6;
      const body = isResponses
        ? {
            model: this.#options.model,
            store: false,
            instructions: layoutSystemPrompt,
            input,
            max_output_tokens: 4_000,
            ...(isDeepSeek ? { reasoning: { effort: "none" }, temperature: Number(deepSeekTemperature.toFixed(2)) } : {}),
            text: {
              format: {
                type: "json_schema",
                name: "wechat_layout_plan",
                strict: true,
                schema: layoutPlanJsonSchema
              }
            }
          }
        : {
            model: this.#options.model,
            messages: [
              { role: "system", content: layoutSystemPrompt },
              { role: "user", content: input }
            ],
            max_tokens: 4_000,
            ...(isDeepSeek ? { thinking: { type: "disabled" }, temperature: Number(deepSeekTemperature.toFixed(2)) } : {}),
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "wechat_layout_plan",
                strict: true,
                schema: layoutPlanJsonSchema
              }
            }
          };

      const response = await this.#options.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(await errorMessage(response));
      const payload: unknown = await response.json();
      return parseJsonText(isResponses ? extractResponsesText(payload) : extractChatText(payload));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`模型在 ${Math.round(this.#options.timeoutMs / 1000)} 秒内未响应，请检查网络后重试。` );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
