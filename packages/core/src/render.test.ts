import { describe, expect, it } from "vitest";
import { cloneTheme, minimalBlueTheme, renderWechat } from "./index.js";

describe("renderWechat", () => {
  it("renders deterministic inline styles for WeChat", () => {
    const result = renderWechat("# 标题\n\n这是**重点**内容。\n\n> 一段引用");

    expect(result.html).toContain("<h1 style=\"");
    expect(result.html).toContain("text-align:center");
    expect(result.html).toContain("<strong style=\"");
    expect(result.html).not.toContain("<style");
    expect(result.stats).toMatchObject({ headings: 1, images: 0, links: 0 });
    expect(result.plainText).toContain("重点");
  });

  it("does not pass raw script nodes through to the result", () => {
    const result = renderWechat("正文\n\n<script>alert('unsafe')</script>");

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("alert");
  });

  it("reports image and mobile table compatibility issues", () => {
    const result = renderWechat("![示例](./local.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |");

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["image-non-https", "table-mobile-review"])
    );
    expect(result.stats.images).toBe(1);
  });

  it("keeps safe pasted bitmap data URLs and removes unsafe data sources", () => {
    const safe = renderWechat("![粘贴图片](data:image/png;base64,iVBORw0KGgo=)");
    const unsafe = renderWechat("![不安全图片](data:image/svg+xml;base64,PHN2Zz4=)");

    expect(safe.html).toContain("src=\"data:image/png;base64,iVBORw0KGgo=\"");
    expect(safe.issues.map((issue) => issue.code)).toContain("image-data-url");
    expect(unsafe.html).not.toContain("data:image/svg+xml");
  });

  it("supports isolated theme customization", () => {
    const custom = cloneTheme(minimalBlueTheme);
    custom.colors.accent = "#e11d48";
    custom.typography.fontSize = 18;
    const result = renderWechat("## 自定义主题\n\n正文", { theme: custom });

    expect(result.html).toContain("#e11d48");
    expect(result.html).toContain("font-size:18px");
    expect(minimalBlueTheme.colors.accent).toBe("#2563eb");
  });

  it("warns about multiple top-level headings and long code lines", () => {
    const result = renderWechat(`# A\n\n# B\n\n\`\`\`txt\n${"x".repeat(100)}\n\`\`\``);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["multiple-h1", "code-long-line"])
    );
  });

  it("renders visual directives as WeChat-safe inline styles", () => {
    const result = renderWechat(`<!-- wx-layout:heading:banner -->
## 校园新闻

<!-- wx-layout:block:note -->
本周将举行校园开放日。

<!-- wx-layout:divider:dots -->
---`);

    expect(result.html).not.toContain("wx-layout:");
    expect(result.html).toContain("background:#2563eb");
    expect(result.html).toContain("border-left:4px solid #2563eb");
    expect(result.html).toContain("border-top:3px dotted #2563eb");
    expect(result.plainText).toContain("校园新闻");
  });

  it("renders short lines, information cards, and decorative fallback backgrounds", () => {
    const result = renderWechat(`<!-- wx-layout:block:short-lines -->
第一行  
第二行

<!-- wx-layout:block:info-card -->
活动时间：9月13日

<!-- wx-layout:block:soft-dots -->
背景纹理失效时仍然可读。`);

    expect(result.html).toContain("text-align:center");
    expect(result.html).toContain("margin:10px 0");
    expect(result.html).toContain("background-color:");
    expect(result.html).toContain("radial-gradient");
  });

  it("renders repaired long headings as readable stacked title cards", () => {
    const result = renderWechat(`<!-- wx-layout:block:hero-lines -->
第一行  
第二行`);

    expect(result.html).toContain("font-size:22px");
    expect(result.html).toContain("line-height:1.85");
    expect(result.html).toContain("text-align:center");
  });
});
