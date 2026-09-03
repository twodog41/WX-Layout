import { describe, expect, it } from "vitest";
import { hydrateLocalImages, migrateInlineImages } from "./image-assets";

describe("local image references", () => {
  it("replaces inline Base64 with a short local reference and can hydrate it for rendering", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const migration = migrateInlineImages(`正文\n\n![截图](${dataUrl})`);

    expect(migration.assets).toHaveLength(1);
    expect(migration.markdown).not.toContain("base64");
    expect(migration.markdown).toMatch(/!\[截图\]\(wx-image:\/\/[a-z0-9-]+\)/i);
    expect(hydrateLocalImages(migration.markdown, {
      [migration.assets[0]!.id]: migration.assets[0]!.dataUrl
    })).toContain(dataUrl);
  });

  it("leaves normal Markdown unchanged", () => {
    expect(migrateInlineImages("# 标题\n\n正文")).toMatchObject({ markdown: "# 标题\n\n正文", assets: [] });
  });
});
