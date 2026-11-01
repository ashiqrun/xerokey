// File: src/app/actions.ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  hashPassword,
  signAdminToken,
} from "@/lib/auth";
import { verifyActiveAdminSession } from "@/lib/session";
import {
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
} from "@/lib/rateLimit";

/**
 * Ensures the master root admin ("admin" / "xerokey123") exists in MongoDB.
 */
export async function ensureDefaultAdminExists() {
  const rootAdmin = await prisma.adminUser.findUnique({
    where: { username: "admin" },
  });

  if (!rootAdmin) {
    const defaultHash = await hashPassword("xerokey123");
    await prisma.adminUser.create({
      data: {
        username: "admin",
        passwordHash: defaultHash,
        tokenVersion: 1,
      },
    });
  }
}

/**
 * 1. Authenticate Admin with Rate-Limiting Protection & 24-Hour Session Cookie
 */
export async function loginAdminAction(
  usernameInput: string,
  passwordInput: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureDefaultAdminExists();

    const username = (usernameInput || "").trim().toLowerCase();
    const password = (passwordInput || "").trim();

    if (!username || !password) {
      return {
        success: false,
        error: "USERNAME AND PASSKEY ARE REQUIRED",
      };
    }

    // Brute-force rate limiting: 5 failed attempts per username locks out for 15 minutes
    const rateLimitStatus = checkLoginRateLimit(username);
    if (rateLimitStatus.isLimited) {
      const remainingMinutes = Math.ceil(rateLimitStatus.remainingMs / 60000);
      return {
        success: false,
        error: `SYSTEM LOCKED // TOO MANY FAILED ATTEMPTS. TRY AGAIN IN ${remainingMinutes} MINUTE(S).`,
      };
    }

    const passwordHash = await hashPassword(password);

    const admin = await prisma.adminUser.findUnique({
      where: { username },
    });

    if (!admin || admin.passwordHash !== passwordHash) {
      const failedResult = recordFailedLogin(username);
      const remainingMsg =
        failedResult.attemptsLeft > 0
          ? ` (${failedResult.attemptsLeft} ATTEMPTS REMAINING)`
          : " (SYSTEM LOCKED FOR 15 MINUTES)";

      return {
        success: false,
        error: `INVALID CREDENTIALS // ACCESS DENIED${remainingMsg}`,
      };
    }

    // Successful login: reset failed login counter
    resetLoginRateLimit(username);

    // Sign a 24-hour token with adminId, username, and tokenVersion
    const token = await signAdminToken({
      id: admin.id,
      username: admin.username,
      tokenVersion: admin.tokenVersion ?? 1,
    });

    // 24 Hour Login Session (Strict 86400 seconds)
    cookies().set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_DURATION_SECONDS, // Exactly 24 Hours
    });

    return { success: true };
  } catch (error) {
    console.error("Xero Key Login Error:", error);
    return {
      success: false,
      error: "XERO KEY AUTHENTICATION GATEWAY ERROR",
    };
  }
}

/**
 * 2. Logout Admin
 */
export async function logoutAdminAction(): Promise<void> {
  cookies().delete(ADMIN_COOKIE_NAME);
}

/**
 * 3. Register a New Admin Account
 */
export async function registerAdminAction(
  newUsernameInput: string,
  newPasswordInput: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // Database-backed verification: ensures current admin wasn't deleted
    const currentAdmin = await verifyActiveAdminSession();
    if (!currentAdmin) {
      return {
        success: false,
        error: "UNAUTHORIZED // SESSION EXPIRED OR OPERATOR CLEARANCE REVOKED",
      };
    }

    const username = (newUsernameInput || "").trim().toLowerCase();
    const password = (newPasswordInput || "").trim();

    // Input sanitization & validation
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
      return {
        success: false,
        error: "OPERATOR USERNAME MUST BE 3-30 ALPHANUMERIC CHARACTERS",
      };
    }

    if (password.length < 6 || password.length > 128) {
      return {
        success: false,
        error: "SECURITY PASSKEY MUST BE BETWEEN 6 AND 128 CHARACTERS",
      };
    }

    const existing = await prisma.adminUser.findUnique({
      where: { username },
    });

    if (existing) {
      return {
        success: false,
        error: `OPERATOR "${username.toUpperCase()}" ALREADY EXISTS IN XERO KEY MATRIX`,
      };
    }

    const passwordHash = await hashPassword(password);
    await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        tokenVersion: 1,
      },
    });

    revalidatePath("/admin");
    return {
      success: true,
      message: `OPERATOR "${username.toUpperCase()}" PROVISIONED IN XERO KEY SECURITY MATRIX.`,
    };
  } catch (error) {
    console.error("Register Admin Error:", error);
    return {
      success: false,
      error: "FAILED TO PROVISION NEW OPERATOR",
    };
  }
}

/**
 * 4. Delete/Remove an Admin Account
 * When an admin is deleted here, their live session is immediately revoked everywhere.
 */
