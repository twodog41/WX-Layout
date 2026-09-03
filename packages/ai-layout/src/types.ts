export type DocumentBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "blockquote"
  | "code"
  | "thematic-break"
  | "frontmatter"
  | "other";

export interface DocumentBlock {
  id: string;
  kind: DocumentBlockKind;
  text: string;
  source: string;
  startOffset: number;
  endOffset: number;
  headingLevel?: number;
  editable: boolean;
  characterCount: number;
  dense: boolean;
  breakCandidates: string[];
}

export interface DocumentDescription {
  version: "1";
  characters: number;
  blocks: DocumentBlock[];
}

export interface SetHeadingOperation {
  type: "set_heading";
  blockId: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
}

export interface EmphasizeOperation {
  type: "emphasize";
  blockId: string;
  text: string;
  reason: string;
}

export interface ConvertToQuoteOperation {
  type: "convert_to_quote";
  blockId: string;
  reason: string;
}

export interface SplitBlockOperation {
  type: "split_block";
  blockId: string;
  breakBefore: string[];
  variant: "paragraphs" | "short-lines" | "info-cards";
  reason: string;
}

export interface RewriteBlockOperation {
  type: "rewrite_block";
  blockId: string;
  markdown: string;
  reason: string;
}

export interface DecorateHeadingOperation {
  type: "decorate_heading";
  blockId: string;
  variant: "banner" | "pill" | "underline";
  reason: string;
}

export interface StyleBlockOperation {
  type: "style_block";
  blockId: string;
  variant: "card" | "note" | "highlight" | "soft-dots" | "paper-grid" | "diagonal";
  reason: string;
}

export interface InsertDividerOperation {
  type: "insert_divider";
  afterBlockId: string;
  variant?: "line" | "dots" | "double";
  reason: string;
}

export type LayoutOperation =
  | SetHeadingOperation
  | EmphasizeOperation
  | ConvertToQuoteOperation
  | SplitBlockOperation
  | RewriteBlockOperation
  | DecorateHeadingOperation
  | StyleBlockOperation
  | InsertDividerOperation;

export interface EditorialNote {
  blockId: string;
  kind: "dense" | "duplicate" | "clarify" | "priority";
  title: string;
  detail: string;
}

export interface ImageSuggestion {
  afterBlockId: string;
  query: string;
  alt: string;
  purpose: string;
  orientation: "landscape" | "portrait" | "square";
}

export interface LayoutPlan {
  version: "1";
  summary: string;
  operations: LayoutOperation[];
  editorialNotes: EditorialNote[];
  imageSuggestions: ImageSuggestion[];
}

export interface PlanWarning {
  operationIndex: number;
  code: string;
  message: string;
}

export interface AppliedLayoutPlan {
  markdown: string;
  appliedOperations: LayoutOperation[];
  automaticRepairs: AutomaticRepair[];
  warnings: PlanWarning[];
  contentPreserved: boolean;
  contentChanges: ContentChange[];
}

export interface AutomaticRepair {
  blockId: string;
  kind: "long-heading" | "structured-information" | "dense-prose";
  description: string;
}

export interface ContentChange {
  operationIndex: number;
  blockId: string;
  before: string;
  after: string;
  reason: string;
}

export interface LayoutProviderRequest {
  document: DocumentDescription;
  instruction?: string;
  creativity: number;
}

export interface LayoutProvider {
  createPlan(request: LayoutProviderRequest): Promise<unknown>;
}

export interface SuggestLayoutResult extends AppliedLayoutPlan {
  plan: LayoutPlan;
}
