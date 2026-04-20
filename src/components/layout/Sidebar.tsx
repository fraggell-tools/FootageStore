"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";

const navItems = [
  {
    href: "/clients",
    label: "Clients",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
];

const adminItems = [
  {
    href: "/admin/clients",
    label: "Manage Clients",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-56 bg-surface border-r border-border flex flex-col z-20">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <svg className="w-6 h-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="font-bold text-white">FootageStore</span>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname.startsWith(item.href)
                ? "bg-surface-hover text-white"
                : "text-neutral-400 hover:text-white hover:bg-surface-hover"
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        ))}

        {isAdmin && (
          <>
            <div className="pt-4 pb-2">
              <span className="px-3 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                Admin
              </span>
            </div>
            {adminItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  pathname.startsWith(item.href)
                    ? "bg-surface-hover text-white"
                    : "text-neutral-400 hover:text-white hover:bg-surface-hover"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            <button
              onClick={async () => {
                setSyncing(true);
                setSyncResult(null);
                try {
                  const res = await fetch("/api/sync", { method: "POST" });
                  const data = await res.json();
                  const parts = [];
                  if (data.clientsCreated) parts.push(`+${data.clientsCreated} clients`);
                  if (data.clipsCreated) parts.push(`+${data.clipsCreated} clips`);
                  if (data.clientsRemoved) parts.push(`-${data.clientsRemoved} clients`);
                  if (data.clipsRemoved) parts.push(`-${data.clipsRemoved} clips`);
                  setSyncResult(parts.length > 0 ? parts.join(", ") : "Up to date");
                  if (parts.length > 0) {
                    window.location.reload();
                  }
                  setTimeout(() => setSyncResult(null), 4000);
                } catch {
                  setSyncResult("Sync failed");
                  setTimeout(() => setSyncResult(null), 4000);
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-neutral-400 hover:text-white hover:bg-surface-hover w-full disabled:opacity-50"
            >
              <svg className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? "Syncing..." : "Sync Drive"}
            </button>
            {syncResult && (
              <div
                className={`mx-1 mt-1 flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-snug ${
                  syncResult === "Sync failed"
                    ? "bg-red-500/10 border border-red-500/20 text-red-300"
                    : syncResult === "Up to date"
                      ? "bg-white/5 border border-white/10 text-neutral-300"
                      : "bg-accent/15 border border-accent/30 text-accent"
                }`}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {syncResult === "Sync failed" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  )}
                </svg>
                <span className="break-words">{syncResult}</span>
              </div>
            )}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-medium">
            {session?.user?.name?.[0] || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{session?.user?.name}</p>
            <p className="text-xs text-muted truncate capitalize">{session?.user?.role}</p>
          </div>
          <button onClick={() => signOut()} className="text-muted hover:text-white">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
