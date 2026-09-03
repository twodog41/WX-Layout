import { describeDocument } from "./document.js";
import type { AppliedLayoutPlan, AutomaticRepair, ContentChange, DocumentBlock, LayoutOperation, LayoutPlan, PlanWarning } from "./types.js";

export interface ApplyLayoutPlanOptions {
  creativity?: number;
}

const MAX_HEADING_CHARACTERS = 28;
const AUTO_HEADING_LINE_LENGTH = 16;
const STRUCTURED_LABELS = [
  "活动时间", "报名截止时间", "报名截止", "活动地点", "活动内容", "活动须知", "报名须知",
  "注意事项", "联系方式", "主办单位", "参与方式", "报名方式", "活动议程", "特点概述", "成功要素"
];

function normalizeContent(markdown: string): string {
  return describeDocument(markdown).blocks
    .filter((block) => block.kind !== "frontmatter" && block.kind !== "thematic-break")
    .filter((block) => !/^<!--\s*wx-layout:/i.test(block.source.trim()))
    .map((block) => block.text)
    .join("")
    .replace(/\s/g, "");
}

function visualMarker(target: "heading" | "block" | "divider", variant: string): string {
  return `<!-- wx-layout:${target}:${variant} -->`;
}

function quoteSource(source: string): string {
  return source.split("\n").map((line) => `> ${line}`).join("\n");
}

