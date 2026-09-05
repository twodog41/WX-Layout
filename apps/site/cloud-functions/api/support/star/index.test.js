import { describe, expect, it } from "vitest";
import { handleGet, handlePost } from "./index.js";

function memoryStore() {
  const records = new Map();
  return {
    async get(key) {
      return records.has(key) ? records.get(key) : null;
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return;
      records.set(key, value);
    },
    async list({ prefix }) {
      return {
        blobs: [...records.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key, etag: key }))
      };
    }
  };
}

describe("EdgeOne star function", () => {
  it("records each device once and returns the shared count", async () => {
    const store = memoryStore();
    const request = () => new Request("https://wxlayout.cn/api/support/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "12345678-1234-1234-1234-123456789012" })
    });

    expect(await (await handlePost(request(), store)).json()).toEqual({ count: 1, starred: true });
    expect(await (await handlePost(request(), store)).json()).toEqual({ count: 1, starred: true });
    expect(await (await handleGet(new Request("https://wxlayout.cn/api/support/star"), store)).json())
      .toEqual({ count: 1, starred: false });
  });

  it("rejects an invalid device identifier", async () => {
    const response = await handleGet(
      new Request("https://wxlayout.cn/api/support/star?deviceId=bad"),
      memoryStore()
    );
    expect(response.status).toBe(400);
  });
});
