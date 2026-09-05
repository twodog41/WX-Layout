import { searchOpenImages, searchPexelsImages } from "../../../../lib/images";
import { errorJson, json } from "../../../../lib/http";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (!query || query.length > 100) return errorJson("invalid_image_query", "配图搜索词应为 1 到 100 个字符。", 400);
  const limit = Math.max(1, Math.min(8, Number.parseInt(params.get("limit") ?? "6", 10) || 6));
  const orientation = params.get("orientation") === "portrait" || params.get("orientation") === "square" ? params.get("orientation") as "portrait" | "square" : "landscape";
  try {
    return json({ query, ...await searchOpenImages(query, orientation, fetch, limit) });
  } catch (error) {
    return errorJson("image_search_failed", error instanceof Error ? error.message : "配图搜索失败。", 502);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const query = body?.q;
  const key = body?.pexelsApiKey;
  if (typeof query !== "string" || !query.trim() || query.length > 100) return errorJson("invalid_image_query", "配图搜索词应为 1 到 100 个字符。", 400);
  if (typeof key !== "string" || !key.trim() || key.length > 4096) return errorJson("invalid_image_key", "请填写有效的 Pexels API Key。", 400);
  const orientation = body?.orientation === "portrait" || body?.orientation === "square" ? body.orientation : "landscape";
  const limit = typeof body?.limit === "number" ? Math.max(1, Math.min(8, Math.round(body.limit))) : 6;
  try {
    return json({ query, source: "Pexels", images: await searchPexelsImages(query, key, orientation, fetch, limit) });
  } catch (error) {
    return errorJson("image_search_failed", error instanceof Error ? error.message : "Pexels 配图搜索失败。", 502);
  }
}
