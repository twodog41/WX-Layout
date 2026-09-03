import { applyLayoutPlan } from "./apply.js";
import { describeDocument } from "./document.js";
import { creativityProfile } from "./prompt.js";
import { editorialNoteSchema, imageSuggestionSchema, layoutOperationSchema, layoutPlanSchema } from "./schema.js";
import type { LayoutOperation, LayoutProvider, SuggestLayoutResult } from "./types.js";

const MAX_OPERATIONS = 40;
const MAX_EDITORIAL_NOTES = 10;
const MAX_IMAGE_SUGGESTIONS = 4;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function clippedString(value: unknown, maximum: number): unknown {
  return typeof value === "string" ? value.trim().slice(0, maximum) : value;
}

function normalizeOperation(value: unknown): unknown {
  const item = recordValue(value);
  if (!item || typeof item.type !== "string") return value;
  const common = {
    type: item.type,
    blockId: clippedString(item.blockId, 80),
    reason: clippedString(item.reason, 160)
  };
  switch (item.type) {
    case "set_heading": return { ...common, level: item.level };
    case "emphasize": return { ...common, text: clippedString(item.text, 80) };
    case "convert_to_quote": return common;
    case "split_block": return {
      ...common,
      breakBefore: Array.isArray(item.breakBefore)
        ? item.breakBefore
            .filter((anchor): anchor is string => typeof anchor === "string" && anchor.trim().length > 0 && anchor.trim().length <= 80)
            .map((anchor) => anchor.trim())
            .slice(0, 16)
        : item.breakBefore,
      variant: item.variant
    };
    case "rewrite_block": return { ...common, markdown: item.markdown };
    case "decorate_heading":
    case "style_block": return { ...common, variant: item.variant };
    case "insert_divider": return {
      type: item.type,
      afterBlockId: clippedString(item.afterBlockId, 80),
      variant: item.variant,
      reason: clippedString(item.reason, 160)
    };
    default: return value;
  }
}

function operationPriority(operation: LayoutOperation): number {
  if (operation.type === "split_block" || operation.type === "rewrite_block" || operation.type === "set_heading") return 0;
  if (operation.type === "emphasize" || operation.type === "convert_to_quote") return 1;
  return 2;
}

function normalizePlanCandidate(rawPlan: unknown) {
  const plan = recordValue(rawPlan);
  if (!plan) throw new Error("模型返回的排版方案不是有效对象，请重新生成。" );
  const rawOperations = Array.isArray(plan.operations) ? plan.operations : [];
  const validOperations = rawOperations.flatMap((value, index) => {
    const parsed = layoutOperationSchema.safeParse(normalizeOperation(value));
    return parsed.success ? [{ operation: parsed.data, index }] : [];
  });
  const operations = validOperations
    .sort((left, right) => operationPriority(left.operation) - operationPriority(right.operation) || left.index - right.index)
    .slice(0, MAX_OPERATIONS)
    .sort((left, right) => left.index - right.index)
    .map(({ operation }) => operation);

  const rawNotes = Array.isArray(plan.editorialNotes) ? plan.editorialNotes : [];
  const editorialNotes = rawNotes.flatMap((value) => {
    const item = recordValue(value);
    if (!item) return [];
    const parsed = editorialNoteSchema.safeParse({
      blockId: clippedString(item.blockId, 80),
      kind: item.kind,
      title: clippedString(item.title, 80),
      detail: clippedString(item.detail, 300)
    });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, MAX_EDITORIAL_NOTES);

  const rawImages = Array.isArray(plan.imageSuggestions) ? plan.imageSuggestions : [];
  const imageSuggestions = rawImages.flatMap((value) => {
    const item = recordValue(value);
    if (!item) return [];
    const parsed = imageSuggestionSchema.safeParse({
      afterBlockId: clippedString(item.afterBlockId, 80),
      query: clippedString(item.query, 100),
      alt: clippedString(item.alt, 100),
      purpose: clippedString(item.purpose, 160),
      orientation: item.orientation
    });
    return parsed.success ? [parsed.data] : [];
  }).slice(0, MAX_IMAGE_SUGGESTIONS);

  const candidate = layoutPlanSchema.safeParse({
    version: "1",
    summary: typeof plan.summary === "string" && plan.summary.trim()
      ? plan.summary.trim().slice(0, 300)
      : "AI 已生成排版方案，请在应用前检查修改稿。",
    operations,
    editorialNotes,
    imageSuggestions
  });
  if (!candidate.success) throw new Error("模型返回的排版方案格式不完整，请重新生成或降低创作自由度。" );
  return {
    plan: candidate.data,
    discardedOperations: Math.max(0, rawOperations.length - operations.length),
    discardedNotes: Math.max(0, rawNotes.length - editorialNotes.length),
    discardedImages: Math.max(0, rawImages.length - imageSuggestions.length)
  };
}

export async function suggestLayout(
  markdown: string,
  provider: LayoutProvider,
  instruction?: string,
  creativity = 35
): Promise<SuggestLayoutResult> {
  const document = describeDocument(markdown);
  if (document.characters === 0) throw new Error("文章正文为空，无法生成排版建议。" );

  const normalizedCreativity = Math.max(0, Math.min(100, Math.round(creativity)));
  const rawPlan = await provider.createPlan({ document, creativity: normalizedCreativity, ...(instruction ? { instruction } : {}) });
  const normalized = normalizePlanCandidate(rawPlan);
  const parsedPlan = normalized.plan;
  const profile = creativityProfile(normalizedCreativity);
  const blockIds = new Set(document.blocks.map((block) => block.id));
  const plan = {
    ...parsedPlan,
    editorialNotes: parsedPlan.editorialNotes.filter((note) => blockIds.has(note.blockId)),
    imageSuggestions: profile.allowImageSuggestions
      ? parsedPlan.imageSuggestions
          .filter((suggestion) => blockIds.has(suggestion.afterBlockId))
          .filter((suggestion) => !/@|https?:\/\/|\d{5,}/i.test(suggestion.query))
          .slice(0, profile.imageLimit)
      : []
  };
  const applied = applyLayoutPlan(markdown, plan, { creativity: normalizedCreativity });
  const discardedCount = normalized.discardedOperations + normalized.discardedNotes + normalized.discardedImages;
  const warnings = discardedCount > 0
    ? [...applied.warnings, {
        operationIndex: -1,
        code: "model-output-trimmed",
        message: `模型返回的建议过多或部分格式无效，已安全忽略 ${discardedCount} 项；密集段落仍会由本地二次整理补充。`
      }]
    : applied.warnings;
  return { ...applied, warnings, plan };
}
