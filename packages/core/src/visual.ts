interface MarkdownNode {
  type: string;
  value?: string;
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

interface MarkdownRoot {
  children: MarkdownNode[];
}

type VisualTarget = "heading" | "block" | "divider";

interface VisualDirective {
  target: VisualTarget;
  variant: string;
}

function parseDirective(node: MarkdownNode): VisualDirective | undefined {
  if (node.type !== "html" || typeof node.value !== "string") return undefined;
  const match = node.value.trim().match(/^<!--\s*wx-layout:(heading|block|divider):([a-z-]+)\s*-->$/i);
  if (!match?.[1] || !match[2]) return undefined;
  return { target: match[1].toLowerCase() as VisualTarget, variant: match[2].toLowerCase() };
}

function canApply(target: VisualTarget, node: MarkdownNode): boolean {
  if (target === "heading") return node.type === "heading";
  if (target === "divider") return node.type === "thematicBreak";
  return node.type === "paragraph" || node.type === "blockquote" || node.type === "list";
}

export function applyVisualDirectives(tree: MarkdownRoot): void {
  let pending: VisualDirective | undefined;
  const children: MarkdownNode[] = [];

  for (const node of tree.children) {
    const directive = parseDirective(node);
    if (directive) {
      pending = directive;
      continue;
    }

    if (pending && canApply(pending.target, node)) {
      const existingProperties = node.data?.hProperties;
      node.data = {
        ...node.data,
        hProperties: {
          ...(existingProperties && typeof existingProperties === "object" ? existingProperties : {}),
          "data-wx-visual": `${pending.target}:${pending.variant}`
        }
      };
    }
    pending = undefined;
    children.push(node);
  }

  tree.children = children;
}

export function visualDirectivesPlugin() {
  return (tree: unknown) => applyVisualDirectives(tree as MarkdownRoot);
}
