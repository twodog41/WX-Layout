import { z } from "zod";

const reason = z.string().min(1).max(160);
const blockId = z.string().min(1).max(80);

export const layoutOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_heading"),
    blockId,
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    reason
  }).strict(),
  z.object({
    type: z.literal("emphasize"),
    blockId,
    text: z.string().min(1).max(80),
    reason
  }).strict(),
  z.object({
    type: z.literal("convert_to_quote"),
    blockId,
    reason
  }).strict(),
  z.object({
    type: z.literal("split_block"),
    blockId,
    breakBefore: z.array(z.string().min(1).max(80)).min(1).max(16),
    variant: z.enum(["paragraphs", "short-lines", "info-cards"]),
    reason
  }).strict(),
  z.object({
    type: z.literal("rewrite_block"),
    blockId,
    markdown: z.string().min(1).max(4000),
    reason
  }).strict(),
  z.object({
    type: z.literal("decorate_heading"),
    blockId,
    variant: z.enum(["banner", "pill", "underline"]),
    reason
  }).strict(),
  z.object({
    type: z.literal("style_block"),
    blockId,
    variant: z.enum(["card", "note", "highlight", "soft-dots", "paper-grid", "diagonal"]),
    reason
  }).strict(),
  z.object({
    type: z.literal("insert_divider"),
    afterBlockId: blockId,
    variant: z.enum(["line", "dots", "double"]),
    reason
  }).strict()
]);

export const editorialNoteSchema = z.object({
  blockId,
  kind: z.enum(["dense", "duplicate", "clarify", "priority"]),
  title: z.string().min(1).max(80),
  detail: z.string().min(1).max(300)
}).strict();

export const imageSuggestionSchema = z.object({
  afterBlockId: blockId,
  query: z.string().min(1).max(100),
  alt: z.string().min(1).max(100),
  purpose: z.string().min(1).max(160),
  orientation: z.enum(["landscape", "portrait", "square"])
}).strict();

export const layoutPlanSchema = z.object({
  version: z.literal("1"),
  summary: z.string().min(1).max(300),
  operations: z.array(layoutOperationSchema).max(40),
  editorialNotes: z.array(editorialNoteSchema).max(10),
  imageSuggestions: z.array(imageSuggestionSchema).max(4)
}).strict();

export const layoutPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "summary", "operations", "editorialNotes", "imageSuggestions"],
  properties: {
    version: { type: "string", const: "1" },
    summary: { type: "string", minLength: 1, maxLength: 300 },
    operations: {
      type: "array",
      maxItems: 40,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "level", "reason"],
            properties: {
              type: { type: "string", const: "set_heading" },
              blockId: { type: "string" },
              level: { type: "integer", enum: [1, 2, 3, 4, 5, 6] },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "text", "reason"],
            properties: {
              type: { type: "string", const: "emphasize" },
              blockId: { type: "string" },
              text: { type: "string", minLength: 1, maxLength: 80 },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "reason"],
            properties: {
              type: { type: "string", const: "convert_to_quote" },
              blockId: { type: "string" },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "breakBefore", "variant", "reason"],
            properties: {
              type: { type: "string", const: "split_block" },
              blockId: { type: "string" },
              breakBefore: {
                type: "array",
                minItems: 1,
                maxItems: 16,
                items: { type: "string", minLength: 1, maxLength: 80 }
              },
              variant: { type: "string", enum: ["paragraphs", "short-lines", "info-cards"] },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "markdown", "reason"],
            properties: {
              type: { type: "string", const: "rewrite_block" },
              blockId: { type: "string" },
              markdown: { type: "string", minLength: 1, maxLength: 4000 },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "variant", "reason"],
            properties: {
              type: { type: "string", const: "decorate_heading" },
              blockId: { type: "string" },
              variant: { type: "string", enum: ["banner", "pill", "underline"] },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "blockId", "variant", "reason"],
            properties: {
              type: { type: "string", const: "style_block" },
              blockId: { type: "string" },
              variant: { type: "string", enum: ["card", "note", "highlight", "soft-dots", "paper-grid", "diagonal"] },
              reason: { type: "string" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "afterBlockId", "variant", "reason"],
            properties: {
              type: { type: "string", const: "insert_divider" },
              afterBlockId: { type: "string" },
              variant: { type: "string", enum: ["line", "dots", "double"] },
              reason: { type: "string" }
            }
          }
        ]
      }
    },
    editorialNotes: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["blockId", "kind", "title", "detail"],
        properties: {
          blockId: { type: "string" },
          kind: { type: "string", enum: ["dense", "duplicate", "clarify", "priority"] },
          title: { type: "string", minLength: 1, maxLength: 80 },
          detail: { type: "string", minLength: 1, maxLength: 300 }
        }
      }
    },
    imageSuggestions: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["afterBlockId", "query", "alt", "purpose", "orientation"],
        properties: {
          afterBlockId: { type: "string" },
          query: { type: "string", minLength: 1, maxLength: 100 },
          alt: { type: "string", minLength: 1, maxLength: 100 },
          purpose: { type: "string", minLength: 1, maxLength: 160 },
          orientation: { type: "string", enum: ["landscape", "portrait", "square"] }
        }
      }
    }
  }
} as const;
