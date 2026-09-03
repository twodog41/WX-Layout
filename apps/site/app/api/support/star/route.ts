import { addStar, starStatus } from "../../../../lib/stars";
import { errorJson, json, validDeviceId } from "../../../../lib/http";

export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get("deviceId") ?? undefined;
  if (deviceId !== undefined && !validDeviceId(deviceId)) return errorJson("invalid_device_id", "支持标识无效，请刷新页面后重试。", 400);
  try {
    return json(await starStatus(deviceId));
  } catch {
    return errorJson("star_service_unavailable", "暂时无法读取支持数，请稍后再试。", 503);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { deviceId?: unknown } | null;
  if (!validDeviceId(body?.deviceId)) return errorJson("invalid_device_id", "支持标识无效，请刷新页面后重试。", 400);
  try {
    return json(await addStar(body.deviceId));
  } catch {
    return errorJson("star_service_unavailable", "暂时无法记录支持，请稍后再试。", 503);
  }
}
