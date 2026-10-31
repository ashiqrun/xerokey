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
      {/* Ambient Background Glow & Subtle Grid */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[90vw] max-w-4xl h-80 sm:h-96 bg-emerald-500/10 blur-[130px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] max-w-3xl h-72 sm:h-80 bg-zinc-900/40 blur-[120px] rounded-full" />
        <div
          className="absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #27272a 1px, transparent 1px), linear-gradient(to bottom, #27272a 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Top Navigation Bar with Real-Time ESP32 Heartbeat Indicator (Mobile-Optimized) */}
      <header className="relative z-30 border-b border-zinc-900/90 bg-black/85 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          {/* Logo & Hardware Live Status Pill */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 group shrink-0 focus:outline-none"
              title="Xerokey Autonomous NFC Locker Matrix"
            >
              
            </Link>

            <span className="hidden xs:inline-block text-zinc-700">/</span>

            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-950/80">
              {isHardwareOnline ? (
                <>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                  </span>
                  <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-medium">
                    ONLINE
                  </span>
                </>
              ) : (
                <>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                  </span>
                  <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-rose-500 font-medium">
                    OFFLINE
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Desktop Center Brand Tag */}
          <div className="hidden md:flex items-center text-center">
            <span className="text-sm sm:text-base font-mono font-bold tracking-[0.45em] text-white pl-[0.45em]"></span>
            <span className="text-xs font-mono uppercase tracking-[0.3em] text-zinc-500">
              AUTONOMOUS NFC LOCKER SYSTEM
            </span>
          </div>

          {/* Right Action: Admin Login */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/admin"
              className="px-3 py-1.5 sm:px-4 sm:py-2 text-[10px] sm:text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:bg-white hover:text-black hover:border-white transition-all active:scale-95"
            >
              ADMIN LOGIN
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10">
        {/* 1. Hero Section & Digital Telemetry Counters */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-8 text-center">
          

          <h1 className="text-3xl sm:text-5xl md:text-7xl font-light tracking-[0.16em] sm:tracking-[0.22em] text-white uppercase break-words px-2">
            <span className="text-sm sm:text-base font-mono font-bold tracking-[0.45em] text-white pl-[0.45em]"></span>
            XEROKEY
          </h1>

          <p className="mt-4 max-w-2xl mx-auto text-xs sm:text-sm font-mono text-zinc-400 tracking-wide sm:tracking-wider leading-relaxed px-4">
              <span className="text-sm sm:text-base font-mono font-bold tracking-[0.45em] text-white pl-[0.45em]"></span>
            JUST TAP YOUR UNIVERSITY ID TO CLAIM & UNLOCK LOCKER WITHOUT ANY KEY OR PIN
          </p>

          {/* Live Digital Counter Readouts */}
          <div className="mt-8 sm:mt-12 max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
            {/* Daily Sessions */}
            <div className="relative group border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-sm p-5 sm:p-6 overflow-hidden transition-all hover:border-zinc-700 flex flex-col justify-center items-center text-center">
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/60 to-transparent" />
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
                <span>DAILY USERS <span className="text-emerald-400">24H</span></span>
                
              </div>
              <div className="mt-4 flex items-baseline justify-center sm:justify-start gap-3">
              <span className="text-4xl sm:text-5xl font-mono font-light tracking-widest text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]">
                {formatDigitalCounter(stats.dailyUsers, 4)}
              </span>
              
            </div>
            </div>

            {/* All-Time Users */}
            <div className="relative group border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-sm p-5 sm:p-6 overflow-hidden transition-all hover:border-zinc-700 flex flex-col justify-center items-center text-center">
              <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/80 to-transparent" />
              <div className="w-full flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
                <span>ALL TIME USERS REGISTERED</span>
                
              </div>
              <div className="mt-3 sm:mt-4 flex items-baseline justify-between sm:justify-start gap-3">
                <span className="text-3xl sm:text-4xl md:text-5xl font-mono font-light tracking-widest text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.15)]">
                  {formatDigitalCounter(stats.allTimeUsers, 4)}
                </span>
          
              </div>
            </div>

            {/* Live Bay Availability */}
            <div className="relative group border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-sm p-5 sm:p-6 overflow-hidden transition-all hover:border-zinc-700 flex flex-col justify-center items-center text-center">
              <div
                className={`absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent ${
                  stats.availableLockers > 0
                    ? "via-emerald-500/80"
                    : "via-rose-500/80"
                } to-transparent`}
              />
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
                <span>CURRENT CAPACITY</span>
                
              </div>
              <div className="mt-3 sm:mt-4 flex flex-col sm:flex-row items-center sm:items-baseline justify-center gap-2 sm:gap-3">
                <span
                  className={`text-3xl sm:text-4xl md:text-5xl font-mono font-light tracking-widest ${
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

        {/* 2. The 3D Glowing Visual Locker Matrix (Mobile-Responsive Tilt & Touch) */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8 border-b border-zinc-900 pb-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-500">
                XEROKEY //
              </p>
              <h2 className="text-lg sm:text-xl font-light tracking-widest uppercase text-white mt-1">
                LIVE LOCKER STATUS
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

          {/* Perspective Stage */}
          <div className="relative border border-zinc-800/80 bg-gradient-to-b from-zinc-950/90 via-black to-zinc-950/90 p-3 sm:p-8 md:p-12 overflow-hidden">
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600 mb-4 sm:mb-8">
              <span>XEROKEY // REALTIME FEED</span>
              <span
                className={
                  isHardwareOnline ? "text-emerald-400" : "text-rose-500"
                }
              >
                {isHardwareOnline ? "LOCKER IS ONLINE" : "LOCKER IS OFFLINE"}
              </span>
            </div>

            <div
              className="relative mx-auto max-w-5xl"
              style={{
                perspective: "1200px",
              }}
            >
              <div
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-5"
                style={{
                  transform:
                    typeof window !== "undefined" && window.innerWidth < 640
                      ? "rotateX(2deg) scale(0.99)"
                      : "rotateX(12deg) scale(0.97)",
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
                      className={`group relative text-left p-3.5 sm:p-5 border transition-all duration-200 flex flex-col justify-between min-h-[125px] sm:min-h-[155px] focus:outline-none touch-manipulation active:scale-[0.98] ${
                        occupied
                          ? "border-rose-500/60 bg-gradient-to-b from-rose-950/25 via-zinc-950 to-black shadow-[0_0_20px_rgba(244,63,94,0.18)] hover:shadow-[0_0_30px_rgba(244,63,94,0.35)] hover:border-rose-400"
                          : "border-emerald-500/50 bg-gradient-to-b from-emerald-950/20 via-zinc-950 to-black shadow-[0_0_20px_rgba(16,185,129,0.14)] hover:shadow-[0_0_30px_rgba(16,185,129,0.32)] hover:border-emerald-400"
                      } ${
                        isSelected
                          ? "ring-2 ring-white/90 -translate-y-1"
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
                          className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full ${
                            occupied
                              ? "bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-pulse"
                              : "bg-emerald-500 shadow-[0_0_10px_#10b981]"
                          }`}
                        />
                      </div>

                      <div className="my-2 sm:my-3 flex items-baseline justify-between">
                        <span className="text-xl sm:text-2xl md:text-3xl font-mono font-light tracking-wider text-white group-hover:tracking-widest transition-all">
                          L{formattedNum}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-mono text-zinc-600 uppercase">
                          XK_V2
                        </span>
                      </div>

                      <div className="pt-2 sm:pt-2.5 border-t border-zinc-800/80 flex items-center justify-between w-full">
                        <span
                          className={`text-[9px] sm:text-[10px] font-mono uppercase tracking-wider font-semibold ${
                            occupied ? "text-rose-400" : "text-emerald-400"
                          }`}
                        >
                          {occupied ? "OCCUPIED" : "AVAILABLE"}
                        </span>
                        <span className="text-[8px] sm:text-[9px] font-mono text-zinc-500 uppercase">
                          {occupied ? "LOCKED" : "READY"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Glowing Floor Reflection Grid */}
              <div
                className="mt-4 sm:mt-6 h-14 sm:h-24 w-full pointer-events-none relative overflow-hidden"
                style={{
                  transform: "rotateX(60deg) translateY(-8px) scale(1.05)",
                  transformOrigin: "top center",
                }}
              >
                <div
                  className="w-full h-full opacity-25 sm:opacity-35"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, #10b981 1px, transparent 1px), linear-gradient(to bottom, #27272a 1px, transparent 1px)",
                    backgroundSize: "36px 20px",
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-transparent" />
              </div>
            </div>

            {selectedLocker && (
              <div className="mt-4 pt-4 border-t border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <span
                    className={`px-2 py-0.5 text-[10px] uppercase border font-semibold ${
                      selectedLocker.isOccupied
                        ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    INSPECTING: L
                    {String(selectedLocker.lockerNumber).padStart(2, "0")}
                  </span>
                  <span className="text-zinc-400 text-[11px] sm:text-xs">
                    STATE:{" "}
                    <strong className="text-white">
                      {selectedLocker.isOccupied
                        ? "SECURELY LOCKED"
                        : "READY FOR CHECK-IN"}
                    </strong>
                  </span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-zinc-500">
                  LAST UPDATED:{" "}
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

        

        {/* 4. Xerokey SEO Structured Q&A Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16 border-t border-zinc-900">
          <div className="max-w-3xl mb-8">
            <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-emerald-400">
              FREQUENTLY ASKED QUESTIONS // XEROKEY
            </p>
            <h2 className="mt-2 text-xl sm:text-2xl font-light tracking-wider text-white uppercase">
              Everything you need to know about Xerokey
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <article className="border border-zinc-800/80 bg-zinc-950/50 p-5">
              <h3 className="text-sm font-mono font-semibold text-white uppercase">
                What is Xerokey?
              </h3>
              <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                Xerokey is an autonomous smart locker management system designed by XERORUN.COM for universities, libraries, co-working spaces, and gyms. Users tap their existing standard student ID or NFC credential to claim and unlock personal lockers without apps, keys, or passwords.
              </p>
            </article>

            <article className="border border-zinc-800/80 bg-zinc-950/50 p-5">
              <h3 className="text-sm font-mono font-semibold text-white uppercase">
                How does Xerokey handle security and master keys?
              </h3>
              <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                Xerokey enforces strict UID NFC validation for regular users, preventing counterfeit key duplication. Certified operators have fixed master keys (1 grand master for sequential opening) supporting either 4-byte or 7-byte formats.
              </p>
            </article>

            <article className="border border-zinc-800/80 bg-zinc-950/50 p-5">
              <h3 className="text-sm font-mono font-semibold text-white uppercase">
                What happens when Xerokey lockers are full?
              </h3>
              <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                When all 12 bays are occupied, the front panel LED turns red and Xerokey produces a long warning buzzer tone when any new card is scanned, while existing locker owners can still tap to check out and collect their belongings.
              </p>
            </article>

            <article className="border border-zinc-800/80 bg-zinc-950/50 p-5">
              <h3 className="text-sm font-mono font-semibold text-white uppercase">
                Can Xerokey operate without an active internet connection?
              </h3>
              <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                Yes. Xerokey features a 100% offline-first edge architecture. All locker states, check-ins, and check-outs execute locally on the ESP32 NVS memory with zero latency, storing events in LittleFS flash until internet connectivity resumes.
              </p>
            </article>
          </div>
        </section>
      </main>

      {/* 5. Footer & Creator / Mother Company Section */}
      <footer className="relative z-10 border-t border-zinc-900 bg-zinc-950/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-10 pb-10 sm:pb-12 border-b border-zinc-900">
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-400">
                  Powered by xerorun.com
                </span>
              </div>
              <h3 className="text-xl font-mono font-semibold tracking-wider text-white uppercase">
                XEROKEY
              </h3>
              <p className="text-xs font-mono text-zinc-400 leading-relaxed max-w-md">
                Next-generation autonomous NFC locker system. Designed for universities, libraries, and public spaces — maximum physical security with fastest check-in &amp; check-out.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] font-mono text-zinc-400">
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  XK_ARCH: NEXT.JS 14
                </span>
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  DB: MONGODB ATLAS
                </span>
                <span className="px-2.5 py-1 border border-zinc-800 bg-black text-zinc-300">
                  MCU: ESP32
                </span>
              </div>
            </div>

            <div className="lg:col-span-7 border border-zinc-800/90 bg-black/70 p-5 sm:p-8 flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-zinc-900">
                  <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-emerald-400">
                    LEAD SYSTEM ARCHITECT &amp; CREATOR
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    SOFTWARE &amp; IOT ENGINEERING
                  </span>
                </div>

                <h4 className="mt-4 sm:mt-5 text-xl sm:text-3xl font-light tracking-wide text-white">
                  {" "}
                  <span className="font-medium text-emerald-400">
                    Ashiqur Rahman (ashiqrun)
                  </span>
                </h4>

                <p className="mt-2 text-xs font-mono text-zinc-400 leading-relaxed">
                  Software Engineering &amp; Full-Stack IoT Developer specializing
                  in high-availability modern web and embedded hardware systems.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  <a
                    href="https://github.com/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all active:scale-95"
                  >
                    GITHUB ↗
                  </a>
                  <a
                    href="https://linkedin.com/in/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all active:scale-95"
                  >
                    LINKEDIN ↗
                  </a>
                  <a
                    href="https://instagram.com/ashiqrun"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-emerald-500/60 hover:text-white transition-all active:scale-95"
                  >
                    INSTAGRAM ↗
                  </a>
                </div>

                <a
                  href="https://ashiq.run"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-xs font-mono uppercase tracking-widest bg-white text-black font-semibold hover:bg-zinc-200 transition-all text-center active:scale-95"
                >
                  CREATOR PORTFOLIO ↗
                </a>
              </div>
            </div>
          </div>

          <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-[10px] sm:text-[11px] font-mono text-zinc-500 text-center sm:text-left">
            <p>
              © {mounted ? new Date().getFullYear() : "2026"} XEROKEY // POWERED BY XERORUN.COM // ALL RIGHTS RESERVED.
            </p>
            <p
              className={
                isHardwareOnline ? "text-emerald-400" : "text-rose-500"
              }
            >
              {isHardwareOnline ? "SYSTEM ONLINE &amp; SYNCED" : "SYSTEM CURRENTLY OFFLINE"}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default PublicLandingPage;
