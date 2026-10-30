// File: src/app/actions.ts
"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE_NAME,
  hashPassword,
  signAdminToken,
  verifyAdminToken,
} from "@/lib/auth";

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
      },
    });
  }
}

/**
 * 1. Authenticate Admin & Set HTTP-Only Session Cookie
 */
export async function loginAdminAction(
  usernameInput: string,
  passwordInput: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await ensureDefaultAdminExists();

    const username = usernameInput.trim().toLowerCase();
    const passwordHash = await hashPassword(passwordInput);

    const admin = await prisma.adminUser.findUnique({
      where: { username },
    });

    if (!admin || admin.passwordHash !== passwordHash) {
      return {
        success: false,
        error: "INVALID CREDENTIALS // ACCESS DENIED BY XERO KEY SECURITY MATRIX",
      };
    }

    const token = await signAdminToken(admin.username);

    cookies().set(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
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
    const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
    const verified = await verifyAdminToken(token);
    if (!verified) {
      return {
        success: false,
        error: "UNAUTHORIZED // XERO KEY SESSION EXPIRED",
      };
    }

    const username = newUsernameInput.trim().toLowerCase();
    if (username.length < 3) {
      return {
        success: false,
        error: "OPERATOR USERNAME MUST BE AT LEAST 3 CHARACTERS",
      };
    }

    if (newPasswordInput.length < 6) {
      return {
        success: false,
        error: "SECURITY PASSKEY MUST BE AT LEAST 6 CHARACTERS",
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

    const passwordHash = await hashPassword(newPasswordInput);
    await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
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
 * 4. Delete/Remove an Admin Account (Protects master root "admin")
 */
export async function deleteAdminAction(adminId: string): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
    const verified = await verifyAdminToken(token);
    if (!verified) {
      return {
        success: false,
        error: "UNAUTHORIZED // XERO KEY SESSION EXPIRED",
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

    if (targetAdmin.username.toLowerCase() === "admin") {
      return {
        success: false,
        error: "PROTECTION FAULT // MASTER ROOT OPERATOR 'ADMIN' CANNOT BE DELETED",
      };
    }

    await prisma.adminUser.delete({
      where: { id: adminId },
    });

    revalidatePath("/admin");
    return {
      success: true,
      message: `OPERATOR "${targetAdmin.username.toUpperCase()}" REVOKED FROM XERO KEY SECURITY MATRIX.`,
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
    const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
    const verified = await verifyAdminToken(token);
    if (!verified) {
      return {
        success: false,
        error: "UNAUTHORIZED // XERO KEY SESSION EXPIRED",
      };
    }

    if (!newPasswordInput || newPasswordInput.length < 6) {
      return {
        success: false,
        error: "NEW SECURITY PASSKEY MUST BE AT LEAST 6 CHARACTERS",
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

    const passwordHash = await hashPassword(newPasswordInput);
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash },
    });

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
    const token = cookies().get(ADMIN_COOKIE_NAME)?.value;
    const verified = await verifyAdminToken(token);
    if (!verified) {
      return { success: false, error: "UNAUTHORIZED" };
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