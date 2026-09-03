export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorJson(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

export function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,128}$/.test(value);
}
