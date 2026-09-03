export interface ImageCandidate {
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

interface CommonsMetadataValue {
  value?: unknown;
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataValue(metadata: Record<string, CommonsMetadataValue> | undefined, key: string): string {
  return plainText(metadata?.[key]?.value);
}

export async function searchCommonsImages(
  query: string,
  fetcher: typeof fetch = globalThis.fetch,
  limit = 6
): Promise<ImageCandidate[]> {
  const normalizedQuery = query.trim().slice(0, 100);
  if (!normalizedQuery) return [];
  const count = Math.max(1, Math.min(8, Math.round(limit)));
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrlimit: String(count),
    gsrsearch: normalizedQuery,
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "960",
    iiextmetadatalanguage: "zh",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl"
  }).toString();

  const response = await fetcher(url, {
    headers: { "Api-User-Agent": "WX-Layout/0.1 (open-source WeChat layout editor)" }
  });
  if (!response.ok) throw new Error(`图片服务返回 HTTP ${response.status}`);
  const payload = await response.json() as {
    query?: { pages?: Record<string, {
      pageid?: number;
      title?: string;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        descriptionurl?: string;
        mime?: string;
        width?: number;
        height?: number;
        extmetadata?: Record<string, CommonsMetadataValue>;
      }>;
    }> };
  };

  return Object.values(payload.query?.pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (!info?.url || !info.thumburl || !info.mime?.startsWith("image/") || info.mime === "image/svg+xml") return [];
    const original = new URL(info.url);
    const thumbnail = new URL(info.thumburl);
    if (original.protocol !== "https:" || thumbnail.protocol !== "https:") return [];
    if (original.hostname !== "upload.wikimedia.org" || thumbnail.hostname !== "upload.wikimedia.org") return [];
    const metadata = info.extmetadata;
    return [{
      id: String(page.pageid ?? page.title ?? info.url),
      title: plainText(page.title?.replace(/^File:/i, "")) || "Wikimedia Commons 图片",
      thumbnailUrl: thumbnail.toString(),
      originalUrl: original.toString(),
      sourcePage: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? "")}`,
      artist: metadataValue(metadata, "Artist") || "Wikimedia Commons contributor",
      licenseShortName: metadataValue(metadata, "LicenseShortName") || "查看来源页许可证",
      licenseUrl: metadataValue(metadata, "LicenseUrl") || info.descriptionurl || "https://commons.wikimedia.org/",
      width: info.width ?? 0,
      height: info.height ?? 0,
      source: "Wikimedia Commons"
    }];
  });
}

export async function searchOpenverseImages(
  query: string,
  orientation: "landscape" | "portrait" | "square" = "landscape",
  fetcher: typeof fetch = globalThis.fetch,
  limit = 6
): Promise<ImageCandidate[]> {
  const normalizedQuery = query.trim().slice(0, 100);
  if (!normalizedQuery) return [];
  const count = Math.max(1, Math.min(8, Math.round(limit)));
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: normalizedQuery,
    page_size: String(count),
    aspect_ratio: orientation === "portrait" ? "tall" : orientation === "square" ? "square" : "wide",
    mature: "false"
  }).toString();

  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "User-Agent": "WX-Layout/0.1 (open-source WeChat layout editor)" },
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("无法连接 Openverse 图片服务；可填写 Pexels API Key，或在图库网页继续搜索。");
  }
  if (!response.ok) throw new Error(`Openverse 图片服务返回 HTTP ${response.status}`);
  const payload = await response.json() as {
    results?: Array<{
      id?: string;
      title?: string;
      url?: string;
      thumbnail?: string;
      foreign_landing_url?: string;
      creator?: string;
      license?: string;
      license_version?: string;
      license_url?: string;
      width?: number;
      height?: number;
      mature?: boolean;
      provider?: string;
      source?: string;
    }>;
  };

  return (payload.results ?? []).flatMap((item) => {
    if (item.mature || !item.id || !item.thumbnail || !item.foreign_landing_url) return [];
    let thumbnail: URL;
    let sourcePage: URL;
    try {
      thumbnail = new URL(item.thumbnail);
      sourcePage = new URL(item.foreign_landing_url);
    } catch {
      return [];
    }
    if (thumbnail.protocol !== "https:" || sourcePage.protocol !== "https:") return [];
    if (!new Set(["api.openverse.org", "api.openverse.engineering"]).has(thumbnail.hostname)) return [];
    const licenseName = [plainText(item.license).toUpperCase(), plainText(item.license_version)].filter(Boolean).join(" ");
    const providerName = plainText(item.provider ?? item.source);
    return [{
      id: `openverse-${item.id}`,
      title: plainText(item.title) || "Openverse 图片",
      thumbnailUrl: thumbnail.toString(),
      originalUrl: typeof item.url === "string" ? item.url : thumbnail.toString(),
      sourcePage: sourcePage.toString(),
      artist: plainText(item.creator) || "Openverse contributor",
      licenseShortName: licenseName || "请在来源页核实许可证",
      licenseUrl: typeof item.license_url === "string" ? item.license_url : sourcePage.toString(),
      width: item.width ?? 0,
      height: item.height ?? 0,
      source: providerName ? `Openverse · ${providerName}` : "Openverse"
    }];
  });
}

export async function searchPexelsImages(
  query: string,
  apiKey: string,
  orientation: "landscape" | "portrait" | "square" = "landscape",
  fetcher: typeof fetch = globalThis.fetch,
  limit = 6
): Promise<ImageCandidate[]> {
  const normalizedQuery = query.trim().slice(0, 100);
  const normalizedKey = apiKey.trim();
  if (!normalizedQuery || !normalizedKey) return [];
  const count = Math.max(1, Math.min(8, Math.round(limit)));
  const url = new URL("https://api.pexels.com/v1/search");
  url.search = new URLSearchParams({
    query: normalizedQuery,
    per_page: String(count),
    orientation,
    locale: "zh-CN"
  }).toString();
  const response = await fetcher(url, { headers: { Authorization: normalizedKey } });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Pexels API Key 无效，请检查后重试。");
    throw new Error(`Pexels 图片服务返回 HTTP ${response.status}`);
  }
  const payload = await response.json() as {
    photos?: Array<{
      id?: number;
      width?: number;
      height?: number;
      url?: string;
      alt?: string;
      photographer?: string;
      photographer_url?: string;
      src?: { large?: string; landscape?: string; portrait?: string; medium?: string };
    }>;
  };
  return (payload.photos ?? []).flatMap((photo) => {
    const imageUrl = photo.src?.large ?? photo.src?.landscape ?? photo.src?.portrait ?? photo.src?.medium;
    if (!imageUrl || !photo.url) return [];
    const image = new URL(imageUrl);
    const page = new URL(photo.url);
    if (image.protocol !== "https:" || image.hostname !== "images.pexels.com" || page.protocol !== "https:") return [];
    return [{
      id: `pexels-${photo.id ?? imageUrl}`,
      title: plainText(photo.alt) || "Pexels 图片",
      thumbnailUrl: image.toString(),
      originalUrl: image.toString(),
      sourcePage: page.toString(),
      artist: plainText(photo.photographer) || "Pexels contributor",
      licenseShortName: "Pexels License",
      licenseUrl: "https://www.pexels.com/license/",
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      source: "Pexels"
    }];
  });
}

export async function fetchSupportedImage(urlValue: string, fetcher: typeof fetch = globalThis.fetch): Promise<Response> {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("图片地址无效。");
  }
  const allowedHosts = new Set(["upload.wikimedia.org", "images.pexels.com", "api.openverse.org", "api.openverse.engineering"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new Error("只允许导入受支持开放图库的图片。");
  }
  const response = await fetcher(url, {
    headers: { "Api-User-Agent": "WX-Layout/0.1 (open-source WeChat layout editor)" }
  });
  if (!response.ok) throw new Error(`图片下载返回 HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(contentType)) {
    throw new Error("图片格式不受支持。");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 3 * 1024 * 1024) throw new Error("候选图片超过 3 MB，请选择其他图片。");
  return response;
}

export const fetchCommonsImage = fetchSupportedImage;