function setHeading(source: string, block: DocumentBlock, level: number): string | undefined {
  if (block.kind === "heading") {
    return source.replace(/^#{1,6}(?=\s)/, "#".repeat(level));
  }
  if (block.kind === "paragraph" && !source.includes("\n") && block.text.replace(/\s/g, "").length <= MAX_HEADING_CHARACTERS) {
    return `${"#".repeat(level)} ${source}`;
  }
  return undefined;
}

function safeBreakBoundary(source: string, index: number): boolean {
  const before = source.slice(0, index);
  return (before.match(/\*\*/g)?.length ?? 0) % 2 === 0
    && (before.match(/`/g)?.length ?? 0) % 2 === 0
    && !before.endsWith("[");
}

function renderSplitBlock(
  workingSource: string,
  positions: Iterable<number>,
  variant: "paragraphs" | "short-lines" | "info-cards",
  kind: DocumentBlock["kind"]
): string | undefined {
  const validPositions = [...new Set(positions)].filter((index) => index > 0 && safeBreakBoundary(workingSource, index));
  if (validPositions.length === 0) return undefined;

  const separator = variant === "short-lines"
    ? "  \n"
    : variant === "info-cards"
      ? "\n\n<!-- wx-layout:block:info-card -->\n"
      : "\n\n";
  let result = workingSource;
  for (const index of validPositions.sort((left, right) => right - left)) {
    let before = result.slice(0, index).replace(/[ \t\n]+$/, "");
    let after = result.slice(index).replace(/^[ \t\n]+/, "");
    const bullet = before.match(/[●•·]\s*$/)?.[0]?.trim();
    if (bullet) {
      before = before.slice(0, before.lastIndexOf(bullet)).replace(/[ \t]+$/, "");
      after = `${bullet} ${after}`;
    }
    result = `${before}${separator}${after}`;
  }
  if (variant === "short-lines") {
    return `${visualMarker("block", kind === "heading" ? "hero-lines" : "short-lines")}\n${result}`;
  }
  if (variant === "info-cards") {
    const withLabels = result.replace(
      /(^|<!-- wx-layout:block:info-card -->\n)([●•·]\s*)?(\*\*)?(活动时间|报名截止时间|报名截止|活动地点|活动内容|活动须知|报名须知|联系方式|主办单位|活动议程)(\s*[:：]?)(\*\*)?/gm,
      (_match, prefix: string, bullet: string | undefined, opening: string | undefined, label: string, punctuation: string, closing: string | undefined) =>
        `${prefix}${bullet ? `${bullet.trim()} ` : ""}${opening ?? "**"}${label}${closing ?? "**"}${punctuation}`
    );
    return `${visualMarker("block", "info-card")}\n${withLabels}`;
  }
  return result;
}

function splitBlock(
  source: string,
  breakBefore: string[],
  variant: "paragraphs" | "short-lines" | "info-cards",
  kind: DocumentBlock["kind"]
): string | undefined {
  const workingSource = kind === "heading" ? source.replace(/^#{1,6}\s+/, "") : source;
  const positions = new Set<number>();
  for (const anchor of breakBefore) {
    let offset = 0;
    let found = false;
    while (offset < workingSource.length) {
      const index = workingSource.indexOf(anchor, offset);
      if (index < 0) break;
      found = true;
      if (index > 0 && safeBreakBoundary(workingSource, index)) positions.add(index);
      offset = index + Math.max(1, anchor.length);
    }
    if (!found) return undefined;
  }
  return renderSplitBlock(workingSource, positions, variant, kind);
}

function precedingLayoutMarker(markdown: string, startOffset: number): string {
  return markdown.slice(Math.max(0, startOffset - 96), startOffset);
}

function splitLongHeading(source: string): string | undefined {
  const body = source.replace(/^#{1,6}\s+/, "").trim();
  if (!body || /[<>`]|\]\(/.test(body)) return undefined;

  const lines: string[] = [];
  let remaining = body;
  while (remaining.length > AUTO_HEADING_LINE_LENGTH) {
    const window = remaining.slice(0, AUTO_HEADING_LINE_LENGTH + 1);
    let splitAt = -1;
    for (let index = window.length - 1; index >= 8; index -= 1) {
      if (/[，。！？；：、\s]/.test(window[index - 1] ?? "")) {
        splitAt = index;
        break;
      }
    }
    if (splitAt < 0) splitAt = AUTO_HEADING_LINE_LENGTH;
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) lines.push(remaining);
  if (lines.length < 2) return undefined;
  return `${visualMarker("block", "hero-lines")}\n${lines.join("  \n")}`;
}

function structuredBreakPositions(source: string): number[] {
  const positions = new Set<number>();
  for (const bullet of ["●", "•"]) {
    for (const match of source.matchAll(new RegExp(bullet, "g"))) {
      if ((match.index ?? 0) > 0) positions.add(match.index ?? 0);
    }
  }

  for (const label of STRUCTURED_LABELS) {
    let offset = 0;
    while (offset < source.length) {
      const labelIndex = source.indexOf(label, offset);
      if (labelIndex < 0) break;
      const start = labelIndex >= 2 && source.slice(labelIndex - 2, labelIndex) === "**" ? labelIndex - 2 : labelIndex;
      const before = source.slice(Math.max(0, start - 5), start);
      if (start > 0 && !/[●•·]\s*$/.test(before)) positions.add(start);
      offset = labelIndex + label.length;
    }
  }

  for (const eventPrefix of ["京师校友文化节丨", "京师校友文化节 |", "京师校友文化节｜"]) {
    let offset = 0;
    while (offset < source.length) {
      const index = source.indexOf(eventPrefix, offset);
      if (index < 0) break;
      if (index > 0) positions.add(index);
      offset = index + eventPrefix.length;
    }
  }
  for (const match of source.matchAll(/(?:校史馆|文博馆|地质标本馆)(?=\s*[:：●•])/g)) {
    if ((match.index ?? 0) > 0) positions.add(match.index ?? 0);
  }
  return [...positions];
}

function splitDenseProse(source: string): string | undefined {
  if (/[<>`]|\]\(/.test(source)) return undefined;
  const positions: number[] = [];
  let lastBreak = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (index - lastBreak < 45 || !/[。！？；]/.test(source[index] ?? "")) continue;
    const boundary = index + 1;
    if (safeBreakBoundary(source, boundary)) {
      positions.push(boundary);
      lastBreak = boundary;
    }
  }
  if (positions.length === 0) return undefined;
  let result = source;
  for (const index of positions.sort((left, right) => right - left)) {
    result = `${result.slice(0, index).replace(/[ \t\n]+$/, "")}\n\n${result.slice(index).replace(/^[ \t\n]+/, "")}`;
  }
  return result;
}

function repairRemainingDenseBlocks(markdown: string): { markdown: string; repairs: AutomaticRepair[] } {
  const document = describeDocument(markdown);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const repairs: AutomaticRepair[] = [];

  for (const block of document.blocks) {
    if (!block.dense) continue;
    const preceding = precedingLayoutMarker(markdown, block.startOffset);
    if (/<!--\s*wx-layout:block:(?:hero-lines|short-lines)\s*-->\s*$/i.test(preceding)) continue;

    if (block.kind === "heading" && block.characterCount > MAX_HEADING_CHARACTERS) {
      const value = splitLongHeading(block.source);
      if (!value) continue;
      replacements.push({ start: block.startOffset, end: block.endOffset, value });
      repairs.push({
        blockId: block.id,
        kind: "long-heading",
        description: "模型遗漏了过长标题，本地校验已将其拆成适合手机阅读的短行。"
      });
      continue;
    }

    if (block.kind !== "paragraph") continue;
    const positions = structuredBreakPositions(block.source);
    if (positions.length > 0) {
      const value = renderSplitBlock(block.source, positions, "info-cards", block.kind);
      if (value) {
        replacements.push({ start: block.startOffset, end: block.endOffset, value });
        repairs.push({
          blockId: block.id,
          kind: "structured-information",
          description: "模型遗漏了密集字段，本地校验已按时间、地点、报名等信息自动分卡。"
        });
        continue;
      }
    }

    if (block.characterCount >= 120) {
      const value = splitDenseProse(block.source);
      if (!value) continue;
      replacements.push({ start: block.startOffset, end: block.endOffset, value });
      repairs.push({
        blockId: block.id,
        kind: "dense-prose",
        description: "模型遗漏了长正文，本地校验已按完整句子补充分段。"
      });
    }
  }

  let result = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }
  return { markdown: result, repairs };
}

function protectedTokens(value: string): string[] {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/[^\s)\]]+|[A-Za-z]*\d[A-Za-z0-9年月日时分秒周星期:：.\-/]*/gi) ?? [];
}

function rewriteBlock(source: string, replacement: string): string | undefined {
  const trimmed = replacement.trim();
  if (!trimmed || /<\/?[a-z][^>]*>/i.test(trimmed)) return undefined;
  if (trimmed.length > Math.max(400, Math.ceil(source.length * 1.35))) return undefined;
  const beforeTokens = [...protectedTokens(source)].sort();
  const afterTokens = [...protectedTokens(trimmed)].sort();
  if (beforeTokens.join("\u0000") !== afterTokens.join("\u0000")) return undefined;
  return trimmed;
}

function emphasize(source: string, text: string): string | undefined {
  if (source.includes(`**${text}**`)) return source;
  const index = source.indexOf(text);
  if (index < 0) return undefined;
  return `${source.slice(0, index)}**${text}**${source.slice(index + text.length)}`;
}

export function applyLayoutPlan(markdown: string, plan: LayoutPlan, options: ApplyLayoutPlanOptions = {}): AppliedLayoutPlan {
  const document = describeDocument(markdown);
  const creativity = Math.max(0, Math.min(100, Math.round(options.creativity ?? 25)));
  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  const operationsByBlock = new Map<string, Array<{ operation: LayoutOperation; index: number }>>();
  const warnings: PlanWarning[] = [];
  const contentChanges: ContentChange[] = [];
  const imageSlotsByBlock = new Map<string, number[]>();

  for (const [index, operation] of plan.operations.entries()) {
    const blockId = operation.type === "insert_divider" ? operation.afterBlockId : operation.blockId;
    const block = blocks.get(blockId);
    if (!block) {
      warnings.push({ operationIndex: index, code: "block-not-found", message: `找不到操作引用的段落 ${blockId}。` });
      continue;
    }
    const existing = operationsByBlock.get(blockId) ?? [];
    existing.push({ operation, index });
    operationsByBlock.set(blockId, existing);
  }

  for (const [index, suggestion] of plan.imageSuggestions.entries()) {
    if (!blocks.has(suggestion.afterBlockId)) continue;
    const slots = imageSlotsByBlock.get(suggestion.afterBlockId) ?? [];
    slots.push(index);
    imageSlotsByBlock.set(suggestion.afterBlockId, slots);
    if (!operationsByBlock.has(suggestion.afterBlockId)) operationsByBlock.set(suggestion.afterBlockId, []);
  }

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const appliedOperations: LayoutOperation[] = [];

  for (const [blockId, entries] of operationsByBlock) {
    const block = blocks.get(blockId);
    if (!block) continue;
    let value = block.source;
    let dividerInserted = false;
    let structuralOperationApplied = false;
    let headingDecorationApplied = false;
    let blockStyleApplied = false;
    let headingVariant: string | undefined;
    let blockVariant: string | undefined;
    let dividerVariant: string | undefined;
    const splitRequested = entries.some(({ operation }) => operation.type === "split_block");
    const rewriteEntries = entries.filter(({ operation }) => operation.type === "rewrite_block");

    if (rewriteEntries.length > 0) {
      const firstRewrite = rewriteEntries[0];
      if (!firstRewrite) continue;
      const { operation, index } = firstRewrite;
      if (operation.type === "rewrite_block") {
        if (creativity <= 50) {
          warnings.push({ operationIndex: index, code: "rewrite-not-allowed", message: "当前创作自由度不允许改写正文。" });
        } else if (!["paragraph", "blockquote", "list"].includes(block.kind)) {
          warnings.push({ operationIndex: index, code: "rewrite-not-applicable", message: "只能改写正文、引用或列表。" });
        } else {
          const next = rewriteBlock(value, operation.markdown);
          if (next === undefined) {
            warnings.push({ operationIndex: index, code: "rewrite-facts-changed", message: "改写可能改变数字、日期、链接或明显扩写，已拒绝。" });
          } else {
            value = next;
            structuralOperationApplied = true;
            appliedOperations.push(operation);
            contentChanges.push({
              operationIndex: index,
              blockId,
              before: block.source,
              after: next,
              reason: operation.reason
            });
          }
        }
      }
      for (const duplicate of rewriteEntries.slice(1)) {
        warnings.push({ operationIndex: duplicate.index, code: "rewrite-conflict", message: "同一段落只能应用一项改写。" });
      }
    }

    for (const { operation, index } of entries) {
      if (operation.type === "rewrite_block") continue;
      if (operation.type === "set_heading") {
        if (structuralOperationApplied) {
          warnings.push({ operationIndex: index, code: "structural-operation-conflict", message: "同一段落只能应用一项结构转换。" });
          continue;
        }
        const next = setHeading(value, block, operation.level);
        if (next === undefined) {
          warnings.push({
            operationIndex: index,
            code: "heading-not-applicable",
            message: "只能调整现有标题，或把单行段落转换为标题。"
          });
          continue;
        }
        value = next;
        structuralOperationApplied = true;
      } else if (operation.type === "emphasize") {
        if (!block.editable) {
          warnings.push({ operationIndex: index, code: "block-not-editable", message: "该段落类型不能添加强调。" });
          continue;
        }
        const next = emphasize(value, operation.text);
        if (next === undefined) {
          warnings.push({ operationIndex: index, code: "text-not-found", message: `段落中找不到“${operation.text}”。` });
          continue;
        }
        value = next;
      } else if (operation.type === "convert_to_quote") {
        if (structuralOperationApplied) {
          warnings.push({ operationIndex: index, code: "structural-operation-conflict", message: "同一段落只能应用一项结构转换。" });
          continue;
        }
        if (block.kind !== "paragraph") {
          warnings.push({ operationIndex: index, code: "quote-not-applicable", message: "只有普通段落可以转换为引用。" });
          continue;
        }
        value = quoteSource(value);
        structuralOperationApplied = true;
      } else if (operation.type === "split_block") {
        if (structuralOperationApplied) {
          warnings.push({ operationIndex: index, code: "structural-operation-conflict", message: "改写、标题、引用和拆分不能同时应用到同一段落。" });
          continue;
        }
        const headingShortLines = block.kind === "heading" && operation.variant === "short-lines";
        if (block.kind !== "paragraph" && !headingShortLines) {
          warnings.push({ operationIndex: index, code: "split-not-applicable", message: "普通段落可以拆分为段落、短句或信息卡片；长标题只能拆成短句。" });
          continue;
        }
        const next = splitBlock(value, operation.breakBefore, operation.variant, block.kind);
        if (next === undefined) {
          warnings.push({ operationIndex: index, code: "split-anchor-not-found", message: "拆分锚点不存在或位于不安全的 Markdown 标记中。" });
          continue;
        }
        value = next;
        structuralOperationApplied = true;
      } else if (operation.type === "decorate_heading") {
        if (headingDecorationApplied || block.kind !== "heading" || block.text.replace(/\s/g, "").length > MAX_HEADING_CHARACTERS) {
          warnings.push({ operationIndex: index, code: "heading-decoration-not-applicable", message: "视觉标题只能应用到标题，并且每个标题只能选择一种样式。" });
          continue;
        }
        headingVariant = operation.variant;
        headingDecorationApplied = true;
      } else if (operation.type === "style_block") {
        if (splitRequested || blockStyleApplied || !["paragraph", "blockquote", "list"].includes(block.kind)) {
          warnings.push({ operationIndex: index, code: "block-style-not-applicable", message: "内容卡片只能应用到正文、引用或列表。" });
          continue;
        }
        blockVariant = operation.variant;
        blockStyleApplied = true;
      } else if (operation.type === "insert_divider") {
        if (dividerInserted || block.kind === "frontmatter") {
          warnings.push({ operationIndex: index, code: "divider-not-applicable", message: "此处无法重复插入分隔线。" });
          continue;
        }
        dividerVariant = operation.variant ?? "line";
        dividerInserted = true;
      }
      appliedOperations.push(operation);
    }

    if (headingVariant) value = `${visualMarker("heading", headingVariant)}\n${value}`;
    if (blockVariant) value = `${visualMarker("block", blockVariant)}\n${value}`;
    if (dividerVariant) value = `${value}\n\n${visualMarker("divider", dividerVariant)}\n---`;
    const imageSlots = imageSlotsByBlock.get(blockId) ?? [];
    if (imageSlots.length > 0) {
      value = `${value}\n\n${imageSlots.map((index) => `<!-- wx-layout:image-slot:${index} -->`).join("\n\n")}`;
    }

    if (value !== block.source) {
      replacements.push({ start: block.startOffset, end: block.endOffset, value });
    }
  }

  let result = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`;
  }

  const repaired = repairRemainingDenseBlocks(result);
  result = repaired.markdown;

  const contentPreserved = normalizeContent(markdown) === normalizeContent(result);
  if (!contentPreserved && contentChanges.length === 0) {
    throw new Error("AI 排版操作改变了正文内容，结果已拒绝。", { cause: "content-fidelity-failed" });
  }

  return { markdown: result, appliedOperations, automaticRepairs: repaired.repairs, warnings, contentPreserved, contentChanges };
}