export async function deleteAdminAction(adminId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const currentAdmin = await verifyActiveAdminSession();
    if (!currentAdmin) {
      return {
        success: false,
        error: "UNAUTHORIZED // SESSION EXPIRED OR OPERATOR CLEARANCE REVOKED",
      };
    }

    // Validate MongoDB ObjectId format
    if (!adminId || !/^[0-9a-fA-F]{24}$/.test(adminId)) {
      return {
        success: false,
        error: "INVALID OPERATOR ID FORMAT",
      };
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: adminId },
    });

    if (!targetAdmin) {
      return {
        success: false,
        error: "TARGET OPERATOR NOT FOUND IN XERO KEY DATABASE",
      };
    }

    // Protect master root "admin"
    if (targetAdmin.username.toLowerCase() === "admin") {
      return {
        success: false,
        error: "PROTECTION FAULT // MASTER ROOT OPERATOR 'ADMIN' CANNOT BE DELETED",
      };
    }

    // Prevent operator from self-deleting active account while in session
    if (targetAdmin.id === currentAdmin.id) {
      return {
        success: false,
        error: "PROTECTION FAULT // YOU CANNOT DELETE YOUR CURRENTLY SIGNED-IN ACCOUNT",
      };
    }

    // Delete target admin from MongoDB
    await prisma.adminUser.delete({
      where: { id: adminId },
    });

    revalidatePath("/admin");
    return {
      success: true,
      message: `OPERATOR "${targetAdmin.username.toUpperCase()}" REVOKED FROM XERO KEY SECURITY MATRIX (ALL SESSIONS TERMINATED).`,
    };
  } catch (error) {
    console.error("Delete Admin Error:", error);
    return {
      success: false,
      error: "FAILED TO REVOKE OPERATOR CLEARANCE",
    };
  }
}

/**
 * 5. Change Password for an Admin Account
 * Increments tokenVersion so previous sessions are terminated across all other devices.
 */
export async function changeAdminPasswordAction(
  adminId: string,
  newPasswordInput: string
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const currentAdmin = await verifyActiveAdminSession();
    if (!currentAdmin) {
      return {
        success: false,
        error: "UNAUTHORIZED // SESSION EXPIRED OR OPERATOR CLEARANCE REVOKED",
      };
    }

    if (!adminId || !/^[0-9a-fA-F]{24}$/.test(adminId)) {
      return {
        success: false,
        error: "INVALID OPERATOR ID FORMAT",
      };
    }

    const newPassword = (newPasswordInput || "").trim();
    if (newPassword.length < 6 || newPassword.length > 128) {
      return {
        success: false,
        error: "NEW SECURITY PASSKEY MUST BE BETWEEN 6 AND 128 CHARACTERS",
      };
    }

    const targetAdmin = await prisma.adminUser.findUnique({
      where: { id: adminId },
    });

    if (!targetAdmin) {
      return {
        success: false,
        error: "TARGET OPERATOR NOT FOUND",
      };
    }

    const passwordHash = await hashPassword(newPassword);
    const updatedAdmin = await prisma.adminUser.update({
      where: { id: adminId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 }, // Invalidates previous sessions on other devices
      },
    });

    // If current logged-in admin changed their own password, refresh their local cookie
    if (targetAdmin.id === currentAdmin.id) {
      const refreshedToken = await signAdminToken({
        id: updatedAdmin.id,
        username: updatedAdmin.username,
        tokenVersion: updatedAdmin.tokenVersion,
      });

      cookies().set(ADMIN_COOKIE_NAME, refreshedToken, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_DURATION_SECONDS,
      });
    }

    revalidatePath("/admin");
    return {
      success: true,
      message: `SECURITY PASSKEY UPDATED FOR OPERATOR "${targetAdmin.username.toUpperCase()}".`,
    };
  } catch (error) {
    console.error("Change Admin Password Error:", error);
    return {
      success: false,
      error: "FAILED TO UPDATE OPERATOR PASSKEY",
    };
  }
}

/**
 * 6. Purge Session Logs Only (Preserves Permanent User Collection & All-Time User Count)
 */
export async function clearAllLogs(): Promise<{
  success: boolean;
  deletedCount?: number;
  error?: string;
}> {
  try {
    const currentAdmin = await verifyActiveAdminSession();
    if (!currentAdmin) {
      return {
        success: false,
        error: "UNAUTHORIZED // SESSION EXPIRED OR OPERATOR CLEARANCE REVOKED",
      };
    }

    // Delete only Session records and reset active Lockers; User model remains untouched
    const [deletedSessions] = await Promise.all([
      prisma.session.deleteMany({}),
      prisma.locker.updateMany({
        data: {
          isOccupied: false,
          currentUid: null,
        },
      }),
    ]);

    revalidatePath("/admin");
    revalidatePath("/");

    return {
      success: true,
      deletedCount: deletedSessions.count,
    };
  } catch (error) {
    console.error("Failed to purge session logs:", error);
    return {
      success: false,
      error: "XERO KEY DATABASE PURGE FAILED",
    };
  }
}
