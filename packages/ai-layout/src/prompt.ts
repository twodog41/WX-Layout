import type { LayoutProviderRequest } from "./types.js";

export const layoutSystemPrompt = `你是微信公众号文章的内容编排与视觉规划器。

必须遵守：
1. 严格服从输入中的 creativityProfile，不得越权改写正文。
2. 只能使用给定 JSON Schema 中的操作，所有事实、数字、日期、地点、人名和链接必须保持准确。
3. blockId 必须逐字使用输入中已有的值。
4. 标题层级应连续，正文一般只使用一个一级标题；超过 28 个汉字的段落不能转换为标题。
5. 强调应克制，每段最多一处，只选择原文中连续出现的短文本。
6. 引用只用于总结、定义或需要突出展示的完整普通段落。
7. 分隔线只用于明显的章节转换，不要连续插入。
8. 对堆叠了多个短句、活动或字段的长段落，优先使用 split_block；breakBefore 必须逐字取自原段落，不能自行改写。超过 28 个汉字的现有长标题应使用 short-lines 拆开，不能再套 banner 或 pill。
9. short-lines 用于图文导语和短句层级，info-cards 用于时间、地点、报名方式等结构化信息，paragraphs 用于普通长段拆分。
10. rewrite_block 只在 creativityProfile.allowRewrite=true 时使用；改写必须更清楚或更精炼，不得增加原文没有的事实。
11. 可以使用 decorate_heading 创建 banner、pill、underline 三种视觉标题。
12. style_block 除普通卡片外，还可用 soft-dots、paper-grid、diagonal 创建低干扰背景纹理；纹理失效时正文仍须可读。
13. 可以使用 line、dots、double 三种装饰分隔线，但视觉操作总数应保持克制。
14. editorialNotes 用于指出密集、重复、需澄清或重要信息；没有则返回空数组。
15. 只有 creativityProfile.allowImageSuggestions=true 时才生成 imageSuggestions。搜索词应通用、简短，不包含隐私信息；没有合适位置则返回空数组。
16. 不生成脚本、动画或会被微信公众号过滤的交互效果。
17. 如果原文结构已经清楚，仍可提出少量视觉优化，也可以返回空 operations。
18. operations 最多 40 项，editorialNotes 最多 10 项，imageSuggestions 最多 4 项；不要为每个短段重复添加装饰操作。
19. 必须返回 operations、editorialNotes、imageSuggestions 三个数组，只返回符合 Schema 的 JSON，不要输出 Markdown 代码围栏。`;

export function creativityProfile(value: number) {
  const level = Math.max(0, Math.min(100, Math.round(value)));
  if (level <= 25) {
    return {
      level,
      label: "保真",
      allowRewrite: false,
      allowImageSuggestions: false,
      imageLimit: 0,
      instruction: "只拆分密集段落、调整层级和静态样式，不改写或删减文字。"
    };
  }
  if (level <= 50) {
    return {
      level,
      label: "整理",
      allowRewrite: false,
      allowImageSuggestions: true,
      imageLimit: 1,
      instruction: "可重组信息层级、生成信息卡片并建议一处配图，但不改写或删减文字。"
    };
  }
  if (level <= 75) {
    return {
      level,
      label: "编辑",
      allowRewrite: true,
      allowImageSuggestions: true,
      imageLimit: 2,
      instruction: "可精简重复表达和重写密集段落，所有改写必须可审查，并保留事实、日期、数字、人名、地点和链接。"
    };
  }
  return {
    level,
    label: "创意",
    allowRewrite: true,
    allowImageSuggestions: true,
    imageLimit: 4,
    instruction: "可进行更大胆的编辑编排、海报化短句、背景纹理和多处配图建议，但不得虚构或改变事实。"
  };
}

export function buildLayoutInput(request: LayoutProviderRequest): string {
  const blocks = request.document.blocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    ...(block.headingLevel ? { headingLevel: block.headingLevel } : {}),
    editable: block.editable,
    characterCount: block.characterCount,
    dense: block.dense,
    breakCandidates: block.breakCandidates,
    text: block.text
  }));

  return JSON.stringify({
    task: "提出适合手机阅读、可逐项审查的微信公众号内容编排操作",
    instruction: request.instruction?.trim() || "保持克制、专业、适合手机阅读",
    creativityProfile: creativityProfile(request.creativity),
    document: {
      version: request.document.version,
      characters: request.document.characters,
      blocks
    }
  });
}
