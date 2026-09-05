"use client";

import type { ImageSuggestion, LayoutOperation, SuggestLayoutResult } from "@wx-layout/ai-layout";
import { creativityProfile } from "@wx-layout/ai-layout/prompt";
import { builtInThemes, cloneTheme, renderWechat, type LintIssue, type ThemeTokens } from "@wx-layout/core";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties } from "react";
import { createImageId, hydrateLocalImages, migrateInlineImages, type StoredImageAsset } from "./image-assets";
import { sampleMarkdown } from "./sample";

const STORAGE_KEY = "wx-layout.draft.v1";
const AI_SETTINGS_KEY = "wx-layout.ai-settings.v1";
const IMAGE_DB_NAME = "wx-layout.images.v1";
const IMAGE_STORE_NAME = "images";
const SUPPORT_DEVICE_KEY = "wx-layout.support-device.v1";
const MAX_LOCAL_IMAGE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_LOCAL_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

interface StoredDraft {
  markdown: string;
  themeId: string;
}

interface APIErrorResponse {
  error: {
    code?: string;
    message?: string;
  };
}

type ProviderPreset = "openai" | "deepseek" | "compatible";
type AIProtocol = "responses" | "chat-completions";

interface AISettings {
  preset: ProviderPreset;
  baseUrl: string;
  protocol: AIProtocol;
  model: string;
  apiKey: string;
}

interface StoredAISettings extends Omit<AISettings, "apiKey"> {
  instruction: string;
  creativity: number;
}

interface ImageNotice {
  tone: "success" | "error";
  message: string;
}

interface CommonsImageCandidate {
  id: string;
  title: string;
  thumbnailUrl: string;
  originalUrl: string;
  sourcePage: string;
  artist: string;
  licenseShortName: string;
  licenseUrl: string;
  width: number;
  height: number;
  source: string;
}

interface ImageSearchResult {
  query: string;
  source: string;
  images: CommonsImageCandidate[];
}

interface ImageSearchState {
  status: "idle" | "loading" | "ready" | "error" | "inserted";
  images: CommonsImageCandidate[];
  message?: string;
}

interface StarStatus {
  count: number;
  starred: boolean;
}

function supportDeviceId(): string {
  try {
    const existing = localStorage.getItem(SUPPORT_DEVICE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(SUPPORT_DEVICE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function loadDraft(): StoredDraft {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value) return JSON.parse(value) as StoredDraft;
  } catch {
    // A corrupt or unavailable localStorage should not prevent the editor from loading.
  }
  return { markdown: sampleMarkdown, themeId: builtInThemes[0].id };
}

function loadAISettings(): StoredAISettings {
  const fallback: StoredAISettings = {
    preset: "openai",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
    model: "",
    instruction: "保持克制、专业，适合手机阅读",
    creativity: 35
  };
  try {
    const value = localStorage.getItem(AI_SETTINGS_KEY);
    if (!value) return fallback;
    const stored = JSON.parse(value) as Partial<StoredAISettings>;
    const baseUrl = typeof stored.baseUrl === "string" ? stored.baseUrl : fallback.baseUrl;
    const isDeepSeek = stored.preset === "deepseek" || /api\.deepseek\.com/i.test(baseUrl);
    return {
      preset: isDeepSeek ? "deepseek" : stored.preset === "compatible" ? "compatible" : "openai",
      baseUrl: isDeepSeek ? "https://api.deepseek.com" : baseUrl,
      protocol: isDeepSeek ? "responses" : stored.protocol === "chat-completions" ? "chat-completions" : "responses",
      model: typeof stored.model === "string" && stored.model ? stored.model : isDeepSeek ? "deepseek-v4-flash" : "",
      instruction: typeof stored.instruction === "string" ? stored.instruction : fallback.instruction,
      creativity: typeof stored.creativity === "number"
        ? Math.max(0, Math.min(100, Math.round(stored.creativity)))
        : fallback.creativity
    };
  } catch {
    return fallback;
  }
}

let imageDatabasePromise: Promise<IDBDatabase> | undefined;

function imageDatabase(): Promise<IDBDatabase> {
  if (imageDatabasePromise) return imageDatabasePromise;
  imageDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_STORE_NAME, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("无法打开图片存储。")));
  });
  return imageDatabasePromise;
}

async function saveImageAsset(asset: StoredImageAsset): Promise<void> {
  const database = await imageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put(asset);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("无法保存图片。")));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("无法保存图片。")));
  });
}

async function loadImageAssets(): Promise<Record<string, string>> {
  const database = await imageDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).getAll();
    request.addEventListener("success", () => {
      const assets = (request.result as StoredImageAsset[]).map((asset) => [asset.id, asset.dataUrl] as const);
      resolve(Object.fromEntries(assets));
    });
    request.addEventListener("error", () => reject(request.error ?? new Error("无法读取图片。")));
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("无法读取图片。"));
    });
    reader.addEventListener("error", () => reject(new Error("无法读取图片。")));
    reader.readAsDataURL(file);
  });
}

function markdownImageAlt(file: File): string {
  const name = file.name.replace(/\.[^.]+$/, "").trim() || "粘贴图片";
  return name.replace(/[\[\]]/g, "\\$&");
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+.!|]/g, "\\$&").replace(/\s+/g, " ").trim();
}

function rgbaFromHex(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "rgba(37,99,235,0.08)";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}

function previewDocument(html: string, theme: ThemeTokens): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    html { background: ${theme.colors.background}; }
    body { margin: 0; padding: 24px 20px 56px; background: ${theme.colors.background}; }
    img { max-width: 100%; }
  </style>
