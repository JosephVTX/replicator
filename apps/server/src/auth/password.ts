import { hash, verify } from "@node-rs/argon2";

/** Argon2id (algorithm id 2) with ~19 MB of memory and 2 iterations. */
const OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password, OPTIONS);
  } catch {
    return false;
  }
}
