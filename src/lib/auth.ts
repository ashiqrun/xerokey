// File: src/lib/auth.ts

const SECRET_KEY =
  process.env.XERO_KEY_SECRET || "xero-key-iot-super-secret-signing-key-2026";

export const ADMIN_COOKIE_NAME = "xero_key_admin_session";

// Strict 24 Hour Login Session
export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
export const SESSION_DURATION_SECONDS = 24 * 60 * 60; // 86400 seconds

export interface AdminTokenPayload {
  adminId?: string;
  username: string;
  tokenVersion?: number;
  exp: number;
}

/**
 * Converts an ArrayBuffer to a hexadecimal string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Works seamlessly across both Edge and Node.js runtimes.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Hashes a plain-text password using SHA-256 + secret salt.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${password}::${SECRET_KEY}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hashBuffer);
}

/**
 * Creates a signed HMAC-SHA256 token containing admin identifier, username, tokenVersion,
 * and a strict 24-hour expiration timestamp.
 */
export async function signAdminToken(admin: {
  id?: string;
  username: string;
  tokenVersion?: number;
}): Promise<string> {
  const payload: AdminTokenPayload = {
    adminId: admin.id,
    username: admin.username.trim().toLowerCase(),
    tokenVersion: admin.tokenVersion ?? 1,
    exp: Date.now() + SESSION_DURATION_MS, // Strict 24 hours
  };

  const payloadBase64 = btoa(JSON.stringify(payload));
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadBase64)
  );
  const signatureHex = bufferToHex(signatureBuffer);

  return `${payloadBase64}.${signatureHex}`;
}

/**
 * Verifies the HMAC-SHA256 token in Edge Middleware or Server Components.
 * Returns the decoded AdminTokenPayload if valid, or null if tampered/expired.
 */
export async function verifyAdminToken(
  token: string | undefined
): Promise<AdminTokenPayload | null> {
  if (!token || !token.includes(".")) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadBase64, signatureHex] = parts;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const expectedSigBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payloadBase64)
    );
    const expectedSigHex = bufferToHex(expectedSigBuffer);

    // Constant-time signature verification prevents timing attacks
    if (!timingSafeEqualString(signatureHex, expectedSigHex)) {
      return null;
    }

    const decoded = JSON.parse(atob(payloadBase64)) as AdminTokenPayload;
    if (!decoded.username || !decoded.exp || Date.now() > decoded.exp) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}
