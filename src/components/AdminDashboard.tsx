// File: src/components/AdminDashboard.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  clearAllLogs,
  logoutAdminAction,
  registerAdminAction,
  deleteAdminAction,
  changeAdminPasswordAction,
} from "@/app/actions";

export interface DashboardStats {
  totalUsers: number;
  occupiedLockersCount: number;
  totalLockers: number;
  todaysSessionsCount: number;
  lastHeartbeat: string | null;
  isOnline: boolean;
  lastSyncedSeq?: number;
}

export interface LockerItem {
  id: string;
  lockerNumber: number;
  isOccupied: boolean;
  currentUid: string | null;
}

export interface SessionLogItem {
  id: string;
  uid: string;
  lockerNumber: number;
  checkInTime: string;
  checkOutTime: string | null;
  duration: number | null;
  forcedByAdmin: string | null;
  seq?: number | null;
}

export interface AdminUserItem {
  id: string;
  username: string;
  createdAt: string;
}

export interface MasterKeyItem {
  id: string;
  type: "GRAND_MASTER" | "INDIVIDUAL_MASTER";
  lockerTarget: string;
  uid: string;
  label: string;
  description: string;
}

interface AdminDashboardProps {
  currentAdmin?: string;
  stats: DashboardStats;
  lockers: LockerItem[];
  sessions: SessionLogItem[];
  admins?: AdminUserItem[];
  masterKeys?: MasterKeyItem[];
}

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}

const LOGS_PER_PAGE = 50;