</head>
<body>${html}</body>
</html>`;
}

async function copyRichHtml(html: string, plainText: string): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" })
    });
    await navigator.clipboard.write([item]);
    return;
  }

  const staging = document.createElement("div");
  staging.contentEditable = "true";
  staging.style.position = "fixed";
  staging.style.left = "-10000px";
  staging.innerHTML = html;
  document.body.append(staging);

  const range = document.createRange();
  range.selectNodeContents(staging);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const copied = document.execCommand("copy");
  selection?.removeAllRanges();
  staging.remove();

  if (!copied) throw new Error("浏览器拒绝了剪贴板操作");
}

function downloadHtml(html: string, theme: ThemeTokens): void {
  const documentHtml = previewDocument(html, theme);
  const blob = new Blob([documentHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wechat-article.html";
  anchor.click();
  URL.revokeObjectURL(url);
}

function issueLabel(issue: LintIssue): string {
  if (issue.severity === "error") return "错误";
  if (issue.severity === "warning") return "提醒";
  return "建议";
}

function operationLabel(operation: LayoutOperation): string {
  switch (operation.type) {
    case "set_heading": return `将段落调整为 H${operation.level} 标题`;
    case "emphasize": return `强调“${operation.text}”`;
    case "convert_to_quote": return "将段落转换为引用";
    case "split_block": return operation.variant === "info-cards"
      ? `拆成 ${operation.breakBefore.length + 1} 张信息卡片`
      : operation.variant === "short-lines"
        ? `拆成 ${operation.breakBefore.length + 1} 行短句`
        : `拆成 ${operation.breakBefore.length + 1} 个段落`;
    case "rewrite_block": return "精简或重写密集内容";
    case "decorate_heading": return `应用 ${operation.variant} 视觉标题`;
    case "style_block": return `应用 ${operation.variant} 内容卡片`;
    case "insert_divider": return `插入 ${operation.variant ?? "line"} 装饰分隔线`;
  }
}

export function App() {
  const initial = useMemo(loadDraft, []);
  const initialAI = useMemo(loadAISettings, []);
  const initialTheme = builtInThemes.find((theme) => theme.id === initial.themeId) ?? builtInThemes[0];
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [theme, setTheme] = useState<ThemeTokens>(() => cloneTheme(initialTheme));
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [serverAIConfigured, setServerAIConfigured] = useState<boolean | null>(null);
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>({
    preset: initialAI.preset,
    baseUrl: initialAI.baseUrl,
    protocol: initialAI.protocol,
    model: initialAI.model,
    apiKey: ""
  });
  const [aiInstruction, setAiInstruction] = useState(initialAI.instruction);
  const [creativity, setCreativity] = useState(initialAI.creativity);
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [aiError, setAiError] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestLayoutResult | null>(null);
  const [suggestionSourceMarkdown, setSuggestionSourceMarkdown] = useState("");
  const [applyNotice, setApplyNotice] = useState("");
  const [imageNotice, setImageNotice] = useState<ImageNotice | null>(null);
  const [imageAssets, setImageAssets] = useState<Record<string, string>>({});
  const [pexelsApiKey, setPexelsApiKey] = useState("");
  const [imageSearches, setImageSearches] = useState<Record<number, ImageSearchState>>({});
  const [publishGuideOpen, setPublishGuideOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [starStatus, setStarStatus] = useState<StarStatus>({ count: 0, starred: false });
  const [starState, setStarState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const supportDevice = useMemo(supportDeviceId, []);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const creativityInfo = useMemo(() => creativityProfile(creativity), [creativity]);

  const hydratedMarkdown = useMemo(() => hydrateLocalImages(markdown, imageAssets), [imageAssets, markdown]);
  const result = useMemo(() => renderWechat(hydratedMarkdown, { theme }), [hydratedMarkdown, theme]);
  const preview = useMemo(() => previewDocument(result.html, theme), [result.html, theme]);
  const suggestionOriginalPreview = useMemo(() => {
    if (!suggestion) return "";
    const source = hydrateLocalImages(suggestionSourceMarkdown, imageAssets);
    return previewDocument(renderWechat(source, { theme }).html, theme);
  }, [imageAssets, suggestion, suggestionSourceMarkdown, theme]);
  const suggestionModifiedPreview = useMemo(() => {
    if (!suggestion) return "";
    const source = hydrateLocalImages(suggestion.markdown, imageAssets);
    return previewDocument(renderWechat(source, { theme }).html, theme);
  }, [imageAssets, suggestion, theme]);

  useEffect(() => {
    let active = true;
    const migration = migrateInlineImages(markdown);
    if (migration.assets.length > 0) {
      setMarkdown(migration.markdown);
      setImageAssets(Object.fromEntries(migration.assets.map((asset) => [asset.id, asset.dataUrl])));
      void Promise.all(migration.assets.map((asset) => saveImageAsset(asset))).catch(() => {
        if (active) setImageNotice({ tone: "error", message: "旧图片已转换，但浏览器未能永久保存；请不要刷新页面。" });
      });
    }

    void loadImageAssets()
      .then((storedAssets) => {
        if (active) setImageAssets((current) => ({ ...storedAssets, ...current }));
      })
      .catch(() => {
        if (active && migration.assets.length === 0) {
          setImageNotice({ tone: "error", message: "浏览器图片存储不可用；本次添加的图片可能无法在刷新后恢复。" });
        }
      });
    return () => { active = false; };
    // Existing inline images only need to be migrated once when the draft opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/support/star?deviceId=${encodeURIComponent(supportDevice)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取支持数");
        return response.json() as Promise<StarStatus>;
      })
      .then((status) => {
        if (!active) return;
        setStarStatus(status);
        setStarState("ready");
      })
      .catch(() => {
        if (active) setStarState("error");
      });
    return () => { active = false; };
  }, [supportDevice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ markdown, themeId: theme.id } satisfies StoredDraft));
      } catch {
        // Draft persistence is a convenience, not a rendering dependency.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [markdown, theme.id]);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then(async (response) => response.json() as Promise<{ ai?: { configured?: boolean } }>)
      .then((health) => {
        if (active) setServerAIConfigured(Boolean(health.ai?.configured));
      })
      .catch(() => {
        if (active) setServerAIConfigured(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const { apiKey: _apiKey, ...safeSettings } = aiSettings;
    try {
      localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify({
        ...safeSettings,
        instruction: aiInstruction,
        creativity
      } satisfies StoredAISettings));
    } catch {
      // Non-sensitive preferences are optional; the API key is never persisted.
    }
  }, [aiInstruction, aiSettings, creativity]);

  useEffect(() => {
    if (aiState !== "loading") {
      setAiElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setAiElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [aiState]);

  function selectTheme(themeId: string) {
    const selected = builtInThemes.find((candidate) => candidate.id === themeId);
    if (selected) setTheme(cloneTheme(selected));
  }

  function updateTypography(patch: Partial<ThemeTokens["typography"]>) {
    setTheme((current) => ({
      ...current,
      typography: { ...current.typography, ...patch }
    }));
  }

  function updateAccent(accent: string) {
    setTheme((current) => ({
      ...current,
      colors: {
        ...current.colors,
        accent,
        accentSoft: rgbaFromHex(accent, 0.08)
      }
    }));
  }

  async function handleCopy() {
    try {
      await copyRichHtml(result.html, result.plainText);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2400);
  }

  async function handleStar() {
    if (starStatus.starred || starState === "saving") return;
    setStarState("saving");
    try {
      const response = await fetch("/api/support/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: supportDevice })
      });
      const payload = await response.json() as StarStatus | APIErrorResponse;
      if (!response.ok || "error" in payload) throw new Error("支持失败");
      setStarStatus(payload);
      setStarState("ready");
    } catch {
      setStarState("error");
    }
  }

  async function insertLocalImage(file: File, start = markdown.length, end = start) {
    if (!SUPPORTED_LOCAL_IMAGE_TYPES.has(file.type)) {
      setImageNotice({ tone: "error", message: "仅支持 PNG、JPG、GIF 和 WebP 图片。" });
      return;
    }
    if (file.size > MAX_LOCAL_IMAGE_BYTES) {
      setImageNotice({ tone: "error", message: "图片不能超过 3 MB，请压缩后再添加。" });
      return;
    }

    const sourceMarkdown = markdown;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const imageId = createImageId();
      const asset = { id: imageId, dataUrl, createdAt: Date.now() } satisfies StoredImageAsset;
      let stored = true;
      try {
        await saveImageAsset(asset);
      } catch {
        stored = false;
      }
      setImageAssets((current) => ({ ...current, [imageId]: dataUrl }));
      let nextCursor = 0;
      setMarkdown((current) => {
        const selectionIsCurrent = current === sourceMarkdown;
        const insertionStart = selectionIsCurrent ? Math.min(start, current.length) : current.length;
        const insertionEnd = selectionIsCurrent ? Math.min(Math.max(end, insertionStart), current.length) : current.length;
        const before = current.slice(0, insertionStart);
        const after = current.slice(insertionEnd);
        const leading = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
        const trailing = after.length === 0 || after.startsWith("\n\n") ? "\n\n" : after.startsWith("\n") ? "\n" : "\n\n";
        const insertion = `${leading}![${markdownImageAlt(file)}](wx-image://${imageId})${trailing}`;
        nextCursor = insertionStart + insertion.length;
        return `${before}${insertion}${after}`;
      });
      setImageNotice({
        tone: stored ? "success" : "error",
        message: stored
          ? "图片已保存到本机并插入预览；编辑区只显示简短引用，不再显示整段 Base64。"
          : "图片已插入，但浏览器未能永久保存；请不要刷新页面。"
      });
      window.requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    } catch (error) {
      setImageNotice({ tone: "error", message: error instanceof Error ? error.message : "无法读取图片。" });
    }
  }

  async function searchSuggestedImages(index: number, suggestionItem: ImageSuggestion) {
    setImageSearches((current) => ({
      ...current,
      [index]: { status: "loading", images: [] }
    }));
    try {
      const response = pexelsApiKey.trim()
        ? await fetch("/api/images/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              q: suggestionItem.query,
              limit: 6,
              orientation: suggestionItem.orientation,
              pexelsApiKey: pexelsApiKey.trim()
            })
          })
        : await fetch(`/api/images/search?q=${encodeURIComponent(suggestionItem.query)}&limit=6&orientation=${suggestionItem.orientation}`);
      const payload = await response.json() as ImageSearchResult | APIErrorResponse;
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error.message ?? "配图搜索失败。" : "配图搜索失败。");
      }
      setImageSearches((current) => ({
        ...current,
        [index]: {
          status: "ready",
          images: payload.images,
          message: payload.images.length === 0 ? "没有找到合适的开放版权图片，可以换一个搜索词。" : undefined
        }
      }));
    } catch (error) {
      setImageSearches((current) => ({
        ...current,
        [index]: {
          status: "error",
          images: [],
          message: error instanceof Error ? error.message : "配图搜索失败。"
        }
      }));
    }
  }

  async function insertSuggestedImage(index: number, suggestionItem: ImageSuggestion, candidate: CommonsImageCandidate) {
    setImageSearches((current) => ({
      ...current,
      [index]: { ...(current[index] ?? { images: [] }), status: "loading", message: "正在下载并保存到本机…" }
    }));
    try {
      const response = await fetch(`/api/images/import?url=${encodeURIComponent(candidate.thumbnailUrl)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as APIErrorResponse | null;
        throw new Error(payload?.error.message ?? "图片导入失败。");
      }
      const blob = await response.blob();
      if (!SUPPORTED_LOCAL_IMAGE_TYPES.has(blob.type) || blob.size > MAX_LOCAL_IMAGE_BYTES) {
        throw new Error("候选图片格式不受支持或超过 3 MB。");
      }
      const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg";
      const file = new File([blob], `${suggestionItem.alt}.${extension}`, { type: blob.type });
      const dataUrl = await readFileAsDataUrl(file);
      const imageId = createImageId();
      const asset = { id: imageId, dataUrl, createdAt: Date.now() } satisfies StoredImageAsset;
      await saveImageAsset(asset);
      setImageAssets((current) => ({ ...current, [imageId]: dataUrl }));

      const marker = `<!-- wx-layout:image-slot:${index} -->`;
      if (!suggestion?.markdown.includes(marker)) {
        throw new Error("修改稿中的配图位置已经失效，请重新生成排版方案。");
      }
      const attribution = `_图片：${markdownText(candidate.artist)} · [${markdownText(candidate.licenseShortName)} / ${candidate.source}](${candidate.sourcePage})_`;
      const imageMarkdown = `![${markdownText(suggestionItem.alt)}](wx-image://${imageId})\n\n${attribution}`;
      setSuggestion((current) => {
        if (!current || !current.markdown.includes(marker)) return current;
        return { ...current, markdown: current.markdown.replace(marker, imageMarkdown) };
      });
      setImageSearches((current) => ({
        ...current,
        [index]: { status: "inserted", images: [], message: "图片已插入 AI 修改稿，并保存到本机。" }
      }));
    } catch (error) {
      setImageSearches((current) => ({
        ...current,
        [index]: {
          ...(current[index] ?? { images: [] }),
          status: "error",
          message: error instanceof Error ? error.message : "图片导入失败。"
        }
      }));
    }
  }

  function handleImagePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(event.clipboardData.items).find(
      (candidate) => candidate.kind === "file" && candidate.type.startsWith("image/")
    );
    const file = item?.getAsFile();
    if (!file) return;

    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    void insertLocalImage(file, start, end);
  }

  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void insertLocalImage(file);
  }

  async function handleAISuggest() {
    setAiError("");
    setSuggestion(null);
    setImageSearches({});
    const hasTemporaryCredentials = Boolean(aiSettings.apiKey.trim() || aiSettings.model.trim());
    if (hasTemporaryCredentials && (!aiSettings.apiKey.trim() || !aiSettings.model.trim() || !aiSettings.baseUrl.trim())) {
      setAiError("请完整填写 API 地址、模型 ID 和 API Key。" );
      setAiState("error");
      return;
    }
    if (!hasTemporaryCredentials && serverAIConfigured !== true) {
      setAiError("请填写模型 ID 和 API Key；API Key 只在当前页面有效。" );
      setAiState("error");
      return;
    }

    const sourceMarkdown = markdown;
    setAiState("loading");
    try {
      const provider = hasTemporaryCredentials ? {
        baseUrl: aiSettings.baseUrl.trim(),
        protocol: aiSettings.protocol,
        model: aiSettings.model.trim(),
        apiKey: aiSettings.apiKey.trim()
      } : undefined;
      const response = await fetch("/api/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: sourceMarkdown,
          instruction: aiInstruction,
          creativity,
          ...(provider ? { provider } : {})
        })
      });
      const payload = await response.json() as SuggestLayoutResult | APIErrorResponse;
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error.message ?? "AI 排版请求失败。" : "AI 排版请求失败。");
      }
      setSuggestion(payload);
      setSuggestionSourceMarkdown(sourceMarkdown);
      setAIPanelOpen(false);
      setAiState("idle");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 排版请求失败。");
      setAiState("error");
    }
  }

  function selectProviderPreset(preset: ProviderPreset) {
    setAISettings((current) => {
      if (preset === "deepseek") {
        return {
          ...current,
          preset,
          baseUrl: "https://api.deepseek.com",
          protocol: "responses",
          model: "deepseek-v4-flash"
        };
      }
      if (preset === "openai") {
        return {
          ...current,
          preset,
          baseUrl: "https://api.openai.com/v1",
          protocol: "responses",
          model: current.preset === "openai" ? current.model : ""
        };
      }
      return {
        ...current,
        preset,
        baseUrl: current.preset === "compatible" ? current.baseUrl : "",
        protocol: "chat-completions",
        model: current.preset === "compatible" ? current.model : ""
      };
    });
    setAiError("");
  }

  function applySuggestion() {
    if (!suggestion) return;
    const cleanMarkdown = suggestion.markdown
      .replace(/\n*<!--\s*wx-layout:image-slot:\d+\s*-->\n*/gi, "\n\n")
      .replace(/\n{3,}/g, "\n\n");
    setMarkdown(cleanMarkdown);
    const changeCount = suggestion.appliedOperations.length + suggestion.automaticRepairs.length;
    setApplyNotice(changeCount > 0
      ? `已应用 ${changeCount} 项 AI 编排修改。`
      : "AI 认为当前稿件无需修改。"
    );
    setSuggestion(null);
    setAiState("idle");
    window.setTimeout(() => setApplyNotice(""), 3_500);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">微</div>
          <div>
            <p className="eyebrow">微信公众号 AI 排版与手机预览工具</p>
            <h1>WX Layout</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="save-state"><span className="save-dot" />已保存到本地</span>
          <button
            className="button ai-button"
            type="button"
            onClick={() => setAIPanelOpen(true)}
            title="打开 AI 排版与 API 配置"
          >
            {aiState === "loading" ? "AI 分析中…" : "AI 排版"}
          </button>
          <button className="button secondary" type="button" onClick={() => downloadHtml(result.html, theme)}>
            导出 HTML
          </button>
          <button className="button primary" type="button" onClick={handleCopy}>
            {copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败" : "复制到公众号"}
          </button>
        </div>
      </header>

      <aside className="support-ribbon" aria-label="支持项目">
        <div className="star-invitation">
          <span>如果您喜欢这个网页，可以给我一个 ⭐ 表示支持 →</span>
          <button
            className="star-button"
            type="button"
            aria-pressed={starStatus.starred}
            disabled={starStatus.starred || starState === "saving"}
            onClick={() => void handleStar()}
          >
            <span aria-hidden="true">⭐</span>
            <strong>{starState === "loading" ? "…" : starStatus.count.toLocaleString()}</strong>
            <small>{starStatus.starred ? "已支持" : starState === "saving" ? "记录中" : "支持"}</small>
          </button>
          {starState === "error" && <small className="star-error">暂时无法连接支持服务</small>}
        </div>
        <button className="support-trigger" type="button" onClick={() => setSupportOpen(true)}>
          <span aria-hidden="true">♡</span> 支持开发
        </button>
      </aside>

      <main className="workspace">
        <aside className="control-panel panel">
          <section>
            <p className="section-kicker">样式</p>
            <h2>主题设置</h2>
            <label className="field">
              <span>主题</span>
              <select value={theme.id} onChange={(event) => selectTheme(event.target.value)}>
                {builtInThemes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <p className="theme-description">{theme.description}</p>
          </section>

          <div className="divider" />

          <section className="control-stack">
            <label className="range-field">
              <span><span>正文字号</span><output>{theme.typography.fontSize}px</output></span>
              <input
                type="range"
                min="14"
                max="20"
                step="1"
                value={theme.typography.fontSize}
                onChange={(event) => updateTypography({ fontSize: Number(event.target.value) })}
              />
            </label>
            <label className="range-field">
              <span><span>行高</span><output>{theme.typography.lineHeight.toFixed(1)}</output></span>
              <input
                type="range"
                min="1.5"
                max="2.2"
                step="0.1"
                value={theme.typography.lineHeight}
                onChange={(event) => updateTypography({ lineHeight: Number(event.target.value) })}
              />
            </label>
            <label className="color-field">
              <span>主题色</span>
              <span className="color-control">
                <input type="color" value={theme.colors.accent} onChange={(event) => updateAccent(event.target.value)} />
                <code>{theme.colors.accent.toUpperCase()}</code>
              </span>
            </label>
          </section>

          <section className="inspection">
            <div className="inspection-heading">
              <div>
                <p className="section-kicker">检查</p>
                <h2>微信兼容性</h2>
              </div>
              <span className={`issue-count ${result.issues.some((item) => item.severity === "error") ? "has-error" : ""}`}>
                {result.issues.length}
              </span>
            </div>
            {result.issues.length === 0 ? (
              <div className="all-clear"><span>✓</span>未发现兼容性问题</div>
            ) : (
              <ul className="issue-list">
                {result.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} data-severity={issue.severity}>
                    <span className="issue-label">{issueLabel(issue)}</span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <section className="editor-panel panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">原稿</p>
              <h2>Markdown</h2>
            </div>
            <div className="editor-heading-actions">
              <div className="stats">
                <span>{result.stats.characters} 字</span>
                <span>{result.stats.headings} 标题</span>
                <span>{result.stats.images} 图片</span>
              </div>
              <label className="image-picker">
                ＋ 添加图片
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={handleImageSelection}
                />
              </label>
            </div>
          </div>
          <div className="editor-paste-hint">在下方编辑区按 Ctrl+V 可粘贴截图；右侧手机预览仅用于查看，不能直接编辑。</div>
          {imageNotice && (
            <div className="image-notice" data-tone={imageNotice.tone} role={imageNotice.tone === "error" ? "alert" : "status"}>
              {imageNotice.message}
              <button type="button" aria-label="关闭图片提示" onClick={() => setImageNotice(null)}>×</button>
            </div>
          )}
          <textarea
            ref={editorRef}
            aria-label="Markdown 文章编辑器"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            onPaste={handleImagePaste}
            placeholder="在这里输入 Markdown，也可以直接按 Ctrl+V 粘贴截图"
            spellCheck="false"
          />
        </section>

        <section className="preview-panel panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">结果</p>
              <h2>手机预览</h2>
            </div>
            <div className="preview-actions">
              <span className="preview-badge">安全沙箱</span>
              <button className="guide-trigger" type="button" onClick={() => setPublishGuideOpen(true)}>如何发布？</button>
            </div>
          </div>
          <div className="final-format-tip">
            <span aria-hidden="true">i</span>
            <p><strong>发布前建议</strong>：将修改稿复制到公众号后台后，再使用公众号自带的一键排版功能进行最终规范，并检查图片、段距和标题层级。</p>
          </div>
          <div className="phone-shell">
            <div className="phone-speaker" />
            <div className="wechat-bar">
              <span>‹</span>
              <strong>公众号预览</strong>
              <span>•••</span>
            </div>
            <iframe title="微信公众号文章预览" sandbox="" srcDoc={preview} />
          </div>
        </section>
      </main>

      {applyNotice && <div className="apply-toast" role="status"><span>✓</span>{applyNotice}</div>}

      {publishGuideOpen && (
        <div className="guide-overlay" role="presentation" onClick={() => setPublishGuideOpen(false)}>
          <section
            className="publish-guide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-guide-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="publish-guide-header">
              <div>
                <p className="section-kicker">PUBLISH</p>
                <h2 id="publish-guide-title">发布到微信公众号</h2>
                <p>当前版本采用“复制排版 → 微信后台粘贴”的安全流程，不会直接替你发布。</p>
              </div>
              <button className="icon-button" type="button" aria-label="关闭发布说明" onClick={() => setPublishGuideOpen(false)}>×</button>
            </div>
            <ol className="publish-steps">
              <li><span>1</span><div><strong>复制排版内容</strong><p>点击下方按钮，复制的是带内联样式的富文本。</p></div></li>
              <li><span>2</span><div><strong>打开公众号后台的新建图文</strong><p>进入文章正文区域后按 Ctrl+V，标题、段落和颜色会一起粘贴。</p></div></li>
              <li><span>3</span><div><strong>检查并处理图片</strong><p>本机图片不是公众号素材；若微信没有自动接收，请在公众号编辑器中上传原图并替换。</p></div></li>
              <li><span>4</span><div><strong>用公众号一键排版做最终规范</strong><p>粘贴后使用公众号后台自带的一键排版，再检查图片、段距、标题层级；最后发送手机预览，确认无误后发布。</p></div></li>
            </ol>
            <div className="publish-guide-note">自动同步到草稿箱需要公众号开发者配置和图片素材上传，当前 MVP 尚未接入。</div>
            <div className="publish-guide-actions">
              <a className="button secondary" href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">打开公众号后台</a>
              <button className="button primary" type="button" onClick={() => void handleCopy()}>
                {copyState === "copied" ? "已复制，可以去粘贴" : copyState === "error" ? "复制失败，请重试" : "复制排版内容"}
              </button>
            </div>
          </section>
        </div>
      )}

      {supportOpen && (
        <div className="support-overlay" role="presentation" onClick={() => setSupportOpen(false)}>
          <section
            className="support-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="support-copy">
              <button className="icon-button support-close" type="button" aria-label="关闭支持开发" onClick={() => setSupportOpen(false)}>×</button>
              <p className="section-kicker">SUPPORT THE MAKER</p>
              <h2 id="support-title">谢谢你愿意支持这个小工具</h2>
              <p className="support-lead">你的每一次使用、反馈和分享，都在帮助 WX Layout 继续变得更好。</p>
              <div className="support-gratitude">
                <span aria-hidden="true">✦</span>
                <p>如果它为你的排版节省了一点时间，欢迎请开发者喝杯咖啡。无论是否打赏，都真心感谢你的到来。</p>
              </div>
              <div className="support-decoration" aria-hidden="true">
                <span>排版更从容</span><i />
                <span>创作有回响</span><i />
                <span>感谢每一份善意</span>
              </div>
            </div>
            <figure className="support-qr-card">
              <div className="qr-halo" aria-hidden="true" />
              <img src="/support-wechat.jpg" alt="微信支付支持开发二维码" />
              <figcaption>使用微信扫一扫 · 感谢支持开发</figcaption>
            </figure>
          </section>
        </div>
      )}

      {aiPanelOpen && (
        <div className="ai-panel-overlay" role="presentation" onClick={() => aiState !== "loading" && setAIPanelOpen(false)}>
          <section
            className="ai-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-panel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-panel-header">
              <div>
                <p className="section-kicker">SETUP & FORMAT</p>
                <h2 id="ai-panel-title">AI 排版</h2>
                <p>第一次使用只需选择接口、填写模型和 API Key。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭 AI 排版面板"
                disabled={aiState === "loading"}
                onClick={() => setAIPanelOpen(false)}
              >×</button>
            </div>

            {serverAIConfigured && (
              <div className="server-configured"><span>✓</span>部署者已预设模型；留空下面的模型和 Key 即可使用。</div>
            )}

            <div className="setup-step">
              <span className="step-number">1</span>
              <div>
                <strong>连接模型 API</strong>
                <small>密钥不会保存，刷新页面后需要重新填写。</small>
              </div>
            </div>

            <div className="preset-grid" role="radiogroup" aria-label="API 类型">
              <button
                type="button"
                role="radio"
                aria-checked={aiSettings.preset === "openai"}
                className={aiSettings.preset === "openai" ? "selected" : ""}
                onClick={() => selectProviderPreset("openai")}
              >
                <strong>OpenAI</strong>
                <small>Responses API</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={aiSettings.preset === "deepseek"}
                className={aiSettings.preset === "deepseek" ? "selected" : ""}
                onClick={() => selectProviderPreset("deepseek")}
              >
                <strong>DeepSeek</strong>
                <small>一键推荐配置</small>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={aiSettings.preset === "compatible"}
                className={aiSettings.preset === "compatible" ? "selected" : ""}
                onClick={() => selectProviderPreset("compatible")}
              >
                <strong>兼容 API</strong>
                <small>自定义服务地址</small>
              </button>
            </div>

            {aiSettings.preset === "deepseek" && (
              <div className="provider-preset-note">
                <span>✓</span>
                已自动配置 Responses API、官方地址和 <code>deepseek-v4-flash</code>，只需填写 API Key。
              </div>
            )}

            {aiSettings.preset === "compatible" && (
              <div className="form-grid two-columns">
                <label className="panel-field wide">
                  <span>API 基础地址</span>
                  <input
                    type="url"
                    value={aiSettings.baseUrl}
                    onChange={(event) => setAISettings((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder="https://provider.example/v1"
                    autoComplete="url"
                  />
                  <small>填写到 `/v1`，不要包含 `/responses` 或 `/chat/completions`。</small>
                </label>
                <label className="panel-field">
                  <span>接口协议</span>
                  <select
                    value={aiSettings.protocol}
                    onChange={(event) => setAISettings((current) => ({ ...current, protocol: event.target.value as AIProtocol }))}
                  >
                    <option value="chat-completions">Chat Completions</option>
                    <option value="responses">Responses</option>
                  </select>
                </label>
              </div>
            )}

            <div className="form-grid two-columns">
              <label className="panel-field">
                <span>模型 ID</span>
                <input
                  value={aiSettings.model}
                  onChange={(event) => setAISettings((current) => ({ ...current, model: event.target.value }))}
                  placeholder={aiSettings.preset === "deepseek" ? "deepseek-v4-flash" : "填写账户中可用的模型 ID"}
                  autoComplete="off"
                />
              </label>
              <label className="panel-field">
                <span>API Key</span>
                <span className="secret-input">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={aiSettings.apiKey}
                    onChange={(event) => setAISettings((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder="sk-…"
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => setShowApiKey((visible) => !visible)}>{showApiKey ? "隐藏" : "显示"}</button>
                </span>
              </label>
            </div>

            <div className="api-key-warning" role="note" aria-label="API Key 安全提醒">
              <span aria-hidden="true">!</span>
              <p><strong>密钥安全提醒</strong>：建议使用为本工具单独创建、余额较低的 API Key，不要使用高额度主密钥；如发现异常调用，请立即在服务商后台吊销并更换。</p>
            </div>

            <div className="setup-step second-step">
              <span className="step-number">2</span>
              <div>
                <strong>告诉 AI 你想要的版式</strong>
                <small>创作自由度越高，AI 可调整的内容结构越多；所有改写都会在应用前展示。</small>
              </div>
            </div>
            <div className="creativity-control">
              <div className="creativity-heading">
                <span>创作自由度（温度）</span>
                <strong>{creativity} · {creativityInfo.label}</strong>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={creativity}
                aria-label={`创作自由度 ${creativity}`}
                onChange={(event) => setCreativity(Number(event.target.value))}
                style={{ "--creativity-progress": `${creativity}%` } as CSSProperties}
              />
              <div className="creativity-scale"><span>忠于原稿</span><span>允许重构</span></div>
              <p>{creativityInfo.instruction}</p>
              <div className="permission-chips" aria-label="当前 AI 权限">
                <span>自动拆段</span>
                <span>信息卡片</span>
                {creativityInfo.allowRewrite && <span>可审查改写</span>}
                {creativityInfo.allowImageSuggestions && <span>配图建议 ≤ {creativityInfo.imageLimit}</span>}
              </div>
            </div>
            {creativityInfo.allowImageSuggestions && (
              <label className="panel-field image-provider-key">
                <span>Pexels 图片库 Key（可选）</span>
                <input
                  type="password"
                  value={pexelsApiKey}
                  onChange={(event) => setPexelsApiKey(event.target.value)}
                  placeholder="留空则使用 Openverse 开放图库"
                  autoComplete="off"
                />
                <small>留空时使用聚合多个开放图库的 Openverse；当前网络不通时，可填写 Pexels Key。Key 不会保存或发送给文字模型。</small>
              </label>
            )}
            <label className="panel-field">
              <span>排版要求</span>
              <textarea
                value={aiInstruction}
                maxLength={500}
                onChange={(event) => setAiInstruction(event.target.value)}
                placeholder="例如：商务、克制，重点不超过 5 处"
              />
            </label>

            {aiState === "loading" && (
              <div className="ai-progress" role="status">
                <span className="ai-progress-spinner" aria-hidden="true" />
                <span><strong>正在等待模型返回排版方案</strong><small>已等待 {aiElapsedSeconds} 秒，请保持此面板打开。</small></span>
              </div>
            )}
            {aiError && <p className="panel-error" role="alert">{aiError}</p>}
            <div className="privacy-note">
              <span aria-hidden="true">◇</span>
              <p><strong>隐私提示</strong>：API Key 仅在本次请求中经本站服务端临时转发给所选服务商，不写入浏览器存储；请仅使用服务商的官方 API 地址。</p>
            </div>
            <div className="ai-panel-actions">
              <button className="button secondary" type="button" disabled={aiState === "loading"} onClick={() => setAIPanelOpen(false)}>取消</button>
              <button className="button primary" type="button" disabled={aiState === "loading"} onClick={handleAISuggest}>
                {aiState === "loading" ? `正在分析… ${aiElapsedSeconds}s` : "生成排版建议"}
              </button>
            </div>
          </section>
        </div>
      )}

      {suggestion && (
        <div className="review-overlay" role="presentation">
          <section className="review-card" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <div className="review-header">
              <div>
                <p className="section-kicker">AI LAYOUT PLAN</p>
                <h2 id="review-title">审查排版建议</h2>
              </div>
              <button className="icon-button" type="button" aria-label="关闭排版建议" onClick={() => setSuggestion(null)}>×</button>
            </div>
            <p className="review-summary">{suggestion.plan.summary}</p>
            {suggestion.contentChanges.length === 0 ? (
              <div className="fidelity-badge"><span>✓</span>正文事实与文字保真校验通过</div>
            ) : (
              <div className="fidelity-badge content-changed"><span>!</span>{suggestion.contentChanges.length} 处文字经过 AI 编辑，请逐项核对</div>
            )}
            <div className="comparison-grid">
              <section className="comparison-pane">
                <header><strong>原稿</strong><span>修改前</span></header>
                <iframe title="AI 排版原稿预览" sandbox="" srcDoc={suggestionOriginalPreview} />
              </section>
              <section className="comparison-pane modified">
                <header><strong>AI 修改稿</strong><span>{suggestion.appliedOperations.length + suggestion.automaticRepairs.length} 项变化</span></header>
                <iframe title="AI 排版修改稿预览" sandbox="" srcDoc={suggestionModifiedPreview} />
              </section>
            </div>
            {suggestion.contentChanges.length > 0 && (
              <section className="review-section content-review">
                <div className="review-section-heading">
                  <strong>文字修改记录</strong>
                  <span>日期、数字和链接已自动锁定</span>
                </div>
                {suggestion.contentChanges.map((change) => (
                  <article className="content-change" key={`${change.blockId}-${change.operationIndex}`}>
                    <p className="change-reason">{change.reason}</p>
                    <div><small>原文</small><p>{change.before}</p></div>
                    <div className="after"><small>修改后</small><p>{change.after}</p></div>
                  </article>
                ))}
              </section>
            )}
            {suggestion.automaticRepairs.length > 0 && (
              <section className="review-section">
                <div className="review-section-heading"><strong>本地二次整理</strong><span>模型漏分段时自动补救，不改正文</span></div>
                <div className="editorial-note-grid">
                  {suggestion.automaticRepairs.map((repair, index) => (
                    <article key={`${repair.blockId}-${repair.kind}-${index}`}>
                      <span>兜底</span>
                      <strong>{repair.kind === "long-heading" ? "长标题已拆行" : repair.kind === "structured-information" ? "密集信息已分卡" : "长正文已分段"}</strong>
                      <p>{repair.description}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {suggestion.plan.editorialNotes.length > 0 && (
              <section className="review-section">
                <div className="review-section-heading"><strong>内容筛查与梳理</strong><span>仅提示，不会自动删除</span></div>
                <div className="editorial-note-grid">
                  {suggestion.plan.editorialNotes.map((note, index) => (
                    <article key={`${note.blockId}-${index}`}>
                      <span>{note.kind === "dense" ? "密集" : note.kind === "duplicate" ? "重复" : note.kind === "clarify" ? "核实" : "重点"}</span>
                      <strong>{note.title}</strong>
                      <p>{note.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {suggestion.plan.imageSuggestions.length > 0 && (
              <section className="review-section image-suggestions">
                <div className="review-section-heading"><strong>相关配图建议</strong><span>点击后才会向 {pexelsApiKey.trim() ? "Pexels" : "Openverse"} 发送下方搜索词；使用前请核实许可证</span></div>
                {suggestion.plan.imageSuggestions.map((imageSuggestion, index) => {
                  const search = imageSearches[index] ?? { status: "idle", images: [] };
                  return (
                    <article className="image-suggestion" key={`${imageSuggestion.afterBlockId}-${index}`}>
                      <div className="image-suggestion-copy">
                        <span>{imageSuggestion.orientation === "landscape" ? "横图" : imageSuggestion.orientation === "portrait" ? "竖图" : "方图"}</span>
                        <div><strong>{imageSuggestion.query}</strong><p>{imageSuggestion.purpose}</p></div>
                        <button
                          className="button secondary compact"
                          type="button"
                          disabled={search.status === "loading" || search.status === "inserted"}
                          onClick={() => void searchSuggestedImages(index, imageSuggestion)}
                        >
                          {search.status === "loading" ? "处理中…" : search.status === "inserted" ? "已插入" : "查找候选图"}
                        </button>
                      </div>
                      {search.message && <p className={`image-search-message ${search.status}`}>{search.message}</p>}
                      {search.status === "error" && (
                        <a
                          className="manual-image-search"
                          href={pexelsApiKey.trim()
                            ? `https://www.pexels.com/search/${encodeURIComponent(imageSuggestion.query)}/`
                            : `https://openverse.org/search/image?q=${encodeURIComponent(imageSuggestion.query)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          在图库网页中继续搜索 ↗
                        </a>
                      )}
                      {search.images.length > 0 && (
                        <div className="image-candidate-grid">
                          {search.images.map((candidate) => (
                            <article className="image-candidate" key={candidate.id}>
                              <img src={candidate.thumbnailUrl} alt={candidate.title} loading="lazy" />
                              <div>
                                <strong>{candidate.title}</strong>
                                <small>{candidate.artist} · {candidate.licenseShortName}</small>
                                <span>
                                  <a href={candidate.sourcePage} target="_blank" rel="noreferrer">查看来源</a>
                                  <button type="button" onClick={() => void insertSuggestedImage(index, imageSuggestion, candidate)}>插入此图</button>
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )}
            {suggestion.plan.operations.length === 0 ? (
              <p className="no-operations">当前结构已经清楚，模型没有建议额外操作。</p>
            ) : (
              <ol className="operation-list">
                {suggestion.plan.operations.map((operation, index) => (
                  <li key={`${operation.type}-${index}`}>
                    <span className="operation-index">{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <strong>{operationLabel(operation)}</strong>
                      <small>{operation.reason}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {suggestion.warnings.length > 0 && (
              <div className="plan-warnings">
                {suggestion.warnings.map((warning) => <p key={`${warning.operationIndex}-${warning.code}`}>{warning.message}</p>)}
              </div>
            )}
            <div className="review-actions">
              <button className="button secondary" type="button" onClick={() => setSuggestion(null)}>取消</button>
              <button
                className="button primary"
                type="button"
                onClick={applySuggestion}
              >
                应用
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
