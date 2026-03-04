import { env } from "@/lib/env";
import { createDrizzle, type DrizzleDB } from "../db";
import * as queries from "../db/queries";
import type { UserRole } from "../db/schema";
import { createAuth } from "./auth";
import { logger } from "./logger";

export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

type AuthSession = Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>;
type AuthenticatedSession = NonNullable<AuthSession>;

export type ActiveUserRole = Exclude<UserRole, "waitlist">;

export type ActiveUser = {
  userId: string;
  role: ActiveUserRole;
  session: AuthenticatedSession;
};

function isActiveRole(role: UserRole | null): role is ActiveUserRole {
  return role === "user" || role === "admin";
}

export async function requireActiveUserFromSession(session: AuthSession, dbOverride?: DrizzleDB): Promise<ActiveUser> {
  if (!session?.user) {
    throw new AuthError("Unauthorized", 401);
  }
  const authenticatedSession = session as AuthenticatedSession;

  const db = dbOverride ?? createDrizzle(env.DB);
  let role: UserRole | null = null;

  try {
    role = await queries.getUserRole(db, session.user.id);
  } catch (error) {
    logger.error("Failed to fetch user role for access check", {
      userId: session.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isActiveRole(role)) {
    throw new AuthError("Forbidden: Waitlist access required", 403);
  }

  return { userId: authenticatedSession.user.id, role, session: authenticatedSession };
}

export async function requireActiveUser(headers: HeadersInit, dbOverride?: DrizzleDB): Promise<ActiveUser> {
  const auth = createAuth();
  const session = await auth.api.getSession({ headers });
  return requireActiveUserFromSession(session, dbOverride);
}

export async function tryGetActiveUserId(headers: HeadersInit, dbOverride?: DrizzleDB): Promise<string | null> {
  try {
    const auth = createAuth();
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      return null;
    }
    const activeUser = await requireActiveUserFromSession(session, dbOverride);
    return activeUser.userId;
  } catch {
    return null;
  }
}

export function getAuthErrorResponse(error: unknown): { status: number; message: string } | null {
  if (error instanceof AuthError) {
    return { status: error.status, message: error.message };
  }
  return null;
}
