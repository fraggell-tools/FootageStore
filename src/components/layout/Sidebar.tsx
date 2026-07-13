"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";
import ThemeToggle from "./ThemeToggle";
import ClipDetailModal, { type Clip } from "@/components/clips/ClipDetailModal";

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
  {
    href: '/plugin',
    label: 'Premiere Plugin',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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
    href: "/admin/import",
    label: "Import from Drive",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

const monoStyle: React.CSSProperties = {
  fontFamily: "var(--font-geist-mono), 'Geist Mono', 'SF Mono', monospace",
  fontSize: "0.6875rem",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: "var(--muted)",
};

function rowStyle(active: boolean, collapsed: boolean): React.CSSProperties {
  return {
    position: "relative",
    fontSize: 14,
    fontWeight: 500,
    color: active ? "var(--fg)" : "var(--quiet)",
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: collapsed ? "center" : "flex-start",
    gap: collapsed ? 0 : 12,
    padding: collapsed ? "8px 0" : "8px 12px",
    borderRadius: 6,
    marginBottom: 2,
    width: "100%",
    background: active ? "var(--sidebar-active)" : "transparent",
    transition: "color 0.14s, background 0.14s",
  };
}

const rowHover = {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
    if (e.currentTarget.dataset.active === "true") return;
    e.currentTarget.style.background = "var(--sidebar-hover)";
    e.currentTarget.style.color = "var(--fg)";
  },
  onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
    if (e.currentTarget.dataset.active === "true") return;
    e.currentTarget.style.background = "";
    e.currentTarget.style.color = "var(--quiet)";
  },
};

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookedUpClip, setLookedUpClip] = useState<Clip | null>(null);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const code = codeInput.trim();
    if (!code || looking) return;
    setLooking(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/clips/lookup?code=${encodeURIComponent(code)}`);
      if (res.ok) {
        const data = await res.json();
        setLookedUpClip(data.clip as Clip);
        setCodeInput("");
      } else if (res.status === 404) {
        setLookupError(`No clip found for "${code}"`);
      } else {
        setLookupError("Lookup failed — try again");
      }
    } catch {
      setLookupError("Lookup failed — try again");
    } finally {
      setLooking(false);
    }
  }

  async function handleSync() {
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
      if (parts.length > 0) window.location.reload();
      setTimeout(() => setSyncResult(null), 4000);
    } catch {
      setSyncResult("Sync failed");
      setTimeout(() => setSyncResult(null), 4000);
    } finally {
      setSyncing(false);
    }
  }

  function navRow(item: { href: string; label: string; icon: React.ReactNode }) {
    const active = isActive(item.href);
    return (
      <Link key={item.href} href={item.href} data-active={active} style={rowStyle(active, collapsed)} title={collapsed ? item.label : undefined} {...rowHover}>
        {active && <span aria-hidden style={{ position: "absolute", top: 6, bottom: 6, left: 0, width: 2, borderRadius: 9999, background: "#C60D60" }} />}
        <span style={{ color: active ? "#C60D60" : "var(--muted)", display: "flex" }}>{item.icon}</span>
        {!collapsed && item.label}
      </Link>
    );
  }

  return (
    <>
      {collapsed && (
        <button
          onClick={onToggle}
          className="fixed z-30"
          style={{ left: 8, top: 8, width: 36, height: 36, borderRadius: 10, border: "1px solid var(--sidebar-border)", background: "var(--sidebar-bg)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          title="Expand sidebar"
        >
          <span className="font-display" style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", lineHeight: 1 }}>F<span style={{ color: "#C60D60" }}>.</span></span>
        </button>
      )}
      <aside
        className="fixed left-0 top-0 bottom-0 flex flex-col z-20"
        style={{ width: collapsed ? 0 : 224, background: "var(--sidebar-bg)", borderRight: collapsed ? "none" : "1px solid var(--sidebar-border)", overflow: "hidden", transition: "width 0.2s ease" }}
      >
        {/* Brand header */}
        <div className="flex items-center" style={{ minHeight: 49, borderBottom: "1px solid var(--sidebar-border)", padding: collapsed ? "14px 0" : "14px 16px", justifyContent: collapsed ? "center" : "space-between" }}>
          {collapsed ? (
            <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }} title="Expand sidebar">
              <span className="font-display" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--fg)", lineHeight: 1 }}>F<span style={{ color: "#C60D60" }}>.</span></span>
            </button>
          ) : (
            <>
              <div className="flex items-center" style={{ lineHeight: 1 }}>
                <span className="font-display" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--fg)" }}>Fraggell</span>
                <span className="font-display" style={{ fontSize: 17, fontWeight: 600, color: "#C60D60" }}>.</span>
                <span className="font-display" style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.015em", color: "var(--muted)" }}>footage</span>
              </div>
              <button onClick={onToggle} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2, display: "flex", alignItems: "center", borderRadius: 6, transition: "color 0.14s" }} title="Collapse sidebar" onMouseEnter={(e) => (e.currentTarget.style.color = "var(--fg)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>
                <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Find a clip by its shareable code */}
        {!collapsed && (
          <div className="px-3 py-3" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
            <form onSubmit={handleLookup}>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--muted)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); if (lookupError) setLookupError(null); }}
                  placeholder="Find clip by code"
                  maxLength={12}
                  disabled={looking}
                  aria-label="Find a clip by its code"
                  className="w-full rounded-md pl-8 pr-3 py-1.5 text-sm transition-colors focus:outline-none disabled:opacity-50"
                  style={{ background: "var(--sidebar-hover)", border: "1px solid var(--sidebar-border)", color: "var(--fg)", fontFamily: "var(--font-geist-mono), 'Geist Mono', monospace" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#C60D60"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--sidebar-border)"; }}
                />
              </div>
              {lookupError && (
                <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "#E0566F" }}>{lookupError}</p>
              )}
            </form>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto" style={{ padding: collapsed ? "8px 4px" : "8px" }}>
          {/* Hub back link */}
          <a href="https://hub.fraggell.com" data-active="false" style={rowStyle(false, collapsed)} title={collapsed ? "Fraggell Hub" : undefined} {...rowHover}>
            <span style={{ color: "var(--muted)", display: "flex" }}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </span>
            {!collapsed && "Fraggell Hub"}
          </a>
          <div style={{ height: 1, background: "var(--sidebar-border)", margin: "4px 0" }} />

          {navItems.map(navRow)}

          {isAdmin && (
            <>
              {!collapsed ? (
                <p style={{ ...monoStyle, paddingTop: "1.25rem", paddingBottom: "0.5rem", paddingLeft: "0.75rem" }}>Admin</p>
              ) : (
                <div style={{ height: 12 }} />
              )}
              {adminItems.map(navRow)}
              <button onClick={handleSync} disabled={syncing} data-active="false" style={{ ...rowStyle(false, collapsed), color: "var(--quiet)", border: "none", cursor: "pointer", opacity: syncing ? 0.5 : 1 }} title={collapsed ? "Sync Drive" : undefined} {...rowHover}>
                <span style={{ color: "var(--muted)", display: "flex" }}>
                  <svg className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </span>
                {!collapsed && (syncing ? "Syncing..." : "Sync Drive")}
              </button>
              {!collapsed && syncResult && (
                <div className="mx-1 mt-1 rounded-lg px-2.5 py-1.5 text-xs leading-snug" style={{ background: "var(--sidebar-hover)", color: syncResult === "Sync failed" ? "#E0566F" : "var(--pink)" }}>
                  {syncResult}
                </div>
              )}
            </>
          )}
        </nav>

        {/* User card */}
        <div style={{ borderTop: "1px solid var(--sidebar-border)" }}>
          {collapsed ? (
            <div style={{ padding: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              {session?.user?.image ? (
                <img src={session.user.image} alt={session.user.name || ""} title={session.user.name || ""} className="rounded-full object-cover" style={{ width: 32, height: 32 }} />
              ) : (
                <div className="flex items-center justify-center rounded-full text-white text-sm font-semibold" style={{ width: 32, height: 32, background: "#C60D60" }} title={session?.user?.name || ""}>{session?.user?.name?.[0] || "?"}</div>
              )}
              <ThemeToggle />
            </div>
          ) : (
            <div className="p-3">
              <div className="flex items-center gap-3 px-2 py-1.5">
                {session?.user?.image ? (
                  <img src={session.user.image} alt={session.user.name || ""} className="flex-shrink-0 rounded-full object-cover" style={{ width: 36, height: 36 }} />
                ) : (
                  <div className="flex-shrink-0 flex items-center justify-center rounded-full text-white text-sm font-semibold" style={{ width: 36, height: 36, background: "#C60D60" }}>{session?.user?.name?.[0] || "?"}</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--fg)" }}>{session?.user?.name}</p>
                  <p className="truncate" style={{ ...monoStyle, textTransform: "none", letterSpacing: "normal" }}>{session?.user?.role}</p>
                </div>
                <div className="flex items-center gap-1">
                  <ThemeToggle />
                  <button onClick={() => signOut()} className="flex items-center justify-center rounded transition-colors" aria-label="Sign out" style={{ color: "var(--muted)", padding: "0.25rem" }} onMouseEnter={(e) => { e.currentTarget.style.color = "#C60D60"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {lookedUpClip && (
        <ClipDetailModal clip={lookedUpClip} onClose={() => setLookedUpClip(null)} />
      )}
    </>
  );
}
