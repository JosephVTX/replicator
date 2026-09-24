import { countUsers, createUser } from "./auth/sessions.ts";
import { env } from "./env.ts";

/** Creates the first administrator from env vars on a fresh database. */
export async function bootstrapAdmin(): Promise<void> {
  const users = await countUsers();
  if (users > 0) return;
  await createUser({
    email: env.ADMIN_EMAIL,
    name: "Administrator",
    password: env.ADMIN_PASSWORD,
    role: "admin",
  });
  // eslint-disable-next-line no-console
  console.log(`[bootstrap] created admin account: ${env.ADMIN_EMAIL}`);
}
