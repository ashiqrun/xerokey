"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface PublicLockerItem {
  id: string;
  lockerNumber: number;
  isOccupied: boolean;
}

export interface PublicTelemetryStats {
  dailyUsers: number;
  allTimeUsers: number;
  availableLockers: number;
  occupiedLockers: number;
  totalLockers: number;
  lastSyncedAt: string;
  lastHeartbeat: string | null;
  isOnline: boolean;
}

interface PublicLandingPageProps {
  lockers: PublicLockerItem[];
  stats: PublicTelemetryStats;
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

export function PublicLandingPage({
  lockers = [],
  stats,
}: PublicLandingPageProps) {
  const router = useRouter();
  const mounted = useMounted();

  const [selectedLocker, setSelectedLocker] = useState<PublicLockerItem | null>(
    lockers[0] || null
  );

  // Real-time auto-polling every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    if (selectedLocker && lockers.length > 0) {
      const updated = lockers.find(
        (l) => l.lockerNumber === selectedLocker.lockerNumber
      );
      if (updated) setSelectedLocker(updated);
    } else if (!selectedLocker && lockers.length > 0) {
      setSelectedLocker(lockers[0]);
    }
  }, [lockers, selectedLocker]);

  // Evaluate < 30,000ms (30 seconds) heartbeat window
  const isHardwareOnline = mounted
    ? stats.lastHeartbeat
      ? new Date().getTime() - new Date(stats.lastHeartbeat).getTime() < 30000
      : false
    : stats.isOnline;

  const formatDigitalCounter = (value: number, digits = 4) => {
    return String(value ?? 0).padStart(digits, "0");
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200 overflow-x-hidden">
      {/* Ambient Background Glow & Grid */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[90vw] max-w-4xl h-96 bg-emerald-500/10 blur-[140px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] max-w-3xl h-80 bg-zinc-900/40 blur-[120px] rounded-full" />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #27272a 1px, transparent 1px), linear-gradient(to bottom, #27272a 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      {/* Top Navigation Bar with Real-Time ESP32 Heartbeat Indicator */}
      <header className="relative z-20 border-b border-zinc-900/80 bg-black/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isHardwareOnline ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_10px_#10b981]" />
                </span>
                <span className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-emerald-400">
                  XERO KEY IS ONLINE
                </span>
              </>
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_10px_#f43f5e]" />
                </span>
                <span className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-rose-500">
                  XERO KEY IS OFFLINE
                </span>
              </>
            )}
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 text-center pointer-events-none">
              <span className="text-sm sm:text-base font-mono font-bold tracking-[0.45em] text-white pl-[0.45em]">
              XERO KEY
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/admin"
              className="px-3.5 py-1.5 text-[10px] font-mono uppercase tracking-widest border border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:bg-white hover:text-black transition-all"
            >
              SECURITY TERMINAL
            </Link>
          </div>
        </div>
      </header>

      {/* 1. Hero Section & Digital Telemetry Counters */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-zinc-800 bg-zinc-950/80 mb-6">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isHardwareOnline
                ? "bg-emerald-500 shadow-[0_0_8px_#10b981]"
                : "bg-rose-500 shadow-[0_0_8px_#f43f5e]"
            }`}
          />
          <span className="text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-zinc-400">
            XERO KEY SECURITY // AUTONOMOUS NFC LOCKER
          </span>
        </div>

        <h1 className="text-4xl sm:text-6xl md:text-7xl font-light tracking-[0.22em] text-white uppercase pl-[0.22em]">
          XERO KEY
        </h1>

        <p className="mt-4 max-w-xl mx-auto text-xs sm:text-sm font-mono text-zinc-400 tracking-wider leading-relaxed">
          JUST TAP YOUR UNIVERSITY ID TO GET A LOCKER.
        </p>

        {/* Live Digital Counter Readouts */}
        <div className="mt-10 max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Daily Users */}
          <div className="relative group border border-zinc-800/90 bg-zinc-950/70 backdrop-blur-sm p-6 overflow-hidden transition-all hover:border-zinc-700">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
              <span>DAILY SESSIONS</span>
              <span className="text-emerald-400">24H TELEMETRY</span>
            </div>
            <div className="mt-4 flex items-baseline justify-center sm:justify-start gap-3">
              <span className="text-4xl sm:text-5xl font-mono font-light tracking-widest text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]">
                {formatDigitalCounter(stats.dailyUsers, 4)}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                CHECK-INS
              </span>
            </div>
          </div>

          {/* All-Time Users */}
          <div className="relative group border border-zinc-800/90 bg-zinc-950/70 backdrop-blur-sm p-6 overflow-hidden transition-all hover:border-zinc-700">
            <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/80 to-transparent" />
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
              <span>ALL-TIME USERS REGISTERED</span>
            </div>
            <div className="mt-4 flex items-baseline justify-center sm:justify-start gap-3">
              <span className="text-4xl sm:text-5xl font-mono font-light tracking-widest text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]">
                {formatDigitalCounter(stats.allTimeUsers, 4)}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                USERS
              </span>
            </div>
          </div>

          {/* Live Bay Availability */}
          <div className="relative group border border-zinc-800/90 bg-zinc-950/70 backdrop-blur-sm p-6 overflow-hidden transition-all hover:border-zinc-700">
            <div
              className={`absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent ${
                stats.availableLockers > 0
                  ? "via-emerald-500/80"
                  : "via-rose-500/80"
              } to-transparent`}
            />
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
              <span>OPEN CAPACITY</span>
              <span
                className={
                  stats.availableLockers > 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }
              >
                {stats.availableLockers > 0 ? "BAYS READY" : "AT CAPACITY"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline justify-center sm:justify-start gap-2">
              <span
                className={`text-4xl sm:text-5xl font-mono font-light tracking-widest ${
                  stats.availableLockers > 0
                    ? "text-emerald-400 drop-shadow-[0_0_18px_rgba(16,185,129,0.35)]"
                    : "text-rose-500 drop-shadow-[0_0_18px_rgba(244,63,94,0.35)]"
                }`}
              >
                {String(stats.availableLockers).padStart(2, "0")}
              </span>
              <span className="text-xs font-mono text-zinc-500">
                / {String(stats.totalLockers).padStart(2, "0")} AVAILABLE
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. The 3D Glowing Visual Locker Matrix */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 border-b border-zinc-900 pb-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-500">
              XERO KEY SECURITY // 12-BAY Locker
            </p>
            <h2 className="text-lg sm:text-xl font-light tracking-widest uppercase text-white mt-1">
              LIVE LOCKER Status
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-2 text-emerald-400">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
              AVAILABLE ({stats.availableLockers})
            </span>
            <span className="flex items-center gap-2 text-rose-400">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_#f43f5e]" />
              OCCUPIED ({stats.occupiedLockers})
            </span>
          </div>
        </div>

        {/* 3D Perspective Stage */}
        <div className="relative border border-zinc-800/80 bg-gradient-to-b from-zinc-950/90 via-black to-zinc-950/90 p-4 sm:p-10 md:p-14 overflow-hidden">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600 mb-6 sm:mb-10">
            <span>XERO KEY // REALTIME FEED</span>
            <span
              className={
                isHardwareOnline ? "text-emerald-400" : "text-rose-500"
              }
            >
              {isHardwareOnline ? "DB_STATUS: ONLINE" : "DB_STATUS: OFFLINE"}
            </span>
          </div>

          <div
            className="relative mx-auto max-w-5xl"
            style={{
              perspective: "1200px",
            }}
          >
            <div
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-5"
              style={{
                transform: "rotateX(14deg) scale(0.97)",
                transformStyle: "preserve-3d",
              }}
            >
              {lockers.map((locker) => {
                const formattedNum = String(locker.lockerNumber).padStart(
                  2,
                  "0"
                );
                const occupied = locker.isOccupied;
                const isSelected =
                  selectedLocker?.lockerNumber === locker.lockerNumber;

                return (
                  <button
                    key={locker.id}
                    type="button"
                    onClick={() => setSelectedLocker(locker)}
                    className={`group relative text-left p-4 sm:p-5 border transition-all duration-300 flex flex-col justify-between min-h-[135px] sm:min-h-[155px] focus:outline-none ${
                      occupied
                        ? "border-rose-500/60 bg-gradient-to-b from-rose-950/25 via-zinc-950 to-black shadow-[0_0_25px_rgba(244,63,94,0.18)] hover:shadow-[0_0_35px_rgba(244,63,94,0.35)] hover:border-rose-400"
                        : "border-emerald-500/50 bg-gradient-to-b from-emerald-950/20 via-zinc-950 to-black shadow-[0_0_25px_rgba(16,185,129,0.14)] hover:shadow-[0_0_35px_rgba(16,185,129,0.32)] hover:border-emerald-400"
                    } ${
                      isSelected
                        ? "ring-1 ring-white/80 -translate-y-1"
                        : "hover:-translate-y-1"
                    }`}
                  >
                    <div
                      className={`absolute inset-x-0 top-0 h-[2px] ${
                        occupied
                          ? "bg-rose-500 shadow-[0_0_12px_#f43f5e]"
                          : "bg-emerald-500 shadow-[0_0_12px_#10b981]"
                      }`}
                    />

                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-400">
                        LOCKER
                      </span>
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          occupied
                            ? "bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-pulse"
                            : "bg-emerald-500 shadow-[0_0_10px_#10b981]"
                        }`}
                      />
                    </div>

                    <div className="my-3 flex items-baseline justify-between">
                      <span className="text-2xl sm:text-3xl font-mono font-light tracking-wider text-white group-hover:tracking-widest transition-all">
                        L{formattedNum}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-600 uppercase">
                        XK_V2
                      </span>
                    </div>

                    <div className="pt-2.5 border-t border-zinc-800/80 flex items-center justify-between w-full">
                      <span
                        className={`text-[10px] font-mono uppercase tracking-widest font-semibold ${
                          occupied ? "text-rose-400" : "text-emerald-400"
                        }`}
                      >
                        {occupied ? "OCCUPIED" : "AVAILABLE"}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500 uppercase">
                        {occupied ? "LOCKED" : "READY"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 3D Perspective Glowing Floor Reflection Grid */}
            <div
              className="mt-6 h-20 sm:h-28 w-full pointer-events-none relative overflow-hidden"
              style={{
                transform: "rotateX(65deg) translateY(-10px) scale(1.05)",
                transformOrigin: "top center",
              }}
            >
              <div
                className="w-full h-full opacity-35"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, #10b981 1px, transparent 1px), linear-gradient(to bottom, #27272a 1px, transparent 1px)",
                  backgroundSize: "40px 24px",
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />
            </div>
          </div>

          {selectedLocker && (
            <div className="mt-4 pt-4 border-t border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-3">
                <span
                  className={`px-2 py-0.5 text-[10px] uppercase border ${
                    selectedLocker.isOccupied
                      ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                      : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  }`}
                >
                  INSPECTING: L
                  {String(selectedLocker.lockerNumber).padStart(2, "0")}
                </span>
                <span className="text-zinc-400">
                  STATE:{" "}
                  <strong className="text-white">
                    {selectedLocker.isOccupied
                      ? "SECURELY LOCKED (IN USE)"
                      : "OPEN FOR CHECK-IN"}
                  </strong>
                </span>
              </div>
              <span className="text-[11px] text-zinc-500">
                SYNC:{" "}
                {mounted && stats.lastHeartbeat
                  ? new Date(stats.lastHeartbeat).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })
                  : "NO SIGNAL"}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 3. System Architecture Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-16 border-t border-zinc-900">
        <div className="max-w-3xl">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-emerald-400">
            XERO KEY SECURITY // HARDWARE &amp; CLOUD ARCHITECTURE
          </p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-light tracking-wider text-white uppercase">
            XERO KEY Smart Locker System architecture with offline-first capabilities.
          </h2>
          <p className="mt-4 text-xs sm:text-sm font-mono text-zinc-400 leading-relaxed">
            Engineered for high-reliability physical access control. The Xero
            Key hardware node operates on an ESP32 microcontroller paired with
            a NFC transceiver and a 12-channel opto-isolated relay
            array. Asynchronous dual-slot state machines allow concurrent
            check-in and check-out operations with 500KB LittleFS ring-buffer
            protection and 15-second live heartbeat telemetry.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="border border-zinc-800/80 bg-zinc-950/60 p-5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              01 // EDGE NODE
            </span>
            <h3 className="mt-2 text-sm font-mono font-semibold text-white uppercase">
              7-BYTE NFC MFRC522
            </h3>
            <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
              Strict 7-byte UID hardware validation with non-blocking
              asynchronous solenoid actuation and magnetic door monitoring.
            </p>
          </div>

          <div className="border border-zinc-800/80 bg-zinc-950/60 p-5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              02 // CONCURRENCY
            </span>
            <h3 className="mt-2 text-sm font-mono font-semibold text-white uppercase">
              DUAL-SLOT ENGINE
            </h3>
            <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
              Simultaneous 1x Check-In and 1x Check-Out state tracking with
              real-time tri-color LED status arbitration.
            </p>
          </div>

          <div className="border border-zinc-800/80 bg-zinc-950/60 p-5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              03 // TELEMETRY
            </span>
            <h3 className="mt-2 text-sm font-mono font-semibold text-white uppercase">
              15S HEARTBEAT PING
            </h3>
            <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
              Authenticated hardware heartbeats verify live ESP32 connectivity
              within a strict 30-second watchdog window.
            </p>
          </div>

          <div className="border border-zinc-800/80 bg-zinc-950/60 p-5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              04 // PERSISTENCE
            </span>
            <h3 className="mt-2 text-sm font-mono font-semibold text-white uppercase">
              500KB LITTLEFS GUARD
            </h3>
            <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
              Self-pruning 500KB LittleFS offline CSV storage paired with DS3231
              RTC timestamps prevents flash overflow during outages.
            </p>
          </div>
        </div>
      </section>

      {/* 4. Footer & Creator / Mother Company Section */}
      <footer className="relative z-10 border-t border-zinc-900 bg-zinc-950/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 pb-12 border-b border-zinc-900">
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-400">
                  Powered by runcorps.tech
                </span>
              </div>
              <h3 className="text-xl font-mono font-semibold tracking-wider text-white uppercase">
                XERO KEY SECURITY
              </h3>
              <p className="text-xs font-mono text-zinc-400 leading-relaxed max-w-md">
                Next-generation autonomous physical storage and telemetry
                systems. Designed for universities, high-security research
                facilities, and modern smart campuses.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-500">
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  XK_ARCH: NEXT.JS 14
                </span>
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  DB: MONGODB ATLAS
                </span>
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  MCU: ESP32-WROOM
                </span>
              </div>
            </div>

            <div className="lg:col-span-7 border border-zinc-800/90 bg-black/70 p-6 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-zinc-900">
                  <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-emerald-400">
                    LEAD SYSTEM ARCHITECT &amp; CREATOR
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    SOFTWARE &amp; IOT ENGINEERING
                  </span>
                </div>

                <h4 className="mt-5 text-2xl sm:text-3xl font-light tracking-wide text-white">
                  Created by{" "}
                  <span className="font-medium text-emerald-400">
                    ASHIQRUN
                  </span>
                </h4>

                <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                  Software Engineering &amp; Full-Stack Developer specializing
                  in modern web architecture, embedded IoT telemetry, and
                  minimalist dark-mode interfaces.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href="https://github.com/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all"
                  >
                    GITHUB ↗
                  </a>
                  <a
                    href="https://linkedin.com/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all"
                  >
                    LINKEDIN ↗
                  </a>
                  <a
                    href="https://instagram.com/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all"
                  >
                    Instagram ↗
                  </a>
                </div>

                <a
                  href="https://ashiq.run"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-xs font-mono uppercase tracking-widest bg-white text-black font-semibold hover:bg-zinc-200 transition-all"
                >
                  CREATOR PORTFOLIO ↗
                </a>
              </div>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] font-mono text-zinc-500">
            <p>
              © {mounted ? new Date().getFullYear() : "2026"} XERO KEY SECURITY
              MATRIX // CREATED BY ASHIQUR RAHMAN. ALL RIGHTS RESERVED.
            </p>
            <p
              className={
                isHardwareOnline ? "text-emerald-400" : "text-rose-500"
              }
            >
              {isHardwareOnline ? "CURRENTLY ONLINE" : "CURRENTLY OFFLINE"}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default PublicLandingPage;