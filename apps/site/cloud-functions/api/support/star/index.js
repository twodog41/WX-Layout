import { getStore } from "@edgeone/pages-blob";

const DEVICE_ID_PATTERN = /^[a-zA-Z0-9-]{16,128}$/;
const STAR_PREFIX = "stars/";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function errorJson(code, message, status) {
  return json({ error: { code, message } }, status);
}

function validDeviceId(value) {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

async function deviceHash(deviceId) {
  const bytes = new TextEncoder().encode(deviceId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function starStore() {
  return getStore({ name: "wx-layout-stars", consistency: "strong" });
}

async function starStatus(store, deviceId) {
  const [{ blobs }, record] = await Promise.all([
    store.list({ prefix: STAR_PREFIX, consistency: "strong" }),
    deviceId
      ? deviceHash(deviceId).then((hash) => store.get(`${STAR_PREFIX}${hash}`, { consistency: "strong" }))
      : Promise.resolve(null)
  ]);
  return { count: blobs.length, starred: record !== null };
}

export async function handleGet(request, store = starStore()) {
  const deviceId = new URL(request.url).searchParams.get("deviceId") ?? undefined;
  if (deviceId !== undefined && !validDeviceId(deviceId)) {
    return errorJson("invalid_device_id", "支持标识无效，请刷新页面后重试。", 400);
  }
  try {
    return json(await starStatus(store, deviceId));
  } catch (error) {
    console.error("Unable to read EdgeOne star storage", error);
    return errorJson("star_service_unavailable", "暂时无法读取支持数，请稍后再试。", 503);
  }
}

export async function handlePost(request, store = starStore()) {
  const body = await request.json().catch(() => null);
  if (!validDeviceId(body?.deviceId)) {
    return errorJson("invalid_device_id", "支持标识无效，请刷新页面后重试。", 400);
  }
  try {
    const hash = await deviceHash(body.deviceId);
    const key = `${STAR_PREFIX}${hash}`;
    const existing = await store.get(key, { consistency: "strong" });
    if (existing === null) {
      try {
        await store.setJSON(key, { createdAt: new Date().toISOString() }, { onlyIfNew: true });
      } catch (error) {
        const concurrentRecord = await store.get(key, { consistency: "strong" });
        if (concurrentRecord === null) throw error;
      }
    }
    return json(await starStatus(store, body.deviceId));
  } catch (error) {
    console.error("Unable to update EdgeOne star storage", error);
    return errorJson("star_service_unavailable", "暂时无法记录支持，请稍后再试。", 503);
  }
}

export function onRequestGet({ request }) {
  return handleGet(request);
}

export function onRequestPost({ request }) {
  return handlePost(request);
}
