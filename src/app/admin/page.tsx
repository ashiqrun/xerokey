// File: src/app/admin/page.tsx

import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { verifyActiveAdminSession } from "@/lib/session";
import { ensureDefaultAdminExists } from "@/app/actions";
import AdminDashboard, {
  type LockerItem,
  type SessionLogItem,
  type AdminUserItem,
  type DashboardStats,
} from "@/components/AdminDashboard";
import { getAllMasterKeysRegistry } from "@/lib/masterKeys";

export const dynamic = "force-dynamic";

async function ensureTwelveLockersExist() {
  const existingLockers = await prisma.locker.findMany({
    select: { lockerNumber: true },
  });

  const existingNumbers = new Set(
    existingLockers.map((l: { lockerNumber: number }) => l.lockerNumber)
  );
  const missingLockers = [];

  for (let i = 1; i <= 12; i++) {
    if (!existingNumbers.has(i)) {
      missingLockers.push({
        lockerNumber: i,
        isOccupied: false,
        currentUid: null,
      });
    }
  }

  if (missingLockers.length > 0) {
    await prisma.locker.createMany({
      data: missingLockers,
    });
  }
}

let isAdminBootstrapDone = false;
async function ensureAdminBootstrapOnce() {
  if (isAdminBootstrapDone) return;
  try {
    await Promise.all([ensureTwelveLockersExist(), ensureDefaultAdminExists()]);
    isAdminBootstrapDone = true;
  } catch (err) {
    console.error("Admin bootstrap error:", err);
  }
}

export default async function AdminPage() {
  // 1. Strict Active Session Verification: Checks database to ensure this admin has not been deleted
  const session = await verifyActiveAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  await ensureAdminBootstrapOnce();

  const currentAdminUsername: string = session.username.toUpperCase();

  const [totalUsers, rawLockers, rawSessions, rawAdmins, systemStatus] =
    await Promise.all([
      prisma.user.count(),
      prisma.locker.findMany({
        orderBy: { lockerNumber: "asc" },
        take: 12,
      }),
      prisma.session.findMany({
        orderBy: { checkInTime: "desc" },
      }),
      prisma.adminUser.findMany({
        orderBy: { createdAt: "asc" },
      }),
      prisma.systemStatus.findUnique({
        where: { key: "GLOBAL" },
      }),
    ]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const occupiedLockersCount = rawLockers.filter(
    (l: { isOccupied: boolean }) => l.isOccupied
  ).length;

  const todaysSessionsCount = rawSessions.filter(
    (s: { checkInTime: Date }) => s.checkInTime >= startOfToday
  ).length;

  const nowMs = Date.now();
  const lastHeartbeatIso = systemStatus?.lastHeartbeat
    ? systemStatus.lastHeartbeat.toISOString()
    : null;
  const isOnline = systemStatus?.lastHeartbeat
    ? nowMs - systemStatus.lastHeartbeat.getTime() < 30000
    : false;

  const stats: DashboardStats = {
    totalUsers,
    occupiedLockersCount,
    totalLockers: rawLockers.length,
    todaysSessionsCount,
    lastHeartbeat: lastHeartbeatIso,
    isOnline,
    lastSyncedSeq: systemStatus?.lastSyncedSeq ?? 0,
  };

  const lockers: LockerItem[] = rawLockers.map(
    (locker: {
      id: string;
      lockerNumber: number;
      isOccupied: boolean;
      currentUid: string | null;
    }) => ({
      id: locker.id,
      lockerNumber: locker.lockerNumber,
      isOccupied: locker.isOccupied,
      currentUid: locker.currentUid,
    })
  );

  const sessions: SessionLogItem[] = rawSessions.map(
    (session: {
      id: string;
      uid: string;
      lockerNumber: number;
      checkInTime: Date;
      checkOutTime: Date | null;
      duration: number | null;
      forcedByAdmin?: string | null;
    }) => ({
      id: session.id,
      uid: session.uid,
      lockerNumber: session.lockerNumber,
      checkInTime: session.checkInTime.toISOString(),
      checkOutTime: session.checkOutTime
        ? session.checkOutTime.toISOString()
        : null,
      duration: session.duration,
      forcedByAdmin: session.forcedByAdmin ?? null,
    })
  );

  const admins: AdminUserItem[] = rawAdmins.map(
    (admin: { id: string; username: string; createdAt: Date }) => ({
      id: admin.id,
      username: admin.username,
      createdAt: admin.createdAt.toISOString(),
    })
  );

  return (
    <AdminDashboard
      currentAdmin={currentAdminUsername}
      stats={stats}
      lockers={lockers}
      sessions={sessions}
      admins={admins}
      masterKeys={getAllMasterKeysRegistry()}
    />
  );
}