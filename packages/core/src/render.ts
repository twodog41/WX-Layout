import type { Element, Root } from "hast";
import { toText } from "hast-util-to-text";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { lintWechatTree } from "./lint.js";
import { applyWechatStyles } from "./style.js";
import { cloneTheme, minimalBlueTheme } from "./themes.js";
import type { LintIssue, RenderOptions, RenderResult, RenderStats, ThemeTokens } from "./types.js";
import { visualDirectivesPlugin } from "./visual.js";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style"],
    a: [...(defaultSchema.attributes?.a ?? []), "target"],
    img: [...(defaultSchema.attributes?.img ?? []), "loading"]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"]
  }
};

const safePastedImage = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;

function imageSourceGuardPlugin() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const source = typeof node.properties.src === "string" ? node.properties.src : "";
      if (source.startsWith("data:") && !safePastedImage.test(source)) {
        delete node.properties.src;
      }
    });
  };
}

function stylingPlugin(theme: ThemeTokens) {
  return (tree: Root) => applyWechatStyles(tree, theme);
}

function inspectionPlugin(sink: {
  issues: LintIssue[];
  stats: RenderStats;
  plainText: string;
}) {
  return (tree: Root) => {
    const inspection = lintWechatTree(tree);
    sink.issues = inspection.issues;
    sink.stats = inspection.stats;
    sink.plainText = toText(tree, { whitespace: "pre" });
  };
}

export function renderWechat(markdown: string, options: RenderOptions = {}): RenderResult {
  const theme = cloneTheme(options.theme ?? minimalBlueTheme);
  const inspection = {
    issues: [] as LintIssue[],
    stats: { characters: 0, headings: 0, images: 0, links: 0 } as RenderStats,
    plainText: ""
  };

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(visualDirectivesPlugin)
    .use(remarkRehype)
    .use(imageSourceGuardPlugin)
    .use(stylingPlugin, theme)
    .use(inspectionPlugin, inspection)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .processSync(markdown);

  return {
    html: String(file),
    plainText: inspection.plainText,
    issues: inspection.issues,
    stats: inspection.stats,
    theme
  };
}
