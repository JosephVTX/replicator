import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type Row } from "@libsql/client";
import { PATHS } from "../paths.ts";

const url = "file:" + PATHS.db.replace(/\\/g, "/");

// The directory must exist before the client opens the file.
fs.mkdirSync(path.dirname(PATHS.db), { recursive: true });

export const db: Client = createClient({ url });

export async function migrate(): Promise<void> {
  const schemaPath = path.join(import.meta.dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await db.executeMultiple(sql);
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Run a query and return the rows. */
export async function all<T = Record<string, InValue>>(
  sql: string,
  args: InValue[] = [],
): Promise<T[]> {
  const res = await db.execute({ sql, args });
  return res.rows as unknown as T[];
}

/** Run a query and return the first row (or null). */
export async function one<T = Record<string, InValue>>(
  sql: string,
  args: InValue[] = [],
): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

/** Run a statement and return info (rowsAffected, lastInsertRowid). */
export async function run(sql: string, args: InValue[] = []) {
  return db.execute({ sql, args });
}

export type { Row };
