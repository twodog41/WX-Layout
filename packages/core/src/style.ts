import type { Element, ElementContent, Root } from "hast";
import { visit } from "unist-util-visit";
import type { ThemeTokens } from "./types.js";

type CssValue = string | number | undefined;

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function css(declarations: Record<string, CssValue>): string {
  return Object.entries(declarations)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([property, value]) => `${toKebabCase(property)}:${value}`)
    .join(";");
}

function headingStyle(level: number, theme: ThemeTokens): string {
  const sizes: Record<number, number> = { 1: 25, 2: 21, 3: 18, 4: 17, 5: 16, 6: 16 };
  const common = {
    color: theme.colors.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${sizes[level] ?? 16}px`,
    fontWeight: level <= 3 ? 700 : 600,
    lineHeight: 1.45,
    margin: `${theme.spacing.section}px 0 ${theme.spacing.paragraph}px`,
    padding: 0
  };

  if (level === 1) {
    return css({ ...common, textAlign: "center", letterSpacing: "1px" });
  }

  if (level === 2) {
    return css({
      ...common,
      borderLeft: `4px solid ${theme.colors.accent}`,
      paddingLeft: "10px"
    });
  }

  if (level === 3) {
    return css({ ...common, color: theme.colors.accent });
  }

  return css(common);
}

function visualVariant(node: Element): string | undefined {
  const value = node.properties.dataWxVisual ?? node.properties["data-wx-visual"];
  return typeof value === "string" ? value : undefined;
}

function headingVisualStyle(variant: string, theme: ThemeTokens): string | undefined {
  if (variant === "heading:stacked") {
    return css({
      background: theme.colors.accentSoft,
      border: `1px solid ${theme.colors.border}`,
      borderLeft: 0,
      borderRadius: "10px",
      fontSize: "22px",
      letterSpacing: "0.5px",
      lineHeight: 1.85,
      padding: "18px 14px",
      textAlign: "center"
    });
  }
  if (variant === "heading:banner") {
    return css({
      background: theme.colors.accent,
      borderRadius: "9px",
      boxSizing: "border-box",
      color: "#ffffff",
      letterSpacing: "1px",
      padding: "12px 16px",
      textAlign: "center"
    });
  }
  if (variant === "heading:pill") {
    return css({
      background: theme.colors.accentSoft,
      border: `1px solid ${theme.colors.accent}`,
      borderRadius: "999px",
      color: theme.colors.accent,
      padding: "8px 18px",
      textAlign: "center"
    });
  }
  if (variant === "heading:underline") {
    return css({
      borderBottom: `2px solid ${theme.colors.accent}`,
      borderLeft: 0,
      color: theme.colors.text,
      padding: "0 0 8px"
    });
  }
  return undefined;
}

function blockVisualStyle(variant: string, theme: ThemeTokens): string | undefined {
  const common = {
    borderRadius: "10px",
    boxSizing: "border-box",
    margin: `${theme.spacing.paragraph}px 0`,
    padding: "14px 16px",
    textAlign: "left"
  };
  if (variant === "block:card") {
    return css({ ...common, background: "#ffffff", border: `1px solid ${theme.colors.border}` });
  }
  if (variant === "block:note") {
    return css({ ...common, background: theme.colors.accentSoft, borderLeft: `4px solid ${theme.colors.accent}` });
  }
  if (variant === "block:highlight") {
    return css({ ...common, background: "#fff7dc", border: "1px solid #efd690" });
  }
  if (variant === "block:info-card") {
    return css({
      ...common,
      background: theme.colors.accentSoft,
      border: `1px solid ${theme.colors.border}`,
      borderLeft: `4px solid ${theme.colors.accent}`,
      margin: "10px 0",
      padding: "11px 14px"
    });
  }
  if (variant === "block:short-lines") {
    return css({
      ...common,
      background: theme.colors.accentSoft,
      border: `1px solid ${theme.colors.border}`,
      lineHeight: 2,
      padding: "20px 18px",
      textAlign: "center"
    });
  }
  if (variant === "block:hero-lines") {
    return css({
      ...common,
      background: theme.colors.accentSoft,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: "10px",
      color: theme.colors.text,
      fontSize: "22px",
      fontWeight: 700,
      letterSpacing: "0.5px",
      lineHeight: 1.85,
      padding: "18px 14px",
      textAlign: "center"
    });
  }
  if (variant === "block:soft-dots") {
    return css({
      ...common,
      backgroundColor: theme.colors.accentSoft,
      backgroundImage: `radial-gradient(${theme.colors.border} 1px, transparent 1px)`,
      backgroundSize: "12px 12px",
      border: `1px solid ${theme.colors.border}`
    });
  }
  if (variant === "block:paper-grid") {
    return css({
      ...common,
      backgroundColor: "#ffffff",
      backgroundImage: `linear-gradient(${theme.colors.accentSoft} 1px, transparent 1px),linear-gradient(90deg, ${theme.colors.accentSoft} 1px, transparent 1px)`,
      backgroundSize: "18px 18px",
      border: `1px solid ${theme.colors.border}`
    });
  }
  if (variant === "block:diagonal") {
    return css({
      ...common,
      backgroundColor: theme.colors.accentSoft,
      backgroundImage: `repeating-linear-gradient(135deg, transparent 0, transparent 10px, ${theme.colors.border} 10px, ${theme.colors.border} 11px)`,
      border: `1px solid ${theme.colors.border}`
    });
  }
  return undefined;
}

function dividerVisualStyle(variant: string, theme: ThemeTokens): string | undefined {
  if (variant === "divider:dots") {
    return css({ border: 0, borderTop: `3px dotted ${theme.colors.accent}`, width: "38%" });
  }
  if (variant === "divider:double") {
    return css({ border: 0, borderTop: `3px double ${theme.colors.accent}`, width: "52%" });
  }
  return undefined;
}

function combineStyles(base: string, extra: string | undefined): string {
  return extra ? `${base};${extra}` : base;
}

function elementStyle(node: Element, parent: Root | Element | undefined, theme: ThemeTokens): string | undefined {
  const { tagName } = node;
  const paragraph = {
    color: theme.colors.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${theme.typography.fontSize}px`,
    lineHeight: theme.typography.lineHeight,
    letterSpacing: `${theme.typography.letterSpacing}px`,
    margin: `0 0 ${theme.spacing.paragraph}px`,
    textAlign: "justify"
  };

  if (/^h[1-6]$/.test(tagName)) {
    const base = headingStyle(Number(tagName.slice(1)), theme);
    return combineStyles(base, headingVisualStyle(visualVariant(node) ?? "", theme));
  }

  switch (tagName) {
    case "p":
      return combineStyles(css(paragraph), blockVisualStyle(visualVariant(node) ?? "", theme));
    case "strong":
      return css({ color: theme.colors.accent, fontWeight: 700 });
    case "em":
      return css({ color: theme.colors.muted, fontStyle: "italic" });
    case "del":
      return css({ color: theme.colors.muted, textDecoration: "line-through" });
    case "a":
      return css({
        color: theme.colors.accent,
        textDecoration: "none",
        borderBottom: `1px solid ${theme.colors.border}`,
        overflowWrap: "anywhere"
      });
    case "blockquote":
      return combineStyles(css({
        background: theme.colors.quoteBackground,
        borderLeft: `4px solid ${theme.colors.accent}`,
        color: theme.colors.muted,
        margin: `${theme.spacing.paragraph}px 0`,
        padding: "12px 16px"
      }), blockVisualStyle(visualVariant(node) ?? "", theme));
    case "ul":
    case "ol":
      return combineStyles(css({
        color: theme.colors.text,
        fontFamily: theme.typography.fontFamily,
        fontSize: `${theme.typography.fontSize}px`,
        lineHeight: theme.typography.lineHeight,
        margin: `0 0 ${theme.spacing.paragraph}px`,
        paddingLeft: "1.6em"
      }), blockVisualStyle(visualVariant(node) ?? "", theme));
    case "li":
      return css({ margin: `0 0 ${theme.spacing.compact}px`, paddingLeft: "0.2em" });
    case "hr":
      return combineStyles(css({
        border: 0,
        borderTop: `1px solid ${theme.colors.border}`,
        margin: `${theme.spacing.section}px auto`,
        width: "72%"
      }), dividerVisualStyle(visualVariant(node) ?? "", theme));
    case "pre":
      return css({
        background: theme.colors.codeBackground,
        borderRadius: "8px",
        boxSizing: "border-box",
        color: theme.colors.codeText,
        fontFamily: "Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
        lineHeight: 1.65,
        margin: `${theme.spacing.paragraph}px 0`,
        overflowWrap: "anywhere",
        padding: "14px 16px",
        whiteSpace: "pre-wrap",
        width: "100%"
      });
    case "code":
      if (parent?.type === "element" && parent.tagName === "pre") {
        return css({ color: "inherit", fontFamily: "inherit", fontSize: "inherit" });
      }
      return css({
        background: theme.colors.accentSoft,
        borderRadius: "4px",
        color: theme.colors.accent,
        fontFamily: "Menlo, Monaco, Consolas, monospace",
        fontSize: "0.9em",
        padding: "2px 5px"
      });
    case "img":
      return css({
        borderRadius: `${theme.imageRadius}px`,
        display: "block",
        height: "auto",
        margin: `${theme.spacing.paragraph}px auto`,
        maxWidth: "100%"
      });
    case "table":
      return css({
        borderCollapse: "collapse",
        color: theme.colors.text,
        fontFamily: theme.typography.fontFamily,
        fontSize: "14px",
        lineHeight: 1.6,
        margin: `${theme.spacing.paragraph}px 0`,
        tableLayout: "fixed",
        width: "100%"
      });
    case "th":
      return css({
        background: theme.colors.accentSoft,
        border: `1px solid ${theme.colors.border}`,
        color: theme.colors.text,
        fontWeight: 700,
        overflowWrap: "anywhere",
        padding: "8px"
      });
    case "td":
      return css({
        border: `1px solid ${theme.colors.border}`,
        overflowWrap: "anywhere",
        padding: "8px",
        verticalAlign: "top"
      });
    default:
      return undefined;
  }
}

function mergeStyle(existing: unknown, generated: string): string {
  if (typeof existing !== "string" || existing.length === 0) {
    return generated;
  }
  return `${existing.replace(/;$/, "")};${generated}`;
}

export function applyWechatStyles(tree: Root, theme: ThemeTokens): void {
  visit(tree, "element", (node, _index, parent) => {
    const generated = elementStyle(node, parent, theme);
    if (generated) {
      node.properties.style = mergeStyle(node.properties.style, generated);
    }

    if (node.tagName === "blockquote") {
      for (const child of node.children) {
        if (child.type === "element" && child.tagName === "p") {
          child.properties.style = mergeStyle(
            child.properties.style,
            css({ color: "inherit", margin: 0, textAlign: "left" })
          );
        }
      }
    }
  });
}

export function elementText(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return node.children.map((child) => elementText(child)).join("");
}
