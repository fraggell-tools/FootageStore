"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";

export interface ClientRow {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  clipCount: number;
  thumbnailClipId: string | null;
}

type TileSize = "S" | "M" | "L";
type SortMode = "az" | "za" | "most" | "fewest";
const SIZE_KEY = "fg-footage-clients-size";
const SORT_KEY = "fg-footage-clients-sort";
const SIZES: Record<TileSize, { min: number; max: number }> = {
  S: { min: 120, max: 150 },
  M: { min: 170, max: 200 },
  L: { min: 240, max: 280 },
};
const SORT_LABELS: Record<SortMode, string> = {
  az: "A-Z",
  za: "Z-A",
  most: "Most clips",
  fewest: "Fewest clips",
};

function ClientCard({ client, size }: { client: ClientRow; size: TileSize }) {
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setThumbLoaded(true);
  }, []);
  const sm = size === "S";
  const mark = sm ? 28 : 36;
  const label = client.displayName || client.name;
  const hasThumb = client.thumbnailClipId != null && thumbLoaded;

  return (
    <div style={{ position: "relative" }}>
      <Link
        href={`/clients/${client.slug}`}
        style={{
          position: "relative",
          display: "block",
          textDecoration: "none",
          color: "inherit",
          transition: "transform 0.16s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-3px)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
      >
        {/* stacked-card layers behind */}
        <div style={{ position: "absolute", top: 6, left: 6, right: -6, bottom: -6, background: "var(--color-border)", borderRadius: 12, opacity: 0.5, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 3, left: 3, right: -3, bottom: -3, background: "var(--color-border)", borderRadius: 12, opacity: 0.3, pointerEvents: "none" }} />
        <div
          style={{
            position: "relative",
            background: "var(--color-surface)",
            border: "1.5px solid var(--color-border)",
            borderRadius: 12,
            padding: sm ? "14px 14px" : "20px 18px",
            display: "flex",
            flexDirection: "column",
            aspectRatio: "5 / 3",
            justifyContent: "space-between",
            gap: sm ? 10 : 14,
            zIndex: 1,
            transition: "border-color 0.16s",
            overflow: "hidden",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(198,13,96,0.35)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
        >
          {client.thumbnailClipId != null && (
            <img
              ref={imgRef}
              src={`/api/assets/${client.thumbnailClipId}/thumbnail.jpg`}
              alt=""
              loading="lazy"
              onLoad={() => setThumbLoaded(true)}
              onError={() => {}}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: thumbLoaded ? 1 : 0, transition: "opacity 0.3s" }}
            />
          )}
          {hasThumb && (
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)" }} />
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 1 }}>
            {!hasThumb && (
              <div style={{
                width: mark, height: mark, borderRadius: 10,
                background: "var(--pink)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-sora), Sora, sans-serif", fontWeight: 800,
                fontSize: sm ? 12 : 15, color: "#fff",
              }}>
                {label[0]?.toUpperCase()}
              </div>
            )}
            <span style={{
              fontSize: 10, fontFamily: "var(--font-sora), Sora, sans-serif", fontWeight: 600,
              color: hasThumb ? "#fff" : "var(--color-muted)",
              background: hasThumb ? "rgba(0,0,0,0.5)" : "var(--color-surface-hover)",
              backdropFilter: hasThumb ? "blur(4px)" : undefined,
              padding: "3px 8px", borderRadius: 6,
              marginLeft: hasThumb ? "auto" : undefined,
            }}>
              {client.clipCount.toLocaleString()} clip{client.clipCount !== 1 ? "s" : ""}
            </span>
          </div>

          <span style={{
            fontFamily: "var(--font-sora), Sora, sans-serif", fontWeight: 700,
            fontSize: sm ? 12 : 14, color: hasThumb ? "#fff" : "var(--color-fg)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            position: "relative", zIndex: 1,
          }}>
            {label}
          </span>
        </div>
      </Link>
    </div>
  );
}

function ToolbarButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        fontFamily: "var(--font-sora), Sora, sans-serif", fontSize: 12, fontWeight: 500,
        color: "var(--color-fg)", background: "transparent",
        border: "1.5px solid var(--color-border)", borderRadius: 10,
        padding: "5px 10px", cursor: "pointer",
        transition: "border-color 0.14s, color 0.14s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-fg)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
    >
      {children}
    </button>
  );
}

export default function ClientsGrid({ clients }: { clients: ClientRow[] }) {
  const [size, setSize] = useState<TileSize>("M");
  const [sort, setSort] = useState<SortMode>("az");

  useEffect(() => {
    const s = localStorage.getItem(SIZE_KEY);
    if (s === "S" || s === "M" || s === "L") setSize(s);
    const so = localStorage.getItem(SORT_KEY);
    if (so === "az" || so === "za" || so === "most" || so === "fewest") setSort(so);
  }, []);

  function cycleSize() {
    const next: TileSize = size === "S" ? "M" : size === "M" ? "L" : "S";
    setSize(next);
    localStorage.setItem(SIZE_KEY, next);
  }
  function cycleSort() {
    const order: SortMode[] = ["az", "za", "most", "fewest"];
    const next = order[(order.indexOf(sort) + 1) % order.length];
    setSort(next);
    localStorage.setItem(SORT_KEY, next);
  }

  const sorted = [...clients].sort((a, b) => {
    const an = (a.displayName || a.name).toLowerCase();
    const bn = (b.displayName || b.name).toLowerCase();
    switch (sort) {
      case "za": return bn.localeCompare(an);
      case "most": return b.clipCount - a.clipCount;
      case "fewest": return a.clipCount - b.clipCount;
      default: return an.localeCompare(bn);
    }
  });

  return (
    <div className="p-8">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, paddingBottom: 24, borderBottom: "1px solid var(--color-border)", marginBottom: 32 }}>
        <h1 className="font-display" style={{ fontWeight: 800, fontSize: "clamp(28px, 4vw, 44px)", letterSpacing: "-0.025em", lineHeight: 1, margin: 0, color: "var(--color-fg)" }}>
          Clients
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: "var(--color-muted)" }}>
            {clients.length} client{clients.length !== 1 ? "s" : ""}
          </span>
          <ToolbarButton onClick={cycleSort} title={`Sort: ${SORT_LABELS[sort]}`}>
            <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
            </svg>
            {SORT_LABELS[sort]}
          </ToolbarButton>
          <ToolbarButton onClick={cycleSize} title={`${size === "S" ? "Small" : size === "M" ? "Medium" : "Large"} tiles`}>
            <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
            </svg>
            {size}
          </ToolbarButton>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "var(--color-muted)" }}>No clients yet</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${SIZES[size].min}px, ${SIZES[size].max}px))`, gap: 16 }}>
          {sorted.map((client) => (
            <ClientCard key={client.id} client={client} size={size} />
          ))}
        </div>
      )}
    </div>
  );
}
