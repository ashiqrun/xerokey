// File: src/app/page.tsx

import prisma from "@/lib/prisma";
import {
  PublicLiveView,
  type PublicLockerItem,
  type PublicTelemetryStats,
} from "@/components/PublicLiveView";

// Incremental Static Revalidation: cached at edge, instant TTFB (<20ms)
export const revalidate = 2;

// Module-level guard: initialization runs once per process, never on hot user requests
let isLockersSeeded = false;
async function ensureLockersOnce() {
  if (isLockersSeeded) return;
  try {
    const count = await prisma.locker.count();
    if (count < 12) {
      const existing = await prisma.locker.findMany({
        select: { lockerNumber: true },
      });
      const set = new Set(existing.map((l) => l.lockerNumber));
      const missing = [];
      for (let i = 1; i <= 12; i++) {
        if (!set.has(i)) {
          missing.push({
            lockerNumber: i,
            isOccupied: false,
            currentUid: null,
          });
        }
      }
      if (missing.length > 0) {
        await prisma.locker.createMany({ data: missing });
      }
    }
    isLockersSeeded = true;
  } catch (err) {
    console.error("Lockers initialization error:", err);
  }
}

export default async function HomePage() {
  await ensureLockersOnce();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [rawLockers, dailyUsersCount, allTimeUsersCount, systemStatus] =
    await Promise.all([
      prisma.locker.findMany({
        orderBy: { lockerNumber: "asc" },
        take: 12,
        select: {
          id: true,
          lockerNumber: true,
          isOccupied: true,
        },
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
        select: { lastHeartbeat: true },
      }),
    ]);

  const lockers: PublicLockerItem[] = rawLockers.map((locker) => ({
    id: locker.id,
    lockerNumber: locker.lockerNumber,
    isOccupied: locker.isOccupied,
  }));

  const availableCount = lockers.filter((l) => !l.isOccupied).length;
  const occupiedCount = lockers.length - availableCount;

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

      {/* Top Header + Interactive 3D Locker Matrix Island */}
      <PublicLiveView initialLockers={lockers} initialStats={stats} />

      {/* 4. Xerokey SEO Structured Q&A Section (Pure Server Component - Zero Client JS overhead) */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16 border-t border-zinc-900">
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

      {/* 5. Footer & Creator / Mother Company Section (Pure Server Component - Zero Client JS overhead) */}
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
              © {new Date().getFullYear()} XEROKEY // POWERED BY XERORUN.COM // ALL RIGHTS RESERVED.
            </p>
            <p className={isOnline ? "text-emerald-400" : "text-rose-500"}>
              {isOnline ? "SYSTEM IS ONLINE" : "SYSTEM IS OFFLINE"}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
