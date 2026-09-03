import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import { elementText } from "./style.js";
import type { LintIssue, RenderStats } from "./types.js";

function stringProperty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function lintWechatTree(tree: Root): { issues: LintIssue[]; stats: RenderStats } {
  const issues: LintIssue[] = [];
  const stats: RenderStats = { characters: 0, headings: 0, images: 0, links: 0 };
  let h1Count = 0;

  visit(tree, "text", (node) => {
    stats.characters += node.value.replace(/\s/g, "").length;
  });

  visit(tree, "element", (node: Element, _index, parent) => {
    if (/^h[1-6]$/.test(node.tagName)) {
      stats.headings += 1;
      if (node.tagName === "h1") h1Count += 1;
    }

    if (node.tagName === "img") {
      stats.images += 1;
      const source = stringProperty(node.properties.src);
      const alt = stringProperty(node.properties.alt);

      if (!source) {
        issues.push({ code: "image-source-missing", severity: "error", message: "存在没有图片地址的图片。" });
      } else if (source.startsWith("data:")) {
        issues.push({
          code: "image-data-url",
          severity: "warning",
          message: "Data URL 图片粘贴到公众号后可能丢失，建议先上传到公众号素材库。",
          block: alt || source.slice(0, 32)
        });
      } else if (!/^https:\/\//i.test(source)) {
        issues.push({
          code: "image-non-https",
          severity: "warning",
          message: "本地或非 HTTPS 图片无法保证在公众号中显示，发布前需要上传并替换地址。",
          block: alt || source
        });
      }

      if (!alt) {
        issues.push({ code: "image-alt-missing", severity: "info", message: "图片缺少替代文本。" });
      }
    }

    if (node.tagName === "a") {
      stats.links += 1;
      const href = stringProperty(node.properties.href);
      if (href && !/^(https:\/\/|#|mailto:)/i.test(href)) {
        issues.push({
          code: "link-non-https",
          severity: "warning",
          message: "链接不是 HTTPS，发布前请确认公众号是否会保留。",
          block: href
        });
      }
    }

    if (node.tagName === "table") {
      issues.push({
        code: "table-mobile-review",
        severity: "info",
        message: "表格已做窄屏处理，但仍建议在手机预览中人工检查。"
      });
    }

    if (node.tagName === "code" && parent?.type === "element" && parent.tagName === "pre") {
      const longestLine = Math.max(0, ...elementText(node).split("\n").map((line) => line.length));
      if (longestLine > 88) {
        issues.push({
          code: "code-long-line",
          severity: "warning",
          message: `代码块中存在 ${longestLine} 字符的长行，手机端可能难以阅读。`
        });
      }
    }
  });

  if (h1Count > 1) {
    issues.push({
      code: "multiple-h1",
      severity: "warning",
      message: `检测到 ${h1Count} 个一级标题，建议正文只保留一个主标题。`
    });
  }

  if (stats.characters === 0) {
    issues.push({ code: "empty-document", severity: "error", message: "文章正文为空。" });
  }

  return { issues, stats };
}
