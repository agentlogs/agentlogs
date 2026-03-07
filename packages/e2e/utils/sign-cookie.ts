import crypto from "crypto";

/**
 * Signs a value using HMAC-SHA256 (matching better-call/better-auth's cookie signing format).
 *
 * The format is: value.signature
 * - signature is base64 encoded (NOT base64url), 44 chars, ending with "="
 */
export function signCookie(value: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(value);
  // Standard base64 encoding (44 characters, ending with "=")
  const signature = hmac.digest("base64");
  // Cookie format is: value.signature (NOT URL-encoded)
  return `${value}.${signature}`;
}

/**
 * The BETTER_AUTH_SECRET used by the e2e test server.
 * Keeping this in code makes the suite independent of local .env files.
 */
export const TEST_AUTH_SECRET = "IPTC+aAEkEWhGW4xsgDtt+qaOnK0gpGBelQhKPcchuw=";
