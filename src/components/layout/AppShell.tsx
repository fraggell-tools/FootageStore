"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";

const COLLAPSED_KEY = "fg-sidebar-collapsed";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "true");
    setMounted(true);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, String(next));
  }

  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main
        style={{
          marginLeft: mounted ? (collapsed ? 0 : 224) : 224,
          paddingLeft: mounted && collapsed ? 52 : 0,
          minHeight: "100vh",
          transition: "margin-left 0.2s ease, padding-left 0.2s ease",
        }}
      >
        {children}
      </main>
    </div>
  );
}
