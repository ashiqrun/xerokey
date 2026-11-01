// File: src/app/api/esp32/route.ts

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { checkMasterKey, GRAND_MASTER_UID } from "@/lib/masterKeys";
import { timingSafeEqualString } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface HardwareEventPayload {
  seq?: number;
  uid: string;
  action?: "checkin" | "checkout" | "master_open" | "master_all" | string;
  lockerNumber?: number;
  locker?: number;
  forcedBy?: string;
  timestamp?: number | string;
  allowCheckin?: boolean;
}

function parseEventDate(timestamp?: number | string): Date {
  if (!timestamp) return new Date();
  if (typeof timestamp === "number") {
    // If seconds (< 100 billion), convert to ms
    const ms = timestamp < 100000000000 ? timestamp * 1000 : timestamp;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * GET: Allows ESP32 to query sync status and server time without triggering transactions.
 */
export async function GET(request: NextRequest) {
  try {
    const incomingApiKey = request.headers.get("x-api-key") || "";
    const serverApiKey = process.env.ESP_API_KEY || "";

    if (!serverApiKey || serverApiKey.trim() === "" || !incomingApiKey || !timingSafeEqualString(incomingApiKey, serverApiKey)) {
      return NextResponse.json(
        { status: "error", message: "401 Unauthorized" },
        { status: 401 }
      );
    }

    const now = new Date();
    const systemStatus = await prisma.systemStatus.upsert({
      where: { key: "GLOBAL" },
      update: { lastHeartbeat: now },
      create: { key: "GLOBAL", lastHeartbeat: now, lastSyncedSeq: 0 },
    });

    return NextResponse.json({
      system: "XERO_KEY_SECURITY_MATRIX",
      status: "online",
      lastSyncedSeq: systemStatus.lastSyncedSeq ?? 0,
      serverTime: Math.floor(now.getTime() / 1000),
    });
  } catch (error) {
    console.error("ESP32 GET Status Error:", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}

/**
 * Processes a single event with strict idempotency and Master Key detection.
 */
async function processSingleEvent(
  event: HardwareEventPayload,
  currentSyncedSeq: number
): Promise<{
  processed: boolean;
  skipped: boolean;
  action: string;
  lockerNumber?: number;
  seq?: number;
  error?: string;
}> {
  const eventSeq = typeof event.seq === "number" ? event.seq : undefined;

  // 1. Idempotency Check: Skip already synced offline logs
  if (eventSeq !== undefined && eventSeq > 0 && eventSeq <= currentSyncedSeq) {
    return {
      processed: false,
      skipped: true,
      action: "skipped_duplicate",
      seq: eventSeq,
    };
  }

  const uid = (event.uid || "").trim().toUpperCase();
  const eventDate = parseEventDate(event.timestamp);
  const targetLockerNum = event.lockerNumber ?? event.locker;
  const masterInfo = checkMasterKey(uid);

  // ==========================================================================
  // CASE A: GRAND MASTER KEY (Opens all 12 lockers sequentially)
  // ==========================================================================
  if (masterInfo.isGrandMaster || event.action === "master_all") {
    // 1. Check out all currently occupied lockers
    const activeSessions = await prisma.session.findMany({
      where: { checkOutTime: null },
    });

    for (const session of activeSessions) {
      const diffMs = eventDate.getTime() - session.checkInTime.getTime();
      const duration = Math.max(1, Math.round(diffMs / 60000));

      await prisma.session.update({
        where: { id: session.id },
        data: {
          checkOutTime: eventDate,
          duration,
          forcedByAdmin: "MASTER_ALL",
          seq: eventSeq,
        },
      });

      await prisma.user.upsert({
        where: { uid: session.uid },
        update: { totalUsageTime: { increment: duration } },
        create: {
          uid: session.uid,
          totalSessions: 1,
          totalUsageTime: duration,
        },
      });
    }

    // 2. For each bay 1-12, create an override session record if no active session existed
    const occupiedBays = new Set(activeSessions.map((s) => s.lockerNumber));
    for (let bay = 1; bay <= 12; bay++) {
      if (!occupiedBays.has(bay)) {
        await prisma.session.create({
          data: {
            uid: uid || GRAND_MASTER_UID,
            lockerNumber: bay,
            checkInTime: eventDate,
            checkOutTime: eventDate,
            duration: 0,
            forcedByAdmin: "MASTER_ALL",
            seq: eventSeq,
          },
        });
      }
    }

    // 3. Mark all physical lockers as available
    await prisma.locker.updateMany({
      data: {
        isOccupied: false,
        currentUid: null,
      },
    });

    return {
      processed: true,
      skipped: false,
      action: "master_all",
      seq: eventSeq,
    };
  }

  // ==========================================================================
  // CASE B: INDIVIDUAL MASTER KEY (Opens designated bay 1-12)
  // ==========================================================================
  if (masterInfo.isMaster || event.action === "master_open") {
    const bayNum = masterInfo.lockerNumber ?? targetLockerNum ?? 1;

    const activeSession = await prisma.session.findFirst({
      where: {
        lockerNumber: bayNum,
        checkOutTime: null,
      },
      orderBy: { checkInTime: "desc" },
    });

    if (activeSession) {
      const diffMs = eventDate.getTime() - activeSession.checkInTime.getTime();
      const duration = Math.max(1, Math.round(diffMs / 60000));

      await prisma.session.update({
        where: { id: activeSession.id },
        data: {
          checkOutTime: eventDate,
          duration,
          forcedByAdmin: "MASTER_KEY",
          seq: eventSeq,
        },
      });

      await prisma.user.upsert({
        where: { uid: activeSession.uid },
        update: { totalUsageTime: { increment: duration } },
        create: {
          uid: activeSession.uid,
          totalSessions: 1,
          totalUsageTime: duration,
        },
      });
    } else {
      // Empty locker opened by individual master: record override log
      await prisma.session.create({
        data: {
          uid,
          lockerNumber: bayNum,
          checkInTime: eventDate,
          checkOutTime: eventDate,
          duration: 0,
          forcedByAdmin: "MASTER_KEY",
          seq: eventSeq,
        },
      });
    }

    // Release target locker
    await prisma.locker.updateMany({
      where: { lockerNumber: bayNum },
      data: {
        isOccupied: false,
        currentUid: null,
      },
    });

    return {
      processed: true,
      skipped: false,
      action: "master_open",
      lockerNumber: bayNum,
      seq: eventSeq,
    };
  }

  // ==========================================================================
  // CASE C: REGULAR USER CARD (Check-In or Check-Out)
  // ==========================================================================
  const [activeSession, occupiedLocker] = await Promise.all([
    prisma.session.findFirst({
      where: { uid, checkOutTime: null },
      orderBy: { checkInTime: "desc" },
    }),
    prisma.locker.findFirst({
      where: {
        OR: [
          { currentUid: uid, isOccupied: true },
          ...(targetLockerNum ? [{ lockerNumber: targetLockerNum, isOccupied: true }] : []),
        ],
      },
    }),
  ]);

  const isCheckoutAction =
    event.action === "checkout" ||
    (event.action !== "checkin" && (Boolean(activeSession) || Boolean(occupiedLocker)));

  if (isCheckoutAction) {
    // Check-out flow
    const bayNum =
      targetLockerNum ?? occupiedLocker?.lockerNumber ?? activeSession?.lockerNumber ?? 1;

    let durationInMinutes = 1;
    if (activeSession) {
      const diffMs = eventDate.getTime() - activeSession.checkInTime.getTime();
      durationInMinutes = Math.max(1, Math.round(diffMs / 60000));

      await prisma.session.update({
        where: { id: activeSession.id },
        data: {
          checkOutTime: eventDate,
          duration: durationInMinutes,
          seq: eventSeq,
        },
      });
    }

    await prisma.locker.updateMany({
      where: {
        OR: [{ currentUid: uid }, { lockerNumber: bayNum }],
      },
      data: {
        isOccupied: false,
        currentUid: null,
      },
    });

    await prisma.user.upsert({
      where: { uid },
      update: { totalUsageTime: { increment: durationInMinutes } },
      create: {
        uid,
        totalSessions: 1,
        totalUsageTime: durationInMinutes,
      },
    });

    return {
      processed: true,
      skipped: false,
      action: "checkout",
      lockerNumber: bayNum,
      seq: eventSeq,
    };
  }

  // Check-in flow
  let targetLocker = null;
  if (targetLockerNum) {
    targetLocker = await prisma.locker.findUnique({
      where: { lockerNumber: targetLockerNum },
    });
  }

  if (!targetLocker || targetLocker.isOccupied) {
    targetLocker = await prisma.locker.findFirst({
      where: { isOccupied: false },
      orderBy: { lockerNumber: "asc" },
    });
  }

  if (!targetLocker) {
    return {
      processed: false,
      skipped: false,
      action: "none",
      error: "ALL_LOCKERS_OCCUPIED",
      seq: eventSeq,
    };
  }

  await prisma.locker.update({
    where: { id: targetLocker.id },
    data: {
      isOccupied: true,
      currentUid: uid,
    },
  });

  await prisma.session.create({
    data: {
      uid,
      lockerNumber: targetLocker.lockerNumber,
      checkInTime: eventDate,
      checkOutTime: null,
      duration: null,
      seq: eventSeq,
    },
  });

  await prisma.user.upsert({
    where: { uid },
    update: { totalSessions: { increment: 1 } },
    create: {
      uid,
      totalSessions: 1,
      totalUsageTime: 0,
    },
  });

  return {
    processed: true,
    skipped: false,
    action: "checkin",
    lockerNumber: targetLocker.lockerNumber,
    seq: eventSeq,
  };
}

/**
 * POST: Handles both real-time individual events and batch offline log synchronization.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Strict API Key Verification with Constant-Time Protection
    const incomingApiKey = request.headers.get("x-api-key") || "";
    const serverApiKey = process.env.ESP_API_KEY || "";

    if (!serverApiKey || serverApiKey.trim() === "") {
      return NextResponse.json(
        {
          system: "XERO_KEY_SECURITY_MATRIX",
          status: "error",
          message: "Server security configuration error: Missing API Key setup.",
        },
        { status: 500 }
      );
    }

    if (!incomingApiKey || !timingSafeEqualString(incomingApiKey, serverApiKey)) {
      return NextResponse.json(
        {
          system: "XERO_KEY_SECURITY_MATRIX",
          status: "error",
          message: "401 Unauthorized: Invalid or missing x-api-key header.",
        },
        { status: 401 }
      );
    }

    // 2. Parse Body
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { status: "error", message: "Malformed JSON payload." },
        { status: 400 }
      );
    }

    const now = new Date();

    // 3. Fetch System Sync Status
    const systemStatus = await prisma.systemStatus.upsert({
      where: { key: "GLOBAL" },
      update: { lastHeartbeat: now },
      create: { key: "GLOBAL", lastHeartbeat: now, lastSyncedSeq: 0 },
    });

    const currentSyncedSeq = systemStatus.lastSyncedSeq ?? 0;
    let maxProcessedSeq = currentSyncedSeq;

    // ========================================================================
    // BATCH SYNC FLOW (When ESP32 flushes offline queue)
    // ========================================================================
    if (Array.isArray(body.events)) {
      const rawEvents: HardwareEventPayload[] = body.events;
      // Sort by sequence number ascending to preserve causal ordering
      const sortedEvents = rawEvents.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

      let processedCount = 0;
      let skippedCount = 0;

      for (const ev of sortedEvents) {
        if (!ev.uid) continue;
        const result = await processSingleEvent(ev, currentSyncedSeq);
        if (result.processed) {
          processedCount++;
          if (typeof ev.seq === "number" && ev.seq > maxProcessedSeq) {
            maxProcessedSeq = ev.seq;
          }
        } else if (result.skipped) {
          skippedCount++;
        }
      }

      // Update highest verified sequence in MongoDB
      if (maxProcessedSeq > currentSyncedSeq) {
        await prisma.systemStatus.update({
          where: { key: "GLOBAL" },
          data: { lastSyncedSeq: maxProcessedSeq, lastHeartbeat: now },
        });
      }

      revalidatePath("/");
      revalidatePath("/admin");

      return NextResponse.json({
        system: "XERO_KEY_SECURITY_MATRIX",
        status: "success",
        syncType: "batch",
        processedCount,
        skippedCount,
        lastSyncedSeq: maxProcessedSeq,
      });
    }

    // ========================================================================
    // SINGLE EVENT FLOW (Real-time card tap)
    // ========================================================================
    if (typeof body.uid !== "string" || body.uid.trim() === "") {
      return NextResponse.json(
        {
          system: "XERO_KEY_SECURITY_MATRIX",
          status: "error",
          message: "Invalid or missing NFC 'uid' in request payload.",
        },
        { status: 400 }
      );
    }

    const singleEvent: HardwareEventPayload = body;
    const result = await processSingleEvent(singleEvent, currentSyncedSeq);

    if (
      result.processed &&
      typeof singleEvent.seq === "number" &&
      singleEvent.seq > maxProcessedSeq
    ) {
      maxProcessedSeq = singleEvent.seq;
      await prisma.systemStatus.update({
        where: { key: "GLOBAL" },
        data: { lastSyncedSeq: maxProcessedSeq, lastHeartbeat: now },
      });
    }

    revalidatePath("/");
    revalidatePath("/admin");

    return NextResponse.json({
      system: "XERO_KEY_SECURITY_MATRIX",
      status: "success",
      action: result.action,
      lockerNumber: result.lockerNumber,
      lastSyncedSeq: maxProcessedSeq,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("Xero Key ESP32 Route Error:", error);
    return NextResponse.json(
      {
        system: "XERO_KEY_SECURITY_MATRIX",
        status: "error",
        message: "Internal server error processing Xero Key telemetry.",
      },
      { status: 500 }
    );
  }
}
