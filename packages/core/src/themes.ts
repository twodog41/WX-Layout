import type { ThemeTokens } from "./types.js";

export const minimalBlueTheme: ThemeTokens = {
  id: "minimal-blue",
  name: "克制蓝",
  description: "清晰、专业，适合知识和技术内容",
  colors: {
    background: "#ffffff",
    text: "#1f2937",
    muted: "#64748b",
    accent: "#2563eb",
    accentSoft: "#eff6ff",
    border: "#dbeafe",
    quoteBackground: "#f8fafc",
    codeBackground: "#0f172a",
    codeText: "#e2e8f0"
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16,
    lineHeight: 1.8,
    letterSpacing: 0.3
  },
  spacing: {
    paragraph: 16,
    section: 28,
    compact: 8
  },
  imageRadius: 8
};

export const warmPaperTheme: ThemeTokens = {
  id: "warm-paper",
  name: "暖纸",
  description: "温和、舒展，适合随笔和生活方式内容",
  colors: {
    background: "#fffdf8",
    text: "#3f352c",
    muted: "#806f5e",
    accent: "#b45309",
    accentSoft: "#fff7ed",
    border: "#fed7aa",
    quoteBackground: "#fffbeb",
    codeBackground: "#292524",
    codeText: "#fef3c7"
  },
  typography: {
    fontFamily: "'Noto Serif SC', 'Songti SC', serif",
    fontSize: 16,
    lineHeight: 1.9,
    letterSpacing: 0.5
  },
  spacing: {
    paragraph: 18,
    section: 32,
    compact: 9
  },
  imageRadius: 4
};

export const inkTheme: ThemeTokens = {
  id: "ink",
  name: "墨色",
  description: "黑白高对比，适合评论和深度文章",
  colors: {
    background: "#ffffff",
    text: "#18181b",
    muted: "#71717a",
    accent: "#18181b",
    accentSoft: "#f4f4f5",
    border: "#d4d4d8",
    quoteBackground: "#fafafa",
    codeBackground: "#18181b",
    codeText: "#f4f4f5"
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 16,
    lineHeight: 1.75,
    letterSpacing: 0.2
  },
  spacing: {
    paragraph: 15,
    section: 26,
    compact: 8
  },
  imageRadius: 0
};

export const builtInThemes = [minimalBlueTheme, warmPaperTheme, inkTheme] as const;

export function cloneTheme(theme: ThemeTokens): ThemeTokens {
  return {
    ...theme,
    colors: { ...theme.colors },
    typography: { ...theme.typography },
    spacing: { ...theme.spacing }
  };
}
