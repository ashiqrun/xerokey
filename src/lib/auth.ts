// File: src/lib/auth.ts

const SECRET_KEY =
  process.env.XERO_KEY_SECRET || "xero-key-iot-super-secret-signing-key-2026";

export const ADMIN_COOKIE_NAME = "xero_key_admin_session";

/**
 * Converts an ArrayBuffer to a hexadecimal string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
 * Creates a signed HMAC-SHA256 token containing the admin username and expiration.
 */
export async function signAdminToken(username: string): Promise<string> {
  const payload = {
    username,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days expiration
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
 * Returns the decoded { username } if valid, or null if tampered/expired.
 */
export async function verifyAdminToken(
  token: string | undefined
): Promise<{ username: string } | null> {
  if (!token || !token.includes(".")) return null;

  try {
    const [payloadBase64, signatureHex] = token.split(".");
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

    if (signatureHex !== expectedSigHex) {
      return null;
    }

    const decoded = JSON.parse(atob(payloadBase64));
    if (!decoded.username || Date.now() > decoded.exp) {
      return null;
    }

    return { username: decoded.username };
  } catch {
    return null;
  }
}