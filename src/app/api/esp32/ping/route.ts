// File: src/app/api/esp32/ping/route.ts

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { timingSafeEqualString } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Content-Type": "application/json",
};

async function handleHeartbeat(request: NextRequest) {
  try {
    const incomingApiKey = request.headers.get("x-api-key") || "";
    const serverApiKey = process.env.ESP_API_KEY || "";

    if (!serverApiKey || serverApiKey.trim() === "") {
      return NextResponse.json(
        {
          system: "XERO_KEY_SECURITY_MATRIX",
          status: "error",
          message: "Server missing ESP_API_KEY configuration.",
        },
        { status: 500, headers: NO_CACHE_HEADERS }
      );
    }

    if (!incomingApiKey || !timingSafeEqualString(incomingApiKey, serverApiKey)) {
      return NextResponse.json(
        {
          system: "XERO_KEY_SECURITY_MATRIX",
          status: "error",
          message: "401 Unauthorized: Invalid or missing x-api-key header.",
        },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    const now = new Date();

    const statusRecord = await prisma.systemStatus.upsert({
      where: { key: "GLOBAL" },
      update: { lastHeartbeat: now },
      create: { key: "GLOBAL", lastHeartbeat: now, lastSyncedSeq: 0 },
      select: { lastSyncedSeq: true },
    });

    return NextResponse.json(
      {
        system: "XERO_KEY_SECURITY_MATRIX",
        status: "online",
        lastHeartbeat: now.toISOString(),
        lastSyncedSeq: statusRecord.lastSyncedSeq ?? 0,
        serverTime: Math.floor(now.getTime() / 1000),
      },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    console.error("ESP32 Heartbeat Ping Error:", error);
    return NextResponse.json(
      {
        system: "XERO_KEY_SECURITY_MATRIX",
        status: "error",
        message: "Failed to record ESP32 heartbeat.",
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleHeartbeat(request);
}

export async function POST(request: NextRequest) {
  return handleHeartbeat(request);
}
