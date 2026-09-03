import { env } from "cloudflare:workers";

const createTableSql = `CREATE TABLE IF NOT EXISTS support_stars (
  device_hash TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function deviceHash(deviceId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceId));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function readyDatabase(): Promise<D1Database> {
  const database = env.DB;
  if (!database) throw new Error("D1 database is unavailable");
  await database.prepare(createTableSql).run();
  return database;
}

export async function starStatus(deviceId?: string): Promise<{ count: number; starred: boolean }> {
  const database = await readyDatabase();
  const countRow = await database.prepare("SELECT COUNT(*) AS count FROM support_stars").first<{ count: number }>();
  if (!deviceId) return { count: Number(countRow?.count ?? 0), starred: false };
  const hash = await deviceHash(deviceId);
  const match = await database.prepare("SELECT 1 AS found FROM support_stars WHERE device_hash = ? LIMIT 1").bind(hash).first();
  return { count: Number(countRow?.count ?? 0), starred: Boolean(match) };
}

export async function addStar(deviceId: string): Promise<{ count: number; starred: boolean }> {
  const database = await readyDatabase();
  const hash = await deviceHash(deviceId);
  await database.prepare("INSERT OR IGNORE INTO support_stars (device_hash) VALUES (?)").bind(hash).run();
  return starStatus(deviceId);
}
