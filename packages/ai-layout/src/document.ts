import type { Content, Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { DocumentBlock, DocumentBlockKind, DocumentDescription } from "./types.js";

function hash(value: string): string {
  let current = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    current ^= value.charCodeAt(index);
    current = Math.imul(current, 0x01000193);
  }
  return (current >>> 0).toString(36);
}

function blockKind(node: Content): DocumentBlockKind {
  switch (node.type) {
    case "heading": return "heading";
    case "paragraph": return "paragraph";
    case "list": return "list";
    case "blockquote": return "blockquote";
    case "code": return "code";
    case "thematicBreak": return "thematic-break";
    case "yaml": return "frontmatter";
    default: return "other";
  }
}

function isEditable(kind: DocumentBlockKind): boolean {
  return kind === "heading" || kind === "paragraph" || kind === "list" || kind === "blockquote";
}

const fieldLabelPattern = /(活动时间|报名截止时间|报名截止|活动地点|活动内容|注意事项|联系方式|主办单位|时间|地点|日期|费用|对象|参与方式|报名方式|材料|流程|议程|特点概述|成功要素)(?=\s*[:：]?)/g;

function breakCandidates(text: string): string[] {
  const candidates = new Set<string>();
  for (const match of text.matchAll(fieldLabelPattern)) {
    const label = match[1];
    if (label && (match.index ?? 0) > 0) candidates.add(label);
  }
  for (const match of text.matchAll(/[。！？；●，,]\s*([^。！？；●，,\n]{2,18})/g)) {
    const candidate = match[1]?.trim().replace(/\s+/g, " ");
    if (candidate && !/^\d/.test(candidate)) candidates.add(candidate);
  }
  return [...candidates].slice(0, 16);
}

export function describeDocument(markdown: string): DocumentDescription {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).parse(markdown) as Root;
  const blocks: DocumentBlock[] = [];

  for (const [index, node] of tree.children.entries()) {
    if (node.type === "html" && /^<!--\s*wx-layout:/i.test(node.value.trim())) continue;
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    if (startOffset === undefined || endOffset === undefined) continue;

    const kind = blockKind(node);
    const source = markdown.slice(startOffset, endOffset);
    const text = toString(node);
    const id = `b${index + 1}-${hash(`${node.type}:${source}`)}`;
    const headingLevel = node.type === "heading" ? (node as Heading).depth : undefined;
    const characterCount = text.replace(/\s/g, "").length;
    const candidates = breakCandidates(text);

    blocks.push({
      id,
      kind,
      text,
      source,
      startOffset,
      endOffset,
      ...(headingLevel ? { headingLevel } : {}),
      editable: isEditable(kind),
      characterCount,
      dense: (kind === "paragraph" && (characterCount >= 80 || candidates.length >= 3))
        || (kind === "heading" && characterCount > 28),
      breakCandidates: candidates
    });
  }

  return {
    version: "1",
    characters: blocks.reduce((count, block) => count + block.text.replace(/\s/g, "").length, 0),
    blocks
  };
}