export default function AdminDashboard({
  currentAdmin = "UNKNOWN_ADMIN",
  stats,
  lockers = [],
  sessions = [],
  admins = [],
  masterKeys = [],
}: AdminDashboardProps) {
  const router = useRouter();
  const mounted = useMounted();

  const safeAdminDisplay = currentAdmin?.toUpperCase() || "ADMIN";
  const safeAdminLower = currentAdmin?.toLowerCase() || "admin";

  const [activeTab, setActiveTab] = useState<
    "telemetry" | "analytics" | "masterkeys" | "admins"
  >("telemetry");

  const [rankingSortBy, setRankingSortBy] = useState<"frequency" | "duration">(
    "frequency"
  );

  const [searchUid, setSearchUid] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedAdminFilter, setSelectedAdminFilter] = useState<string | null>(
    null
  );

  // Pagination state for 50-log boundary
  const [currentPage, setCurrentPage] = useState(1);

  const [isPurging, setIsPurging] = useState(false);

  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [isRegisteringAdmin, setIsRegisteringAdmin] = useState(false);

  const [passwordTargetAdminId, setPasswordTargetAdminId] = useState<
    string | null
  >(null);
  const [updatedPasswordInput, setUpdatedPasswordInput] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [deletingAdminId, setDeletingAdminId] = useState<string | null>(null);

  const [telemetryBanner, setTelemetryBanner] = useState<{
    type: "amber" | "red" | "emerald";
    message: string;
  } | null>(null);

  // Auto-poll every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [router]);

  // Reset pagination to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchUid, startDate, endDate, selectedAdminFilter]);

  // Real-time 30-second heartbeat check: new Date() - lastHeartbeat < 30000
  const isHardwareOnline = mounted
    ? stats?.lastHeartbeat
      ? new Date().getTime() - new Date(stats.lastHeartbeat).getTime() < 30000
      : false
    : Boolean(stats?.isOnline);

  const filteredSessions = useMemo(() => {
    const uidQuery = searchUid.trim().toUpperCase();

    const startTimestamp = startDate
      ? new Date(`${startDate}T00:00:00`).getTime()
      : null;
    const endTimestamp = endDate
      ? new Date(`${endDate}T23:59:59.999`).getTime()
      : null;

    return sessions.filter((session) => {
      const sessionUid = session.uid?.toUpperCase() || "";
      if (uidQuery && !sessionUid.includes(uidQuery)) {
        return false;
      }

      if (
        selectedAdminFilter &&
        (session.forcedByAdmin?.toLowerCase() || "") !==
          selectedAdminFilter.toLowerCase()
      ) {
        return false;
      }

      const sessionTime = new Date(session.checkInTime).getTime();
      if (startTimestamp !== null && sessionTime < startTimestamp) {
        return false;
      }
      if (endTimestamp !== null && sessionTime > endTimestamp) {
        return false;
      }

      return true;
    });
  }, [sessions, searchUid, startDate, endDate, selectedAdminFilter]);

  // Pagination Calculations
  const totalPages = Math.max(
    1,
    Math.ceil(filteredSessions.length / LOGS_PER_PAGE)
  );
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedSessions = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * LOGS_PER_PAGE;
    return filteredSessions.slice(startIndex, startIndex + LOGS_PER_PAGE);
  }, [filteredSessions, safeCurrentPage]);

  const startRecordIndex =
    filteredSessions.length === 0
      ? 0
      : (safeCurrentPage - 1) * LOGS_PER_PAGE + 1;
  const endRecordIndex = Math.min(
    safeCurrentPage * LOGS_PER_PAGE,
    filteredSessions.length
  );

  const userRankings = useMemo(() => {
    const map = new Map<
      string,
      {
        uid: string;
        totalUses: number;
        totalDuration: number;
        lastSeen: string;
        lastLocker: number;
      }
    >();

    sessions.forEach((s) => {
      const uid = s.uid?.toUpperCase() || "UNKNOWN";
      if (uid === "XERO_KEY_OVERRIDE" || uid === "HARDWARE_OVERRIDE") return;

      const existing = map.get(uid);
      const dur = s.duration ?? 0;

      if (!existing) {
        map.set(uid, {
          uid,
          totalUses: 1,
          totalDuration: dur,
          lastSeen: s.checkInTime,
          lastLocker: s.lockerNumber,
        });
      } else {
        existing.totalUses += 1;
        existing.totalDuration += dur;
        if (
          new Date(s.checkInTime).getTime() >
          new Date(existing.lastSeen).getTime()
        ) {
          existing.lastSeen = s.checkInTime;
          existing.lastLocker = s.lockerNumber;
        }
      }
    });

    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (rankingSortBy === "frequency") {
        if (b.totalUses !== a.totalUses) return b.totalUses - a.totalUses;
        return b.totalDuration - a.totalDuration;
      } else {
        if (b.totalDuration !== a.totalDuration)
          return b.totalDuration - a.totalDuration;
        return b.totalUses - a.totalUses;
      }
    });

    return list;
  }, [sessions, rankingSortBy]);

  const handleExportCSV = () => {
    if (filteredSessions.length === 0) {
      alert("No Xerokey logs match the current filter range.");
      return;
    }

    const headers = [
      "Session ID",
      "NFC UID",
      "Locker Number",
      "Check-In Time",
      "Check-Out Time",
      "Duration (Minutes)",
      "Forced By Admin",
    ];

    const csvRows = filteredSessions.map((log) => {
      const checkInFormatted = new Date(log.checkInTime).toLocaleString();
      const checkOutFormatted = log.checkOutTime
        ? new Date(log.checkOutTime).toLocaleString()
        : "ACTIVE SESSION";
      const durationFormatted =
        log.duration !== null ? `${log.duration}` : "N/A";
      const forcedByFormatted =
        log.forcedByAdmin?.toUpperCase() || "STANDARD_NFC";

      const rowValues = [
        log.id,
        log.uid,
        String(log.lockerNumber),
        checkInFormatted,
        checkOutFormatted,
        durationFormatted,
        forcedByFormatted,
      ];

      return rowValues
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(",");
    });

    const csvContent = [headers.join(","), ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    const dateStamp =
      startDate && endDate
        ? `${startDate}_to_${endDate}`
        : new Date().toISOString().split("T")[0];

    link.href = url;
    link.setAttribute("download", `Xerokey_Logs_${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();

    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRegisterAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegisteringAdmin(true);

    try {
      const result = await registerAdminAction(
        newAdminUsername,
        newAdminPassword
      );
      if (result.success) {
        setTelemetryBanner({
          type: "emerald",
          message: result.message || "NEW ADMIN PROVISIONED.",
        });
        setNewAdminUsername("");
        setNewAdminPassword("");
        router.refresh();
      } else {
        setTelemetryBanner({
          type: "red",
          message: result.error || "FAILED TO PROVISION ADMIN.",
        });
      }
    } catch {
      setTelemetryBanner({
        type: "red",
        message: "ERROR PROVISIONING ADMIN.",
      });
    } finally {
      setIsRegisteringAdmin(false);
    }
  };

  const handleUpdatePassword = async (adminId: string) => {
    if (!updatedPasswordInput || updatedPasswordInput.length < 6) {
      setTelemetryBanner({
        type: "red",
        message: "SECURITY PASSKEY MUST BE AT LEAST 6 CHARACTERS.",
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const result = await changeAdminPasswordAction(
        adminId,
        updatedPasswordInput
      );
      if (result.success) {
        setTelemetryBanner({
          type: "emerald",
          message: result.message || "ADMIN PASSKEY UPDATED.",
        });
        setPasswordTargetAdminId(null);
        setUpdatedPasswordInput("");
        router.refresh();
      } else {
        setTelemetryBanner({
          type: "red",
          message: result.error || "FAILED TO UPDATE PASSKEY.",
        });
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleDeleteAdmin = async (adminId: string, username: string) => {
    const confirmed = window.confirm(
      `XEROKEY SECURITY CONFIRMATION:\n\nRevoke all administrative privileges and delete operator "${username.toUpperCase()}"?`
    );
    if (!confirmed) return;

    setDeletingAdminId(adminId);
    try {
      const result = await deleteAdminAction(adminId);
      if (result.success) {
        setTelemetryBanner({
          type: "amber",
          message: result.message || "OPERATOR REVOKED.",
        });
        router.refresh();
      } else {
        setTelemetryBanner({
          type: "red",
          message: result.error || "FAILED TO REVOKE OPERATOR.",
        });
      }
    } finally {
      setDeletingAdminId(null);
    }
  };

  const handleViewAdminActivity = (adminUsername: string) => {
    const safeTarget = adminUsername || "ADMIN";
    setSelectedAdminFilter(safeTarget);
    setActiveTab("telemetry");
    const isMaster = safeTarget.toUpperCase().includes("MASTER");
    setTelemetryBanner({
      type: "amber",
      message: isMaster
        ? `[MASTER KEY AUDIT ACTIVE] Displaying physical master key override logs (${safeTarget.toUpperCase()}).`
        : `[OPERATOR AUDIT ACTIVE] Displaying override logs executed by operator "${safeTarget.toUpperCase()}".`,
    });
  };

  const handlePurgeDatabase = async () => {
    const confirmed = window.confirm(
      "XEROKEY SECURITY WARNING:\n\nPermanently delete all active and historical session logs from MongoDB? (All-Time Registered User counts in the User Registry will remain intact.)"
    );
    if (!confirmed) return;

    setIsPurging(true);
    try {
      const response = await clearAllLogs();
      if (response.success) {
        setTelemetryBanner({
          type: "red",
          message: `[XEROKEY SESSION LOGS PURGED] Erased ${
            response.deletedCount ?? 0
          } session logs. Permanent User Registry remains intact.`,
        });
        router.refresh();
      } else {
        setTelemetryBanner({
          type: "red",
          message: response.error || "PURGE FAILED.",
        });
      }
    } finally {
      setIsPurging(false);
    }
  };

  const handleLogout = async () => {
    await logoutAdminAction();
    router.push("/admin/login");
    router.refresh();
  };

  const formatTimestamp = (isoString: string) => {
    if (!mounted) return "SYNCING_CLOCK...";
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white overflow-x-hidden">
      {/* TOP STICKY HEADER WITH REAL-TIME HEARTBEAT STATUS (MOBILE-OPTIMIZED) */}
      <header className="border-b border-zinc-800 bg-black/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
          <div className="flex items-center justify-between md:justify-start gap-3 sm:gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full shrink-0 ${
                  isHardwareOnline
                    ? "bg-emerald-500 animate-pulse shadow-[0_0_12px_#10b981]"
                    : "bg-rose-500 shadow-[0_0_12px_#f43f5e]"
                }`}
              />
              <div>
                <p className="text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-500">
                  
                </p>
                <h1 className="text-base sm:text-lg md:text-xl font-semibold tracking-tight text-white">
                  XEROKEY CONTROL TERMINAL
                </h1>
              </div>
            </div>

            {/* Mobile Online Pill */}
            <span
              className={`md:hidden px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider border shrink-0 ${
                isHardwareOnline
                  ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-400"
                  : "border-rose-500/50 bg-rose-950/30 text-rose-400"
              }`}
            >
              {isHardwareOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Desktop Real-Time Heartbeat Badge */}
            <span
              className={`hidden md:inline-flex px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest border ${
                isHardwareOnline
                  ? "border-emerald-500/50 bg-emerald-950/30 text-emerald-400"
                  : "border-rose-500/50 bg-rose-950/30 text-rose-400"
              }`}
            >
              {isHardwareOnline ? "STATUS: ONLINE" : "STATUS: OFFLINE"}
            </span>

            <span className="px-2.5 py-1.5 sm:px-3 sm:py-2 text-[10px] font-mono uppercase tracking-widest border border-zinc-800 bg-zinc-950 text-zinc-300">
              OPERATOR: {safeAdminDisplay}
            </span>

            <button
              type="button"
              onClick={handlePurgeDatabase}
              disabled={isPurging}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 text-[10px] sm:text-xs font-mono uppercase tracking-wider border border-red-500/60 bg-red-950/30 text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-50 transition-all active:scale-95 touch-manipulation"
            >
              {isPurging ? "CLEARING..." : "CLEAR DATABASE"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 sm:px-3.5 sm:py-2 text-[10px] sm:text-xs font-mono uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-white hover:text-black transition-all active:scale-95 touch-manipulation"
            >
              LOGOUT
            </button>
          </div>
        </div>

        {/* Navigation Tabs Bar with Touch-Friendly Horizontal Scrolling */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-2 sm:gap-6 border-t border-zinc-900 overflow-x-auto no-scrollbar whitespace-nowrap">
          <button
            type="button"
            onClick={() => setActiveTab("telemetry")}
            className={`py-3 text-[11px] sm:text-xs font-mono uppercase tracking-[0.16em] sm:tracking-[0.2em] border-b-2 transition-all shrink-0 touch-manipulation ${
              activeTab === "telemetry"
                ? "border-emerald-500 text-white font-semibold"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            01 // LOCKER MANAGEMENT
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            className={`py-3 text-[11px] sm:text-xs font-mono uppercase tracking-[0.16em] sm:tracking-[0.2em] border-b-2 transition-all flex items-center gap-2 shrink-0 touch-manipulation ${
              activeTab === "analytics"
                ? "border-emerald-500 text-white font-semibold"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span>02 // USERS LEADERBOARD</span>
            <span className="px-1.5 py-0.5 text-[10px] bg-zinc-900 border border-zinc-700 text-zinc-300">
              {userRankings.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("masterkeys")}
            className={`py-3 text-[11px] sm:text-xs font-mono uppercase tracking-[0.16em] sm:tracking-[0.2em] border-b-2 transition-all flex items-center gap-2 shrink-0 touch-manipulation ${
              activeTab === "masterkeys"
                ? "border-emerald-500 text-white font-semibold"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span>03 // MASTER KEYS</span>
            <span className="px-1.5 py-0.5 text-[10px] bg-zinc-900 border border-zinc-700 text-zinc-300">
              {masterKeys.length || 13}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("admins")}
            className={`py-3 text-[11px] sm:text-xs font-mono uppercase tracking-[0.16em] sm:tracking-[0.2em] border-b-2 transition-all flex items-center gap-2 shrink-0 touch-manipulation ${
              activeTab === "admins"
                ? "border-emerald-500 text-white font-semibold"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span>04 // ADMIN MANAGEMENT</span>
            <span className="px-1.5 py-0.5 text-[10px] bg-zinc-900 border border-zinc-700 text-zinc-300">
              {admins.length}
            </span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8 sm:space-y-10">
        {telemetryBanner && (
          <div
            className={`border px-3.5 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-3 ${
              telemetryBanner.type === "amber"
                ? "border-amber-500/40 bg-amber-950/20 text-amber-300"
                : telemetryBanner.type === "red"
                ? "border-red-500/40 bg-red-950/20 text-red-300"
                : "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
            }`}
          >
            <p className="text-xs font-mono tracking-wide leading-relaxed">
              {telemetryBanner.message}
            </p>
            <button
              type="button"
              onClick={() => setTelemetryBanner(null)}
              className="text-xs font-mono underline hover:text-white uppercase ml-3 shrink-0"
            >
              DISMISS
            </button>
          </div>
        )}

        {/* TAB 1: TELEMETRY MATRIX & LOGS */}
        {activeTab === "telemetry" && (
          <>
            {/* 1. COUNTS */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono px-2 py-0.5 border border-zinc-800 bg-zinc-950 text-zinc-400">
                    HW SYNC SEQ: #{stats?.lastSyncedSeq ?? 0}
                  </span>
                  <span
                    className={`text-[11px] font-mono font-semibold ${
                      isHardwareOnline ? "text-emerald-400" : "text-rose-500"
                    }`}
                  >
                    {isHardwareOnline
                      ? "LOCKER STATUS: ONLINE"
                      : "LOCKER STATUS: OFFLINE"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                <div className="border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                      ALL TIME REGISTERED USERS
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 border border-zinc-800 text-zinc-500">
                      PERMANENT UID
                    </span>
                  </div>
                  <div className="mt-4 sm:mt-6 flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-mono font-light tracking-tight text-white">
                      {String(stats?.totalUsers ?? 0).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-mono text-zinc-500">
                      USERS
                    </span>
                  </div>
                </div>

                <div className="border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                      ACTIVE LOCKER OCCUPANCY
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 border ${
                        (stats?.occupiedLockersCount ?? 0) > 0
                          ? "border-red-500/40 text-red-400 bg-red-950/20"
                          : "border-emerald-500/40 text-emerald-400 bg-emerald-950/20"
                      }`}
                    >
                      {(stats?.occupiedLockersCount ?? 0) > 0
                        ? "IN USE"
                        : "ALL CLEAR"}
                    </span>
                  </div>
                  <div className="mt-4 sm:mt-6 flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-mono font-light tracking-tight text-white">
                      {String(stats?.occupiedLockersCount ?? 0).padStart(
                        2,
                        "0"
                      )}
                    </span>
                    <span className="text-sm font-mono text-zinc-500">
                      / {stats?.totalLockers ?? 12} UNITS OCCUPIED
                    </span>
                  </div>
                </div>

                <div className="border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6 flex flex-col justify-between sm:col-span-2 lg:col-span-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                      TODAY&apos;S SESSIONS
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 border border-zinc-800 text-zinc-500">
                      24H_WINDOW
                    </span>
                  </div>
                  <div className="mt-4 sm:mt-6 flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-mono font-light tracking-tight text-white">
                      {String(stats?.todaysSessionsCount ?? 0).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-mono text-zinc-500">
                      CHECK-INS TODAY
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. 12-LOCKER VISUAL HARDWARE MATRIX */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500">
                  ALL LOCKER STATUS //
                </h2>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="flex items-center gap-2 text-zinc-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    AVAILABLE
                  </span>
                  <span className="flex items-center gap-2 text-zinc-400">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    OCCUPIED
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
                {lockers.map((locker) => {
                  const formattedNum = String(locker.lockerNumber).padStart(
                    2,
                    "0"
                  );
                  const occupied = locker.isOccupied;

                  return (
                    <div
                      key={locker.id}
                      className={`border p-4 sm:p-5 transition-all flex flex-col justify-between ${
                        occupied
                          ? "border-red-500/40 bg-red-950/10"
                          : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500/40"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono uppercase tracking-widest text-zinc-500">
                            UNIT #{formattedNum}
                          </span>

                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${
                              occupied
                                ? "border-red-500/40 bg-red-500/10 text-red-400"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                occupied ? "bg-red-500" : "bg-emerald-500"
                              }`}
                            />
                            {occupied ? "OCCUPIED" : "AVAILABLE"}
                          </span>
                        </div>

                        <div className="my-3 sm:my-4 flex items-baseline justify-between">
                          <span className="text-2xl sm:text-3xl font-mono font-light text-white">
                            L{formattedNum}
                          </span>
                          <span className="text-[10px] sm:text-[11px] font-mono text-zinc-500">
                            {occupied ? "LOCKED_ACTIVE" : "STANDBY"}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-zinc-800/80">
                        <span className="block text-[10px] font-mono uppercase text-zinc-500">
                          ASSIGNED UID
                        </span>
                        <span className="text-xs font-mono text-zinc-200 truncate block mt-0.5">
                          {occupied && locker.currentUid
                            ? locker.currentUid
                            : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 3. SESSION LOGS TABLE WITH 50-LOG BOUNDARY & PAGINATION */}
            <section>
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500">
                    LOCKER LOGS (50 PER PAGE) //
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 mt-1">
                    <p className="text-[11px] font-mono text-zinc-400">
                      SHOWING {startRecordIndex} - {endRecordIndex} OF{" "}
                      {filteredSessions.length} RECORDS (PAGE {safeCurrentPage}{" "}
                      OF {totalPages})
                    </p>

                    {selectedAdminFilter && (
                      <span className="inline-flex items-center gap-2 px-2.5 py-0.5 text-[10px] font-mono uppercase border border-emerald-500/50 bg-emerald-950/30 text-emerald-300">
                        OPERATOR AUDIT:{" "}
                        {selectedAdminFilter?.toUpperCase() || "ADMIN"}
                        <button
                          type="button"
                          onClick={() => setSelectedAdminFilter(null)}
                          className="text-white hover:text-rose-400 font-bold ml-1"
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-end flex-wrap gap-2.5 sm:gap-3">
                  <div className="w-full sm:w-auto">
                    <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                      FILTER BY UID
                    </label>
                    <input
                      type="text"
                      value={searchUid}
                      onChange={(e) => setSearchUid(e.target.value)}
                      placeholder="ENTER NFC UID..."
                      className="w-full sm:w-44 bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                    />
                  </div>

                  <div className="w-full sm:w-auto">
                    <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                      START DATE
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-zinc-400 [color-scheme:dark]"
                    />
                  </div>

                  <div className="w-full sm:w-auto">
                    <label className="block text-[10px] font-mono uppercase text-zinc-500 mb-1">
                      END DATE
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-zinc-400 [color-scheme:dark]"
                    />
                  </div>

                  {(searchUid ||
                    startDate ||
                    endDate ||
                    selectedAdminFilter) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchUid("");
                        setStartDate("");
                        setEndDate("");
                        setSelectedAdminFilter(null);
                      }}
                      className="w-full sm:w-auto px-3 py-2 text-xs font-mono uppercase border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors touch-manipulation"
                    >
                      RESET
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleExportCSV}
                    className="w-full sm:w-auto px-4 py-2 text-xs font-mono uppercase tracking-wider bg-white text-black font-semibold hover:bg-zinc-200 transition-all touch-manipulation active:scale-95"
                  >
                    EXPORT CSV ({filteredSessions.length})
                  </button>
                </div>
              </div>

              {/* Table Wrapper with Clean Scrolling */}
              <div className="border border-zinc-800 bg-zinc-950/40 overflow-hidden">
                <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                  <table className="min-w-[680px] w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">NFC UID</th>
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">LOCKER NO</th>
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">CHECK-IN TIME</th>
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">CHECK-OUT TIME</th>
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">FORCED BY OPERATOR</th>
                        <th className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-right">DURATION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70 text-xs font-mono">
                      {paginatedSessions.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-12 text-center text-zinc-500 uppercase tracking-widest"
                          >
                            NO XEROKEY LOGS MATCH ACTIVE PARAMETERS
                          </td>
                        </tr>
                      ) : (
                        paginatedSessions.map((session) => {
                          const isActive = session.checkOutTime === null;

                          return (
                            <tr
                              key={session.id}
                              className="hover:bg-zinc-900/50 transition-colors"
                            >
                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 font-medium text-white whitespace-nowrap">
                                {session.uid}
                              </td>

                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-zinc-300 whitespace-nowrap">
                                L-{String(session.lockerNumber).padStart(2, "0")}
                              </td>

                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-zinc-400 whitespace-nowrap">
                                {formatTimestamp(session.checkInTime)}
                              </td>

                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 whitespace-nowrap">
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] border border-amber-500/40 bg-amber-500/10 text-amber-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                                    IN PROGRESS
                                  </span>
                                ) : (
                                  <span className="text-zinc-400">
                                    {formatTimestamp(session.checkOutTime!)}
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 whitespace-nowrap">
                                {session.forcedByAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleViewAdminActivity(
                                        session.forcedByAdmin!
                                      )
                                    }
                                    className={`px-2 py-0.5 text-[10px] uppercase border font-medium transition-colors ${
                                      session.forcedByAdmin.toUpperCase() === "MASTER_ALL"
                                        ? "border-rose-500/60 bg-rose-950/40 text-rose-300 hover:border-rose-400"
                                        : session.forcedByAdmin.toUpperCase().startsWith("MASTER")
                                        ? "border-amber-500/50 bg-amber-950/30 text-amber-300 hover:border-amber-400"
                                        : "border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:border-emerald-400"
                                    }`}
                                  >
                                    OVERRIDE: {session.forcedByAdmin.toUpperCase()}
                                  </button>
                                ) : (
                                  <span className="text-zinc-600">—</span>
                                )}
                              </td>

                              <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-right whitespace-nowrap text-zinc-300">
                                {session.duration !== null
                                  ? `${session.duration} min`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 50-LOGS BOUNDARY PAGINATION CONTROLS (NEXT / PREVIOUS BUTTONS) */}
                <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
                  <div className="text-zinc-400 text-center sm:text-left">
                    <span>
                      Page <strong className="text-white">{safeCurrentPage}</strong> of{" "}
                      <strong className="text-white">{totalPages}</strong>
                    </span>
                    <span className="text-zinc-600 mx-2">•</span>
                    <span className="text-zinc-500">
                      Showing {startRecordIndex}-{endRecordIndex} of {filteredSessions.length} total logs
                    </span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
                    <button
                      type="button"
                      disabled={safeCurrentPage <= 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      className="flex-1 sm:flex-none px-4 py-2 text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation active:scale-95"
                    >
                      ← PREVIOUS
                    </button>

                    <div className="px-3 py-1.5 border border-zinc-800 bg-black text-[11px] text-zinc-400 font-mono">
                      {safeCurrentPage} / {totalPages}
                    </div>

                    <button
                      type="button"
                      disabled={safeCurrentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                      }
                      className="flex-1 sm:flex-none px-4 py-2 text-xs font-mono uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation active:scale-95"
                    >
                      NEXT →
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {/* TAB 2: ANALYTICS & USER RANKINGS */}
        {activeTab === "analytics" && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-4">
              <div>
                <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">
                  XEROKEY // LEADERBOARD
                </h2>
                <p className="text-sm font-mono text-zinc-300 mt-1">
                  LOCKER UTILIZATION &amp; DURATION RANKINGS
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRankingSortBy("frequency")}
                  className={`px-3.5 py-2 text-xs font-mono uppercase tracking-wider border transition-all touch-manipulation ${
                    rankingSortBy === "frequency"
                      ? "border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white"
                  }`}
                >
                  SORT: HIGHEST FREQUENCY
                </button>

                <button
                  type="button"
                  onClick={() => setRankingSortBy("duration")}
                  className={`px-3.5 py-2 text-xs font-mono uppercase tracking-wider border transition-all touch-manipulation ${
                    rankingSortBy === "duration"
                      ? "border-emerald-500 bg-emerald-950/30 text-emerald-300 font-semibold"
                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white"
                  }`}
                >
                  SORT: LONGEST DURATION
                </button>
              </div>
            </div>

            <div className="border border-zinc-800 bg-zinc-950/40 overflow-hidden">
              <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
                <table className="min-w-[620px] w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-950 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">RANK</th>
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">ID CREDENTIAL</th>
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">
                        TOTAL SESSIONS (FREQUENCY)
                      </th>
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">
                        CUMULATIVE DURATION (MINUTES)
                      </th>
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4">LAST ASSIGNED LOCKER</th>
                      <th className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-right">LAST TIME USED</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70 text-xs font-mono">
                    {userRankings.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-12 text-center text-zinc-500 uppercase tracking-widest"
                        >
                          NO USER CREDENTIAL AVAILABLE FOR RANKING
                        </td>
                      </tr>
                    ) : (
                      userRankings.map((item, idx) => (
                        <tr
                          key={item.uid}
                          className="hover:bg-zinc-900/50 transition-colors"
                        >
                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center justify-center px-2 py-0.5 text-[10px] border ${
                                idx === 0
                                  ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-300 font-bold"
                                  : idx < 3
                                  ? "border-zinc-600 bg-zinc-900 text-zinc-200"
                                  : "border-zinc-800 text-zinc-500"
                              }`}
                            >
                              #{String(idx + 1).padStart(2, "0")}
                            </span>
                          </td>

                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 font-semibold text-white whitespace-nowrap">
                            {item.uid}
                          </td>

                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 whitespace-nowrap">
                            <span
                              className={
                                rankingSortBy === "frequency"
                                  ? "text-emerald-400 font-semibold"
                                  : "text-zinc-300"
                              }
                            >
                              {item.totalUses} USES
                            </span>
                          </td>

                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 whitespace-nowrap">
                            <span
                              className={
                                rankingSortBy === "duration"
                                  ? "text-emerald-400 font-semibold"
                                  : "text-zinc-300"
                              }
                            >
                              {item.totalDuration} MIN
                            </span>
                          </td>

                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-zinc-400 whitespace-nowrap">
                            L-{String(item.lastLocker).padStart(2, "0")}
                          </td>

                          <td className="py-3 px-3.5 sm:py-3.5 sm:px-4 text-right text-zinc-400 whitespace-nowrap">
                            {formatTimestamp(item.lastSeen)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* TAB 3: 13 PHYSICAL HARDWARE MASTER KEYS */}
        {activeTab === "masterkeys" && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-900 pb-4">
              <div>
                <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-emerald-400">
                  XEROKEY MASTER KEYS //
                </h2>
                <p className="text-sm font-mono text-zinc-300 mt-1">
                  1 GRAND MASTER KEY & 12 SPECIFIC MASTER KEYS
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-400">
                  TOTAL REGISTERED: {masterKeys.length || 13} KEYS
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
              {masterKeys.map((key) => {
                const isGrand = key.type === "GRAND_MASTER";
                const overrideCount = sessions.filter((s) => {
                  if (isGrand) {
                    return (s.forcedByAdmin || "").toUpperCase() === "MASTER_ALL";
                  }
                  return (
                    (s.forcedByAdmin || "").toUpperCase() === "MASTER_KEY" &&
                    key.lockerTarget.includes(String(s.lockerNumber).padStart(2, "0"))
                  );
                }).length;

                return (
                  <div
                    key={key.id}
                    className={`border p-4 sm:p-5 space-y-3 flex flex-col justify-between transition-all ${
                      isGrand
                        ? "border-rose-500/50 bg-rose-950/10 hover:border-rose-400"
                        : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500/40"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
                          {key.lockerTarget}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono uppercase border ${
                            isGrand
                              ? "border-rose-500/40 bg-rose-950/30 text-rose-300"
                              : "border-emerald-500/40 bg-emerald-950/30 text-emerald-400"
                          }`}
                        >
                          {isGrand ? "FIRE" : "SPECIFIC"}
                        </span>
                      </div>

                      <h3 className="text-base font-mono font-semibold text-white mt-2">
                        {key.label}
                      </h3>

                      <p className="text-[11px] font-mono text-zinc-400 mt-1">
                        {key.description}
                      </p>

                      <div className="mt-3 pt-3 border-t border-zinc-800/80">
                        <span className="block text-[10px] font-mono uppercase text-zinc-500">
                          NFC CARD UID (HEX)
                        </span>
                        <code className="text-xs font-mono text-emerald-400 select-all block mt-0.5 break-all">
                          {key.uid}
                        </code>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-zinc-500">
                        RECORDED OVERRIDES:{" "}
                        <strong className="text-white">{overrideCount}</strong>
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          handleViewAdminActivity(
                            isGrand ? "MASTER_ALL" : "MASTER_KEY"
                          )
                        }
                        className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-white hover:text-black transition-all touch-manipulation active:scale-95"
                      >
                        AUDIT ({overrideCount})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 4: ADVANCED ADMIN MANAGEMENT */}
        {activeTab === "admins" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-500">
                    XEROKEY ADMINS //
                  </h2>
                  <p className="text-[11px] font-mono text-zinc-600 mt-1">
                    AUDIT OVERRIDE LOGS, ROTATE PASSKEYS, OR REVOKE CLEARANCE
                  </p>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  {admins.length} ADMINS
                </span>
              </div>

              <div className="border border-zinc-800 bg-zinc-950/40 divide-y divide-zinc-800">
                {admins.map((admin) => {
                  const adminNameLower = admin.username?.toLowerCase() || "";
                  const isRootAdmin = adminNameLower === "admin";
                  const isCurrent = adminNameLower === safeAdminLower;
                  const isChangingPass = passwordTargetAdminId === admin.id;
                  const isBeingDeleted = deletingAdminId === admin.id;

                  const overrideCount = sessions.filter(
                    (s) =>
                      (s.forcedByAdmin?.toLowerCase() || "") === adminNameLower
                  ).length;

                  return (
                    <div
                      key={admin.id}
                      className="p-4 sm:p-5 space-y-4 hover:bg-zinc-900/30 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-sm font-mono font-semibold text-white uppercase tracking-wider">
                              {admin.username?.toUpperCase() || "ADMIN"}
                            </span>
                            {isRootAdmin && (
                              <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-amber-500/40 bg-amber-950/30 text-amber-300">
                                MASTER ROOT
                              </span>
                            )}
                            {isCurrent && (
                              <span className="px-2 py-0.5 text-[10px] font-mono uppercase border border-emerald-500/40 bg-emerald-950/30 text-emerald-400">
                                CURRENT ADMIN
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] font-mono text-zinc-500">
                            PROVISIONED: {formatTimestamp(admin.createdAt)} //
                            OVERRIDES:{" "}
                            <strong className="text-zinc-300">
                              {overrideCount}
                            </strong>
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              handleViewAdminActivity(admin.username)
                            }
                            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-white hover:text-black transition-all touch-manipulation active:scale-95"
                          >
                            AUDIT ({overrideCount})
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              if (isChangingPass) {
                                setPasswordTargetAdminId(null);
                                setUpdatedPasswordInput("");
                              } else {
                                setPasswordTargetAdminId(admin.id);
                                setUpdatedPasswordInput("");
                              }
                            }}
                            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-emerald-500 hover:text-emerald-300 transition-all touch-manipulation active:scale-95"
                          >
                            {isChangingPass ? "CANCEL" : "CHANGE PASSKEY"}
                          </button>

                          {!isRootAdmin && (
                            <button
                              type="button"
                              disabled={isBeingDeleted}
                              onClick={() =>
                                handleDeleteAdmin(admin.id, admin.username)
                              }
                              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider border border-red-500/50 bg-red-950/20 text-red-400 hover:bg-red-600 hover:text-white disabled:opacity-50 transition-all touch-manipulation active:scale-95"
                            >
                              {isBeingDeleted ? "REVOKING..." : "REMOVE"}
                            </button>
                          )}
                        </div>
                      </div>

                      {isChangingPass && (
                        <div className="pt-3 border-t border-zinc-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                          <input
                            type="password"
                            value={updatedPasswordInput}
                            onChange={(e) =>
                              setUpdatedPasswordInput(e.target.value)
                            }
                            placeholder="NEW SECURITY PASSKEY (MIN 6 CHARS)..."
                            className="flex-1 bg-black border border-zinc-700 px-3 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            disabled={isUpdatingPassword}
                            onClick={() => handleUpdatePassword(admin.id)}
                            className="px-4 py-2 text-xs font-mono uppercase tracking-wider bg-emerald-500 text-black font-semibold hover:bg-emerald-400 disabled:opacity-50 transition-all shrink-0 touch-manipulation active:scale-95"
                          >
                            {isUpdatingPassword
                              ? "UPDATING..."
                              : "SAVE NEW PASSKEY"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="border border-zinc-800 bg-zinc-950/60 p-5 sm:p-6">
                <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-emerald-400">
                  XEROKEY // ACCESS CLEARANCE
                </p>
                <h3 className="mt-1 text-base sm:text-lg font-light tracking-wider text-white uppercase">
                  PROVISION NEW ADMIN
                </h3>
                <p className="mt-2 text-xs font-mono text-zinc-500 leading-relaxed">
                  Authorize a new Xerokey administrator.
                  Passkeys are salted and SHA-256 hashed prior to persistence.
                </p>

                <form onSubmit={handleRegisterAdmin} className="mt-5 sm:mt-6 space-y-4">
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-1.5 sm:mb-2">
                      USERNAME
                    </label>
                    <input
                      type="text"
                      required
                      value={newAdminUsername}
                      onChange={(e) => setNewAdminUsername(e.target.value)}
                      placeholder="ENTER USERNAME"
                      className="w-full bg-black border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-1.5 sm:mb-2">
                      SECURITY PASSKEY (MIN 6 CHARS)
                    </label>
                    <input
                      type="password"
                      required
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      placeholder="••••••••••"
                      className="w-full bg-black border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isRegisteringAdmin}
                    className="w-full py-3 text-xs font-mono uppercase tracking-[0.18em] bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-all touch-manipulation active:scale-[0.99]"
                  >
                    {isRegisteringAdmin
                      ? "AUTHORIZING ADMIN..."
                      : "AUTHORIZE ADMIN"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
