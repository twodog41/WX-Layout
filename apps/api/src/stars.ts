import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface StarStatus {
  count: number;
  starred: boolean;
}

export interface StarStore {
  status(deviceId?: string): Promise<StarStatus>;
  add(deviceId: string): Promise<StarStatus>;
}

interface StoredStars {
  version: 1;
  voters: string[];
}

function hashDevice(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

export class FileStarStore implements StarStore {
  readonly #filePath: string;
  #mutation: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#filePath = resolve(dataDirectory, "support-stars.json");
  }

  async #read(): Promise<StoredStars> {
    try {
      const payload = JSON.parse(await readFile(this.#filePath, "utf8")) as Partial<StoredStars>;
      return {
        version: 1,
        voters: Array.isArray(payload.voters)
          ? [...new Set(payload.voters.filter((value): value is string => typeof value === "string"))]
          : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) {
        return { version: 1, voters: [] };
      }
      throw error;
    }
  }

  async status(deviceId?: string): Promise<StarStatus> {
    await this.#mutation;
    const data = await this.#read();
    const deviceHash = deviceId ? hashDevice(deviceId) : undefined;
    return { count: data.voters.length, starred: Boolean(deviceHash && data.voters.includes(deviceHash)) };
  }

  async add(deviceId: string): Promise<StarStatus> {
    let result: StarStatus = { count: 0, starred: false };
    const operation = this.#mutation.then(async () => {
      const data = await this.#read();
      const deviceHash = hashDevice(deviceId);
      if (!data.voters.includes(deviceHash)) {
        data.voters.push(deviceHash);
        await mkdir(resolve(this.#filePath, ".."), { recursive: true });
        await writeFile(this.#filePath, JSON.stringify(data), "utf8");
      }
      result = { count: data.voters.length, starred: true };
    });
    this.#mutation = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }
}
