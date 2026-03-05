import { getSession } from "./server-functions";

type SessionData = Awaited<ReturnType<typeof getSession>>;

let cachedSession: SessionData | undefined;
let cacheTimestamp = 0;
const CACHE_TTL = 30_000;

export async function ensureSession(): Promise<SessionData> {
  if (typeof window === "undefined") {
    return getSession();
  }

  const now = Date.now();
  if (cachedSession !== undefined && now - cacheTimestamp < CACHE_TTL) {
    return cachedSession;
  }

  const session = await getSession();
  cachedSession = session;
  cacheTimestamp = now;
  return session;
}

export function clearSessionCache(): void {
  cachedSession = undefined;
  cacheTimestamp = 0;
}
