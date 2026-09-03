export type IssueSeverity = "info" | "warning" | "error";

export interface LintIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
  block?: string;
}

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  border: string;
  quoteBackground: string;
  codeBackground: string;
  codeText: string;
}

export interface ThemeTypography {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

export interface ThemeSpacing {
  paragraph: number;
  section: number;
  compact: number;
}

export interface ThemeTokens {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  imageRadius: number;
}

export interface RenderOptions {
  theme?: ThemeTokens;
}

export interface RenderStats {
  characters: number;
  headings: number;
  images: number;
  links: number;
}

export interface RenderResult {
  html: string;
  plainText: string;
  issues: LintIssue[];
  stats: RenderStats;
  theme: ThemeTokens;
}
