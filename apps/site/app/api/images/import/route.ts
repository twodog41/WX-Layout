import { fetchSupportedImage } from "../../../../lib/images";
import { errorJson } from "../../../../lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return errorJson("invalid_image_url", "缺少图片地址。", 400);
  try {
    const source = await fetchSupportedImage(url, fetch);
    const buffer = await source.arrayBuffer();
    if (buffer.byteLength > 3 * 1024 * 1024) return errorJson("image_too_large", "候选图片超过 3 MB，请选择其他图片。", 413);
    return new Response(buffer, { headers: { "Content-Type": source.headers.get("content-type") ?? "application/octet-stream" } });
  } catch (error) {
    return errorJson("image_import_failed", error instanceof Error ? error.message : "图片导入失败。", 502);
  }
}
