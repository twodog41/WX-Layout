import type { LayoutProvider, LayoutProviderRequest } from "@wx-layout/ai-layout";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type RequestProviderConfig } from "./app.js";
import type { StarStore } from "./stars.js";

const apps: ReturnType<typeof buildApp>[] = [];

function formattingProvider(): LayoutProvider {
  return {
    createPlan: vi.fn(async ({ document }: LayoutProviderRequest) => {
      const heading = document.blocks.find((block) => block.kind === "heading");
      const paragraph = document.blocks.find((block) => block.kind === "paragraph");
      if (!heading || !paragraph) throw new Error("Fixture is incomplete");
      return {
        version: "1",
        summary: "调整层级并突出重点",
        operations: [
          { type: "set_heading", blockId: heading.id, level: 2, reason: "作为正文小节" },
          { type: "emphasize", blockId: paragraph.id, text: "核心信息", reason: "突出关键内容" }
        ],
        editorialNotes: [],
        imageSuggestions: []
      };
    })
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("layout API", () => {
  it("keeps a global star count and only accepts one vote per device", async () => {
    const voters = new Set<string>();
    const starStore: StarStore = {
      status: vi.fn(async (deviceId?: string) => ({ count: voters.size, starred: Boolean(deviceId && voters.has(deviceId)) })),
      add: vi.fn(async (deviceId: string) => {
        voters.add(deviceId);
        return { count: voters.size, starred: true };
      })
    };
    const app = buildApp({ logger: false, starStore });
    apps.push(app);
    const deviceId = "123e4567-e89b-12d3-a456-426614174000";

    const first = await app.inject({ method: "POST", url: "/api/support/star", payload: { deviceId } });
    const duplicate = await app.inject({ method: "POST", url: "/api/support/star", payload: { deviceId } });
    const status = await app.inject({ method: "GET", url: `/api/support/star?deviceId=${deviceId}` });

    expect(first.json()).toEqual({ count: 1, starred: true });
    expect(duplicate.json()).toEqual({ count: 1, starred: true });
    expect(status.json()).toEqual({ count: 1, starred: true });
  });

  it("returns a reviewed, content-preserving layout candidate", async () => {
    const provider = formattingProvider();
    const app = buildApp({ provider, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/layout",
      payload: { markdown: "# 小节\n\n这是一段核心信息。" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      markdown: "## 小节\n\n这是一段**核心信息**。",
      contentPreserved: true,
      appliedOperations: [{ type: "set_heading" }, { type: "emphasize" }]
    });
    expect(provider.createPlan).toHaveBeenCalledWith(expect.objectContaining({ creativity: 35 }));
  });

  it("accepts temporary provider configuration from the setup panel", async () => {
    const provider = formattingProvider();
    const providerFactory = vi.fn((_config: RequestProviderConfig) => provider);
    const app = buildApp({ providerFactory, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/layout",
      payload: {
        markdown: "# 小节\n\n这是一段核心信息。",
        provider: {
          baseUrl: "https://api.example/v1",
          protocol: "chat-completions",
          model: "example-model",
          apiKey: "temporary-secret"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(providerFactory).toHaveBeenCalledWith({
      baseUrl: "https://api.example/v1",
      protocol: "chat-completions",
      model: "example-model",
      apiKey: "temporary-secret"
    });
    expect(response.body).not.toContain("temporary-secret");
  });

  it("rejects insecure remote provider URLs", async () => {
    const providerFactory = vi.fn((_config: RequestProviderConfig) => formattingProvider());
    const app = buildApp({ providerFactory, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/layout",
      payload: {
        markdown: "# 小节",
        provider: {
          baseUrl: "http://api.example/v1",
          protocol: "responses",
          model: "example-model",
          apiKey: "temporary-secret"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_ai_configuration" } });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("rejects empty documents before calling the provider", async () => {
    const provider: LayoutProvider = { createPlan: vi.fn() };
    const app = buildApp({ provider, logger: false });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/layout", payload: { markdown: "  " } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_markdown" } });
    expect(provider.createPlan).not.toHaveBeenCalled();
  });

  it("validates and forwards the creative freedom setting", async () => {
    const provider = formattingProvider();
    const app = buildApp({ provider, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/layout",
      payload: { markdown: "# 小节\n\n这是一段核心信息。", creativity: 72 }
    });

    expect(response.statusCode).toBe(200);
    expect(provider.createPlan).toHaveBeenCalledWith(expect.objectContaining({ creativity: 72 }));

    const invalid = await app.inject({
      method: "POST",
      url: "/api/layout",
      payload: { markdown: "# 小节", creativity: 120 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "invalid_creativity" } });
  });

  it("reports provider timeouts as a gateway timeout", async () => {
    const provider: LayoutProvider = {
      createPlan: vi.fn().mockRejectedValue(new Error("模型在 90 秒内未响应，请检查网络后重试。"))
    };
    const app = buildApp({ provider, logger: false });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/layout", payload: { markdown: "# 小节" } });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({ error: { code: "ai_timeout" } });
  });

  it("never exposes raw schema validation details to the setup panel", async () => {
    const provider: LayoutProvider = {
      createPlan: vi.fn().mockRejectedValue(new Error('[{ "origin": "array", "code": "too_big", "path": ["operations"] }]'))
    };
    const app = buildApp({ provider, logger: false });
    apps.push(app);

    const response = await app.inject({ method: "POST", url: "/api/layout", payload: { markdown: "# 小节" } });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: { message: "模型返回的排版方案格式不完整，已安全拒绝。请重新生成；若仍出现，可适当降低创作自由度。" }
    });
    expect(response.body).not.toContain('"origin"');
  });

  it("searches Pexels with a temporary image key without echoing it", async () => {
    const imageFetch = vi.fn(async () => new Response(JSON.stringify({
      photos: [{
        id: 7,
        url: "https://www.pexels.com/photo/campus-7/",
        alt: "Autumn campus",
        photographer: "Example Author",
        src: { large: "https://images.pexels.com/photos/7/campus.jpeg" }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const app = buildApp({ logger: false, imageFetch: imageFetch as typeof fetch });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/images/search",
      payload: {
        q: "university campus autumn",
        orientation: "landscape",
        pexelsApiKey: "temporary-pexels-key"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: "Pexels", images: [{ source: "Pexels" }] });
    expect(response.body).not.toContain("temporary-pexels-key");
  });

  it("uses Openverse as the default aggregated image source", async () => {
    const imageFetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        id: "openverse-campus",
        title: "Campus",
        thumbnail: "https://api.openverse.org/v1/images/openverse-campus/thumb/",
        foreign_landing_url: "https://www.flickr.com/photos/example/campus",
        creator: "Example Author",
        license: "by",
        license_version: "4.0",
        provider: "flickr"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const app = buildApp({ logger: false, imageFetch: imageFetch as typeof fetch });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/images/search?q=university%20campus&orientation=landscape"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: "Openverse", images: [{ source: "Openverse · flickr" }] });
  });
});
