import { describe, expect, it, vi } from "vitest";
import { applyLayoutPlan, describeDocument, OpenAICompatibleProvider, suggestLayout } from "./index.js";
import type { LayoutPlan, LayoutProvider } from "./types.js";

function planFor(markdown: string): LayoutPlan {
  const document = describeDocument(markdown);
  const heading = document.blocks.find((block) => block.kind === "heading");
  const paragraph = document.blocks.find((block) => block.kind === "paragraph");
  if (!heading || !paragraph) throw new Error("Test fixture is incomplete");

  return {
    version: "1",
    summary: "调整标题、强调重点并分隔章节",
    operations: [
      { type: "set_heading", blockId: heading.id, level: 2, reason: "正文小节使用二级标题" },
      { type: "emphasize", blockId: paragraph.id, text: "关键内容", reason: "突出核心概念" },
      { type: "insert_divider", afterBlockId: paragraph.id, variant: "dots", reason: "区分后续章节" }
    ],
    editorialNotes: [],
    imageSuggestions: []
  };
}

describe("structured layout planning", () => {
  it("creates stable block descriptions", () => {
    const first = describeDocument("# 标题\n\n普通段落");
    const second = describeDocument("# 标题\n\n普通段落");

    expect(first.blocks.map((block) => block.id)).toEqual(second.blocks.map((block) => block.id));
    expect(first.blocks).toMatchObject([
      { kind: "heading", headingLevel: 1, text: "标题" },
      { kind: "paragraph", text: "普通段落" }
    ]);
  });

  it("applies only formatting operations and preserves content", () => {
    const markdown = "# 小节\n\n这里包含关键内容。\n\n下一段。";
    const result = applyLayoutPlan(markdown, planFor(markdown));

    expect(result.markdown).toContain("## 小节");
    expect(result.markdown).toContain("**关键内容**");
    expect(result.markdown).toContain("---");
    expect(result.contentPreserved).toBe(true);
    expect(result.appliedOperations).toHaveLength(3);
  });

  it("ignores operations that reference missing blocks", () => {
    const result = applyLayoutPlan("# 标题", {
      version: "1",
      summary: "无效操作",
      operations: [{ type: "set_heading", blockId: "missing", level: 2, reason: "测试" }],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.markdown).toBe("# 标题");
    expect(result.warnings[0]?.code).toBe("block-not-found");
  });

  it("adds visual directives without changing article content", () => {
    const markdown = "## 校园新闻\n\n本周将举行校园开放日。";
    const document = describeDocument(markdown);
    const heading = document.blocks.find((block) => block.kind === "heading")!;
    const paragraph = document.blocks.find((block) => block.kind === "paragraph")!;
    const result = applyLayoutPlan(markdown, {
      version: "1",
      summary: "增加视觉层次",
      operations: [
        { type: "decorate_heading", blockId: heading.id, variant: "banner", reason: "突出章节标题" },
        { type: "style_block", blockId: paragraph.id, variant: "note", reason: "形成信息卡片" },
        { type: "insert_divider", afterBlockId: paragraph.id, variant: "double", reason: "结束章节" }
      ],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.markdown).toContain("<!-- wx-layout:heading:banner -->");
    expect(result.markdown).toContain("<!-- wx-layout:block:note -->");
    expect(result.markdown).toContain("<!-- wx-layout:divider:double -->");
    expect(result.contentPreserved).toBe(true);
  });

  it("validates provider output before applying it", async () => {
    const markdown = "# 小节\n\n这里包含关键内容。";
    const provider: LayoutProvider = { createPlan: vi.fn().mockResolvedValue(planFor(markdown)) };
    const result = await suggestLayout(markdown, provider);

    expect(result.plan.version).toBe("1");
    expect(result.contentPreserved).toBe(true);
  });

  it("uses Responses structured outputs without storing the response", async () => {
    const markdown = "# 小节\n\n这里包含关键内容。";
    const expectedPlan = planFor(markdown);
    let requestBody: Record<string, unknown> | undefined;
    const fakeFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: JSON.stringify(expectedPlan) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example/v1",
      model: "test-model",
      fetch: fakeFetch as typeof fetch
    });

    const raw = await provider.createPlan({ document: describeDocument(markdown), creativity: 35 });

    expect(raw).toEqual(expectedPlan);
    expect(requestBody?.store).toBe(false);
    expect(requestBody?.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    expect(fakeFetch).toHaveBeenCalledWith("https://api.example/v1/responses", expect.any(Object));
  });

  it("ignores DeepSeek reasoning text and parses the final Responses message", async () => {
    const markdown = "# 小节\n\n这里包含关键内容。";
    const expectedPlan = planFor(markdown);
    let requestBody: Record<string, unknown> | undefined;
    const fakeFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        output: [
          {
            type: "reasoning",
            content: [{ type: "reasoning_text", text: "我们只需要根据指令分析文章结构。" }]
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify(expectedPlan) }]
          }
        ]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      protocol: "responses",
      fetch: fakeFetch as typeof fetch
    });

    await expect(provider.createPlan({ document: describeDocument(markdown), creativity: 35 })).resolves.toEqual(expectedPlan);
    expect(requestBody).toMatchObject({
      max_output_tokens: 4_000,
      reasoning: { effort: "none" },
      temperature: 0.41
    });
  });

  it("accepts provider JSON wrapped in a short explanation", async () => {
    const markdown = "# 小节\n\n这里包含关键内容。";
    const expectedPlan = planFor(markdown);
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: `排版方案如下：\n${JSON.stringify(expectedPlan)}` } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://api.example/v1",
      model: "test-model",
      protocol: "chat-completions",
      fetch: fakeFetch as typeof fetch
    });

    await expect(provider.createPlan({ document: describeDocument(markdown), creativity: 35 })).resolves.toEqual(expectedPlan);
  });

  it("splits dense fields into individually styled information cards without changing text", () => {
    const markdown = "校园健康跑●活动时间2026年9月13日7:30●报名截止2026年9月9日●活动地点海淀校园";
    const paragraph = describeDocument(markdown).blocks[0]!;
    const result = applyLayoutPlan(markdown, {
      version: "1",
      summary: "拆分活动信息",
      operations: [{
        type: "split_block",
        blockId: paragraph.id,
        breakBefore: ["活动时间", "报名截止", "活动地点"],
        variant: "info-cards",
        reason: "避免时间地点挤在同一段"
      }],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.markdown.match(/wx-layout:block:info-card/g)).toHaveLength(4);
    expect(result.markdown).toContain("\n● **活动地点**海淀校园");
    expect(result.markdown).toContain("**活动时间**");
    expect(result.contentPreserved).toBe(true);
  });

  it("allows reviewed rewrites only at higher creativity and locks numeric facts", () => {
    const markdown = "活动将于2026年9月13日在海淀校园举行，欢迎大家参加这次活动。";
    const paragraph = describeDocument(markdown).blocks[0]!;
    const plan: LayoutPlan = {
      version: "1",
      summary: "精简重复表达",
      operations: [{
        type: "rewrite_block",
        blockId: paragraph.id,
        markdown: "活动将于2026年9月13日在海淀校园举行，欢迎参加。",
        reason: "删去重复表达"
      }],
      editorialNotes: [],
      imageSuggestions: []
    };

    const conservative = applyLayoutPlan(markdown, plan, { creativity: 50 });
    expect(conservative.markdown).toBe(markdown);
    expect(conservative.warnings[0]?.code).toBe("rewrite-not-allowed");

    const editorial = applyLayoutPlan(markdown, plan, { creativity: 65 });
    expect(editorial.contentPreserved).toBe(false);
    expect(editorial.contentChanges).toHaveLength(1);

    const changedFact = applyLayoutPlan(markdown, {
      ...plan,
      operations: [{ ...plan.operations[0]!, markdown: "活动将于2026年9月14日在海淀校园举行。" }]
    }, { creativity: 80 });
    expect(changedFact.markdown).toBe(markdown);
    expect(changedFact.warnings[0]?.code).toBe("rewrite-facts-changed");
  });

  it("does not turn an oversized paragraph into a title", () => {
    const markdown = "这是一段明显超过二十八个汉字的正文内容，不应该因为模型误判就被转换成巨大的标题。";
    const paragraph = describeDocument(markdown).blocks[0]!;
    const result = applyLayoutPlan(markdown, {
      version: "1",
      summary: "错误标题候选",
      operations: [{ type: "set_heading", blockId: paragraph.id, level: 2, reason: "测试长度保护" }],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.markdown).toBe(markdown);
    expect(result.warnings[0]?.code).toBe("heading-not-applicable");
  });

  it("repairs an existing oversized heading by splitting it into short lines", () => {
    const markdown = "# 岁月荏苒斗转星移校园回忆成为时光里的佳酿秩年返校让我们沿着青春的足迹重逢";
    const heading = describeDocument(markdown).blocks[0]!;
    const result = applyLayoutPlan(markdown, {
      version: "1",
      summary: "修复过长标题",
      operations: [{
        type: "split_block",
        blockId: heading.id,
        breakBefore: ["校园回忆", "秩年返校", "让我们"],
        variant: "short-lines",
        reason: "把长标题分成适合手机阅读的短句"
      }],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.markdown).toContain("<!-- wx-layout:block:hero-lines -->");
    expect(result.markdown).not.toContain("# 岁月");
    expect(result.markdown.match(/  \n/g)).toHaveLength(3);
    expect(result.contentPreserved).toBe(true);
  });

  it("automatically repairs dense blocks that the model leaves untouched", () => {
    const markdown = "# 岁月荏苒斗转星移校园回忆成为时光里的佳酿秩年返校让我们沿着青春的足迹重逢在年少的起点\n\n校园健康跑●活动时间2026年9月13日7:30报名截止时间：2026年9月9日●活动地点海淀校园●活动内容累计完成124公里";
    const result = applyLayoutPlan(markdown, {
      version: "1",
      summary: "模型未提出拆分",
      operations: [],
      editorialNotes: [],
      imageSuggestions: []
    });

    expect(result.automaticRepairs.map((repair) => repair.kind)).toEqual([
      "long-heading",
      "structured-information"
    ]);
    expect(result.markdown).toContain("<!-- wx-layout:block:hero-lines -->");
    expect(result.markdown.match(/wx-layout:block:info-card/g)?.length).toBeGreaterThanOrEqual(3);
    expect(result.markdown).toContain("**报名截止时间**：2026年9月9日");
    expect(result.markdown).toContain("● **活动地点**海淀校园");
    expect(result.contentPreserved).toBe(true);
  });

  it("limits image suggestions by creative freedom and removes sensitive search terms", async () => {
    const markdown = "# 校园活动\n\n秋季校园开放日即将开始。";
    const document = describeDocument(markdown);
    const paragraph = document.blocks.find((block) => block.kind === "paragraph")!;
    const provider: LayoutProvider = {
      createPlan: vi.fn().mockResolvedValue({
        version: "1",
        summary: "提供配图位置",
        operations: [],
        editorialNotes: [],
        imageSuggestions: [
          { afterBlockId: paragraph.id, query: "大学校园 秋季", alt: "秋日校园", purpose: "营造氛围", orientation: "landscape" },
          { afterBlockId: paragraph.id, query: "13800138000 校友", alt: "校友", purpose: "不应泄露联系方式", orientation: "landscape" }
        ]
      })
    };

    const conservative = await suggestLayout(markdown, provider, undefined, 20);
    expect(conservative.plan.imageSuggestions).toEqual([]);

    const organized = await suggestLayout(markdown, provider, undefined, 35);
    expect(organized.plan.imageSuggestions).toHaveLength(1);
    expect(organized.markdown).toContain("<!-- wx-layout:image-slot:0 -->");
    expect(organized.contentPreserved).toBe(true);
  });

  it("safely trims oversized model plans instead of rejecting the whole response", async () => {
    const markdown = "# 校园活动\n\n活动时间：2026年9月13日。";
    const document = describeDocument(markdown);
    const paragraph = document.blocks.find((block) => block.kind === "paragraph")!;
    const provider: LayoutProvider = {
      createPlan: vi.fn().mockResolvedValue({
        version: "1",
        summary: "生成了过多建议",
        operations: Array.from({ length: 45 }, (_, index) => ({
          type: "emphasize",
          blockId: paragraph.id,
          text: index === 44 ? "活动时间" : "2026年9月13日",
          reason: `突出重要信息 ${index + 1}`
        })),
        editorialNotes: [],
        imageSuggestions: []
      })
    };

    const result = await suggestLayout(markdown, provider, undefined, 35);

    expect(result.plan.operations).toHaveLength(40);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "model-output-trimmed" }));
    expect(result.markdown).toContain("**2026年9月13日**");
  });

  it("drops unsafe oversized split anchors while keeping the remaining valid plan", async () => {
    const markdown = "# 校园活动\n\n活动时间：2026年9月13日。活动地点：海淀校园。";
    const paragraph = describeDocument(markdown).blocks.find((block) => block.kind === "paragraph")!;
    const provider: LayoutProvider = {
      createPlan: vi.fn().mockResolvedValue({
        version: "1",
        summary: "拆分活动信息",
        operations: [{
          type: "split_block",
          blockId: paragraph.id,
          breakBefore: ["活动地点", "过长锚点".repeat(21)],
          variant: "info-cards",
          reason: "拆分时间和地点"
        }],
        editorialNotes: [],
        imageSuggestions: []
      })
    };

    const result = await suggestLayout(markdown, provider, undefined, 35);

    expect(result.plan.operations[0]).toMatchObject({ type: "split_block", breakBefore: ["活动地点"] });
    expect(result.markdown).toContain("<!-- wx-layout:block:info-card -->");
  });
});
