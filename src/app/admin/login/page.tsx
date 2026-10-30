// File: src/app/admin/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loginAdminAction } from "@/app/actions";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const result = await loginAdminAction(username, password);
      if (result.success) {
        router.push("/admin");
        router.refresh();
      } else {
        setError(result.error || "AUTHENTICATION FAILED");
      }
    } catch {
      setError("UNEXPECTED SYSTEM ERROR");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col justify-between p-6 selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Bar */}
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between border-b border-zinc-900 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />
          <span className="text-xs font-mono font-bold tracking-[0.35em] text-white">
            XERO KEY
          </span>
        </div>
        <Link
          href="/"
          className="text-xs font-mono uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
        >
          ← PUBLIC MATRIX
        </Link>
      </div>

      {/* Center Login Box */}
      <div className="max-w-md w-full mx-auto border border-zinc-800 bg-zinc-950/80 p-8 relative">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />

        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-emerald-400">
          XERO KEY // ADMIN
        </p>
        <h1 className="mt-2 text-2xl font-light tracking-wider text-white uppercase">
          ADMIN PANEL LOGIN
        </h1>
        <p className="mt-2 text-xs font-mono text-zinc-500">
          Enter your Xero Key administrator credentials to access hardware
          overrides and session logs.
        </p>

        {error && (
          <div className="mt-5 border border-rose-500/50 bg-rose-950/30 px-3.5 py-2.5 text-xs font-mono text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-2">
              ADMIN USERNAME
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              className="w-full bg-black border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-zinc-400 mb-2">
              SECURITY PASSKEY
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              className="w-full bg-black border border-zinc-800 px-3.5 py-2.5 text-xs font-mono text-white placeholder-zinc-700 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 text-xs font-mono uppercase tracking-[0.2em] bg-white text-black font-semibold hover:bg-zinc-200 disabled:opacity-50 transition-all"
          >
            {isLoading ? "VERIFYING CREDENTIALS..." : "INITIALIZE SESSION →"}
          </button>
        </form>

        
      </div>

      {/* Bottom Footer */}
      <div className="max-w-7xl w-full mx-auto text-center text-[11px] font-mono text-zinc-600">
        XERO KEY SECURITY
      </div>
    </div>
  );
}