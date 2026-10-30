// File: src/app/page.tsx

import prisma from "@/lib/prisma";
import {
  PublicLandingPage,
  type PublicLockerItem,
  type PublicTelemetryStats,
} from "@/components/PublicLandingPage";

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

export default async function HomePage() {
  await ensureTwelveLockersExist();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [rawLockers, dailyUsersCount, allTimeUsersCount, systemStatus] =
    await Promise.all([
      prisma.locker.findMany({
        orderBy: { lockerNumber: "asc" },
        take: 12,
      }),
      prisma.session.count({
        where: {
          checkInTime: {
            gte: startOfToday,
          },
        },
      }),
      prisma.user.count(),
      prisma.systemStatus.findUnique({
        where: { key: "GLOBAL" },
      }),
    ]);

  const lockers: PublicLockerItem[] = rawLockers.map(
    (locker: { id: string; lockerNumber: number; isOccupied: boolean }) => ({
      id: locker.id,
      lockerNumber: locker.lockerNumber,
      isOccupied: locker.isOccupied,
    })
  );

  const availableCount = lockers.filter((l) => !l.isOccupied).length;
  const occupiedCount = lockers.filter((l) => l.isOccupied).length;

  const nowMs = Date.now();
  const lastHeartbeatIso = systemStatus?.lastHeartbeat
    ? systemStatus.lastHeartbeat.toISOString()
    : null;
  const isOnline = systemStatus?.lastHeartbeat
    ? nowMs - systemStatus.lastHeartbeat.getTime() < 30000
    : false;

  const stats: PublicTelemetryStats = {
    dailyUsers: dailyUsersCount,
    allTimeUsers: allTimeUsersCount,
    availableLockers: availableCount,
    occupiedLockers: occupiedCount,
    totalLockers: lockers.length,
    lastSyncedAt: new Date().toISOString(),
    lastHeartbeat: lastHeartbeatIso,
    isOnline,
  };

  return <PublicLandingPage lockers={lockers} stats={stats} />;
}
