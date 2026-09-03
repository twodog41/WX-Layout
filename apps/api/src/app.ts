import {
  OpenAICompatibleProvider,
  suggestLayout,
  type AIProtocol,
  type LayoutProvider
} from "@wx-layout/ai-layout";
import Fastify, { type FastifyInstance } from "fastify";
import { fetchSupportedImage, searchOpenverseImages, searchPexelsImages } from "./images.js";
import { FileStarStore, type StarStore } from "./stars.js";

export interface AppOptions {
  provider?: LayoutProvider;
  providerFactory?: (config: RequestProviderConfig) => LayoutProvider;
  logger?: boolean;
  imageFetch?: typeof fetch;
  starStore?: StarStore;
}

export interface RequestProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  protocol: AIProtocol;
}

function configuredProvider(): LayoutProvider | undefined {
  const apiKey = process.env.AI_API_KEY?.trim();
  const model = process.env.AI_MODEL?.trim();
  if (!apiKey || !model) return undefined;

  const protocol = process.env.AI_PROTOCOL === "chat-completions" ? "chat-completions" : "responses";
  return new OpenAICompatibleProvider({
    apiKey,
    model,
    protocol: protocol satisfies AIProtocol,
    baseUrl: process.env.AI_BASE_URL?.trim() || "https://api.openai.com/v1"
  });
}

function errorPayload(code: string, message: string) {
  return { error: { code, message } };
}

function publicAIErrorMessage(message: string): string {
  if (/"(?:origin|code|path)"\s*:|expected array to have|ZodError/i.test(message)) {
    return "模型返回的排版方案格式不完整，已安全拒绝。请重新生成；若仍出现，可适当降低创作自由度。";
  }
  return message;
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(value);
}

