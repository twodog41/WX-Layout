import { describe, expect, it, vi } from "vitest";
import { fetchCommonsImage, searchCommonsImages, searchOpenImages, searchOpenverseImages, searchPexelsImages } from "./images.js";

describe("Wikimedia Commons image integration", () => {
  it("returns safe bitmap candidates with attribution metadata", async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({
      query: {
        pages: {
          "1": {
            pageid: 1,
            title: "File:Campus.jpg",
            imageinfo: [{
              url: "https://upload.wikimedia.org/campus.jpg",
              thumburl: "https://upload.wikimedia.org/campus-960.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Campus.jpg",
              mime: "image/jpeg",
              width: 1600,
              height: 900,
              extmetadata: {
                Artist: { value: "<b>Example Photographer</b>" },
                LicenseShortName: { value: "CC BY-SA 4.0" },
                LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" }
              }
            }]
          },
          "2": {
            pageid: 2,
            title: "File:Unsafe.svg",
            imageinfo: [{
              url: "https://upload.wikimedia.org/unsafe.svg",
              thumburl: "https://upload.wikimedia.org/unsafe.svg.png",
              mime: "image/svg+xml"
            }]
          }
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const images = await searchCommonsImages("university campus", fakeFetch as typeof fetch);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ artist: "Example Photographer", licenseShortName: "CC BY-SA 4.0" });
    expect(String(fakeFetch.mock.calls[0]?.[0])).toContain("commons.wikimedia.org/w/api.php");
  });

  it("only imports supported Wikimedia bitmap URLs", async () => {
    await expect(fetchCommonsImage("https://example.com/photo.jpg", vi.fn() as unknown as typeof fetch))
      .rejects.toThrow("只允许导入受支持开放图库的图片");

    const fakeFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "3" }
    }));
    const response = await fetchCommonsImage("https://upload.wikimedia.org/photo.jpg", fakeFetch as typeof fetch);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("searches Pexels with a session-only key and normalizes attribution", async () => {
    const fakeFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => new Response(JSON.stringify({
      photos: [{
        id: 42,
        width: 1200,
        height: 800,
        url: "https://www.pexels.com/photo/campus-42/",
        alt: "University campus in autumn",
        photographer: "Sample Author",
        src: { large: "https://images.pexels.com/photos/42/campus.jpeg" }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const images = await searchPexelsImages("校园 秋季", "pexels-key", "landscape", fakeFetch as typeof fetch);
    expect(images[0]).toMatchObject({ source: "Pexels", artist: "Sample Author", licenseShortName: "Pexels License" });
    expect(fakeFetch.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "pexels-key" });
  });

  it("searches Openverse across providers and keeps license attribution", async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        id: "ov-42",
        title: "Autumn campus",
        url: "https://live.staticflickr.com/campus.jpg",
        thumbnail: "https://api.openverse.org/v1/images/ov-42/thumb/",
        foreign_landing_url: "https://www.flickr.com/photos/example/42",
        creator: "Example Photographer",
        license: "by-sa",
        license_version: "4.0",
        license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
        provider: "flickr",
        width: 1600,
        height: 900,
        mature: false
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const images = await searchOpenverseImages("大学校园 秋景", "landscape", fakeFetch as typeof fetch);
    expect(images[0]).toMatchObject({
      source: "Openverse · flickr",
      artist: "Example Photographer",
      licenseShortName: "BY-SA 4.0"
    });
    expect(String(fakeFetch.mock.calls[0]?.[0])).toContain("api.openverse.org/v1/images/");
    expect(String(fakeFetch.mock.calls[0]?.[0])).toContain("aspect_ratio=wide");
  });

  it("falls back to Wikimedia Commons when Openverse rejects the server", async () => {
    const fakeFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "api.openverse.org") return new Response("forbidden", { status: 403 });
      return new Response(JSON.stringify({
        query: {
          pages: {
            "7": {
              pageid: 7,
              title: "File:Fallback campus.jpg",
              imageinfo: [{
                url: "https://upload.wikimedia.org/fallback-campus.jpg",
                thumburl: "https://upload.wikimedia.org/fallback-campus-960.jpg",
                descriptionurl: "https://commons.wikimedia.org/wiki/File:Fallback_campus.jpg",
                mime: "image/jpeg",
                width: 1600,
                height: 900
              }]
            }
          }
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await searchOpenImages("university campus", "landscape", fakeFetch as typeof fetch, 6);

    expect(result.source).toBe("Wikimedia Commons");
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.source).toBe("Wikimedia Commons");
  });
});
