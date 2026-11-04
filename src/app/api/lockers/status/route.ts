// File: src/app/api/lockers/status/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [rawLockers, dailyUsersCount, allTimeUsersCount, systemStatus] =
      await Promise.all([
        prisma.locker.findMany({
          orderBy: { lockerNumber: "asc" },
          take: 12,
          select: { id: true, lockerNumber: true, isOccupied: true },
        }),
        prisma.session.count({
          where: { checkInTime: { gte: startOfToday } },
        }),
        prisma.user.count(),
        prisma.systemStatus.findUnique({
          where: { key: "GLOBAL" },
          select: { lastHeartbeat: true },
        }),
      ]);

    const availableCount = rawLockers.filter((l) => !l.isOccupied).length;
    const occupiedCount = rawLockers.length - availableCount;
    const nowMs = Date.now();
    const isOnline = systemStatus?.lastHeartbeat
      ? nowMs - systemStatus.lastHeartbeat.getTime() < 30000
      : false;

    return NextResponse.json(
      {
        lockers: rawLockers,
        stats: {
          dailyUsers: dailyUsersCount,
          allTimeUsers: allTimeUsersCount,
          availableLockers: availableCount,
          occupiedLockers: occupiedCount,
          totalLockers: rawLockers.length,
          lastHeartbeat: systemStatus?.lastHeartbeat?.toISOString() ?? null,
          isOnline,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Locker status API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch locker status" },
      { status: 500 }
    );
  }
}
