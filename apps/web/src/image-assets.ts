export interface StoredImageAsset {
  id: string;
  dataUrl: string;
  createdAt: number;
}

export interface ImageMigration {
  markdown: string;
  assets: StoredImageAsset[];
}

export function createImageId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function migrateInlineImages(markdown: string): ImageMigration {
  const assets: StoredImageAsset[] = [];
  const nextMarkdown = markdown.replace(
    /!\[([^\]\n]*)\]\((data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+)\)/gi,
    (_match, alt: string, dataUrl: string) => {
      const id = createImageId();
      assets.push({ id, dataUrl, createdAt: Date.now() });
      return `![${alt}](wx-image://${id})`;
    }
  );
  return { markdown: nextMarkdown, assets };
}

export function hydrateLocalImages(markdown: string, assets: Record<string, string>): string {
  return markdown.replace(/wx-image:\/\/([a-z0-9-]+)/gi, (source, id: string) => assets[id] ?? source);
}
