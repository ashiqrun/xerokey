// File: src/lib/session.ts
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { ADMIN_COOKIE_NAME, verifyAdminToken } from "@/lib/auth";

export interface ActiveAdminSession {
  id: string;
  username: string;
  tokenVersion: number;
}

/**
 * Validates the current admin session against both token cryptography AND
 * the live database. If the admin account was deleted from the admin panel,
 * or if their password/tokenVersion was reset, their session is instantly terminated
 * and cookie cleared across all browsers/devices.
 */
export async function verifyActiveAdminSession(): Promise<ActiveAdminSession | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const decoded = await verifyAdminToken(token);
  if (!decoded || !decoded.username) {
    cookieStore.delete(ADMIN_COOKIE_NAME);
    return null;
  }

  try {
    let admin = null;
    if (decoded.adminId && /^[0-9a-fA-F]{24}$/.test(decoded.adminId)) {
      admin = await prisma.adminUser.findUnique({
        where: { id: decoded.adminId },
      });
    }

    if (!admin) {
      admin = await prisma.adminUser.findUnique({
        where: { username: decoded.username.toLowerCase() },
      });
    }

    // 1. If the admin user has been deleted from MongoDB, invalidate immediately!
    if (!admin) {
      cookieStore.delete(ADMIN_COOKIE_NAME);
      return null;
    }

    // 2. Ensure username matches
    if (admin.username.toLowerCase() !== decoded.username.toLowerCase()) {
      cookieStore.delete(ADMIN_COOKIE_NAME);
      return null;
    }

    // 3. Ensure token version matches (invalidated on password change)
    if (
      decoded.tokenVersion !== undefined &&
      admin.tokenVersion !== undefined &&
      admin.tokenVersion !== decoded.tokenVersion
    ) {
      cookieStore.delete(ADMIN_COOKIE_NAME);
      return null;
    }

    return {
      id: admin.id,
      username: admin.username,
      tokenVersion: admin.tokenVersion ?? 1,
    };
  } catch (err) {
    console.error("Session database verification error:", err);
    return null;
  }
}