function requestProviderConfig(value: unknown): RequestProviderConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("AI 配置格式不正确。" );

  const input = value as Record<string, unknown>;
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const baseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const protocol = input.protocol;

  if (!apiKey || apiKey.length > 4096) throw new Error("请填写有效的 API Key。" );
  if (!model || model.length > 200) throw new Error("请填写有效的模型 ID。" );
  if (protocol !== "responses" && protocol !== "chat-completions") {
    throw new Error("请选择有效的 API 协议。" );
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("API 地址不是有效 URL。" );
  }
  if (url.username || url.password) throw new Error("API 地址中不能包含用户名或密码。" );
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("API 地址只能使用 HTTPS；本机服务可使用 HTTP。" );
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (url.protocol === "http:" && !localHosts.has(url.hostname)) {
    throw new Error("非本机 API 地址必须使用 HTTPS。" );
  }

  return {
    apiKey,
    model,
    protocol,
    baseUrl: url.toString().replace(/\/$/, "")
  };
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== "test",
    bodyLimit: 200 * 1024
  });
  const provider = options.provider ?? configuredProvider();
  const starStore = options.starStore ?? new FileStarStore(
    process.env.WX_LAYOUT_DATA_DIR?.trim() || `${process.cwd()}/.data`
  );

  app.get("/api/health", async () => ({
    ok: true,
    ai: {
      configured: Boolean(provider),
      protocol: process.env.AI_PROTOCOL === "chat-completions" ? "chat-completions" : "responses",
      model: provider ? process.env.AI_MODEL ?? "injected-provider" : null
    }
  }));

  app.get<{ Querystring: { deviceId?: string } }>("/api/support/star", async (request, reply) => {
    const deviceId = request.query.deviceId;
    if (deviceId !== undefined && !validDeviceId(deviceId)) {
      return reply.code(400).send(errorPayload("invalid_device_id", "支持标识无效，请刷新页面后重试。"));
    }
    try {
      return reply.send(await starStore.status(deviceId));
    } catch {
      return reply.code(503).send(errorPayload("star_service_unavailable", "暂时无法读取支持数，请稍后再试。"));
    }
  });

  app.post<{ Body: { deviceId?: unknown } }>("/api/support/star", async (request, reply) => {
    const deviceId = request.body?.deviceId;
    if (!validDeviceId(deviceId)) {
      return reply.code(400).send(errorPayload("invalid_device_id", "支持标识无效，请刷新页面后重试。"));
    }
    try {
      return reply.send(await starStore.add(deviceId));
    } catch {
      return reply.code(503).send(errorPayload("star_service_unavailable", "暂时无法记录支持，请稍后再试。"));
    }
  });

  app.get<{ Querystring: { q?: string; limit?: string; orientation?: string } }>("/api/images/search", async (request, reply) => {
    const query = request.query.q?.trim() ?? "";
    if (!query || query.length > 100) {
      return reply.code(400).send(errorPayload("invalid_image_query", "配图搜索词应为 1 到 100 个字符。"));
    }
    const limit = Math.max(1, Math.min(8, Number.parseInt(request.query.limit ?? "6", 10) || 6));
    const orientation = request.query.orientation === "portrait" || request.query.orientation === "square"
      ? request.query.orientation
      : "landscape";
    try {
      const images = await searchOpenverseImages(query, orientation, options.imageFetch ?? globalThis.fetch, limit);
      return reply.send({ query, source: "Openverse", images });
    } catch (error) {
      const message = error instanceof Error ? error.message : "配图搜索失败。";
      return reply.code(502).send(errorPayload("image_search_failed", message));
    }
  });

  app.post<{ Body: { q?: unknown; limit?: unknown; orientation?: unknown; pexelsApiKey?: unknown } }>("/api/images/search", async (request, reply) => {
    const { q, limit, orientation, pexelsApiKey } = request.body ?? {};
    if (typeof q !== "string" || !q.trim() || q.length > 100) {
      return reply.code(400).send(errorPayload("invalid_image_query", "配图搜索词应为 1 到 100 个字符。"));
    }
    if (typeof pexelsApiKey !== "string" || !pexelsApiKey.trim() || pexelsApiKey.length > 4096) {
      return reply.code(400).send(errorPayload("invalid_image_key", "请填写有效的 Pexels API Key。"));
    }
    const normalizedOrientation = orientation === "portrait" || orientation === "square" ? orientation : "landscape";
    const normalizedLimit = typeof limit === "number" ? Math.max(1, Math.min(8, Math.round(limit))) : 6;
    try {
      const images = await searchPexelsImages(q, pexelsApiKey, normalizedOrientation, options.imageFetch ?? globalThis.fetch, normalizedLimit);
      return reply.send({ query: q, source: "Pexels", images });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pexels 配图搜索失败。";
      return reply.code(502).send(errorPayload("image_search_failed", message));
    }
  });

  app.get<{ Querystring: { url?: string } }>("/api/images/import", async (request, reply) => {
    if (!request.query.url) {
      return reply.code(400).send(errorPayload("invalid_image_url", "缺少图片地址。"));
    }
    try {
      const response = await fetchSupportedImage(request.query.url, options.imageFetch ?? globalThis.fetch);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > 3 * 1024 * 1024) {
        return reply.code(413).send(errorPayload("image_too_large", "候选图片超过 3 MB，请选择其他图片。"));
      }
      return reply.type(response.headers.get("content-type") ?? "application/octet-stream").send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片导入失败。";
      return reply.code(502).send(errorPayload("image_import_failed", message));
    }
  });

  app.post<{ Body: { markdown?: unknown; instruction?: unknown; creativity?: unknown; provider?: unknown } }>("/api/layout", async (request, reply) => {
    const { markdown, instruction, creativity } = request.body ?? {};
    if (typeof markdown !== "string" || markdown.trim().length === 0) {
      return reply.code(400).send(errorPayload("invalid_markdown", "文章正文不能为空。"));
    }
    if (markdown.length > 50_000) {
      return reply.code(413).send(errorPayload("article_too_large", "当前 AI 排版最多处理 50,000 个字符。"));
    }
    if (instruction !== undefined && (typeof instruction !== "string" || instruction.length > 500)) {
      return reply.code(400).send(errorPayload("invalid_instruction", "排版要求最多为 500 个字符。"));
    }
    if (creativity !== undefined && (typeof creativity !== "number" || !Number.isInteger(creativity) || creativity < 0 || creativity > 100)) {
      return reply.code(400).send(errorPayload("invalid_creativity", "创作自由度必须是 0 到 100 的整数。"));
    }

    try {
      const requestConfig = requestProviderConfig(request.body?.provider);
      const activeProvider = requestConfig
        ? options.providerFactory?.(requestConfig) ?? new OpenAICompatibleProvider(requestConfig)
        : provider;
      if (!activeProvider) {
        return reply.code(503).send(errorPayload(
          "ai_not_configured",
          "请在 AI 排版面板中填写 API 配置，或由部署者通过 .env 预设。"
        ));
      }

      const result = await suggestLayout(
        markdown,
        activeProvider,
        typeof instruction === "string" ? instruction : undefined,
        typeof creativity === "number" ? creativity : 35
      );
      return reply.send(result);
    } catch (error) {
      const internalMessage = error instanceof Error ? error.message : "生成排版建议失败。";
      const message = publicAIErrorMessage(internalMessage);
      request.log.warn({ err: error instanceof Error ? { name: error.name, message: internalMessage } : "unknown" }, "AI layout failed");
      const isTimeout = internalMessage.includes("秒内未响应") || internalMessage.includes("请求超时");
      if (isTimeout) {
        return reply.code(504).send(errorPayload("ai_timeout", message));
      }
      const isConfigurationError = message.includes("API 地址")
        || message.includes("API Key")
        || message.includes("AI_MODEL")
        || message.includes("HTTPS")
        || message.includes("协议");
      return reply.code(isConfigurationError ? 400 : 502).send(errorPayload(
        isConfigurationError ? "invalid_ai_configuration" : "ai_layout_failed",
        message
      ));
    }
  });

  return app;
}
