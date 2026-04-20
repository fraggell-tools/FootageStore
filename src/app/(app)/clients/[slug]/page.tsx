"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ClipGrid, { type GridSize } from "@/components/clips/ClipGrid";
import ClipDetailModal from "@/components/clips/ClipDetailModal";
import BulkActionBar from "@/components/clips/BulkActionBar";

interface Client {
  id: string;
  name: string;
  slug: string;
  clipCount: number;
  totalStorageBytes: number;
}

interface Clip {
  id: string;
  name: string | null;
  description?: string | null;
  clientId: string;
  clientName: string;
  duration: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  codec: string;
  fps: number;
  originalFilename: string;
  uploadedAt: string;
  hasThumbnail: boolean;
  hasSpriteSheet: boolean;
  shotType?: string | null;
  tags?: string[] | null;
  productSkus?: string[] | null;
  driveFileId?: string | null;
}

interface Collection {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  clipCount: number;
  createdAt: string;
}

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  accentColor,
}: {
  label: string;
  options: [string, number][];
  selected: Set<string>;
  onToggle: (val: string) => void;
  accentColor?: "emerald" | "neutral";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = selected.size;
  // Colours must match the pill colours used on each clip card:
  //   neutral → shot type (grey)
  //   emerald → SKUs
  //   default (accent) → tags
  const activeBg =
    accentColor === "emerald"
      ? "bg-emerald-500"
      : accentColor === "neutral"
        ? "bg-neutral-600"
        : "bg-accent";
  const checkColor =
    accentColor === "emerald"
      ? "text-emerald-400"
      : accentColor === "neutral"
        ? "text-neutral-300"
        : "text-accent";
  // Inactive-state colours — a subtle tinted background + coloured text
  // so each filter's identity is visible even before you select anything.
  const inactiveClasses =
    accentColor === "emerald"
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/50"
      : accentColor === "neutral"
        ? "bg-neutral-500/10 border-neutral-500/30 text-neutral-300 hover:bg-neutral-500/15 hover:border-neutral-500/50"
        : "bg-accent/10 border-accent/30 text-accent hover:bg-accent/15 hover:border-accent/50";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
          activeCount > 0
            ? `${activeBg} text-white border-transparent`
            : inactiveClasses
        }`}
      >
        {label}
        {activeCount > 0 && (
          <span className="bg-white/20 rounded-full px-1.5 py-0.5 text-[10px] leading-none">
            {activeCount}
          </span>
        )}
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 bg-[#252525] border border-white/10 rounded-xl shadow-xl py-1.5 min-w-[180px] max-h-[320px] overflow-y-auto">
          {options.map(([value, count]) => {
            const isActive = selected.has(value);
            return (
              <button
                key={value}
                onClick={() => onToggle(value)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-3 ${
                  isActive ? "text-white bg-white/5" : "text-neutral-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="truncate">{value}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-neutral-600">{count}</span>
                  {isActive && (
                    <svg className={`w-3 h-3 ${checkColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

export default function ClientDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [client, setClient] = useState<Client | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [search, setSearch] = useState("");
  const [selectedShotTypes, setSelectedShotTypes] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const bulkMode = selectedClipIds.size > 0;
  const [orientationFilter, setOrientationFilter] = useState<"all" | "horizontal" | "vertical">("all");
  const [gridSize, setGridSize] = useState<GridSize>("medium");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionClipIds, setCollectionClipIds] = useState<Set<string> | null>(null);

  // Persist grid size preference across sessions
  useEffect(() => {
    const saved = localStorage.getItem("footagestore:gridSize");
    if (saved === "small" || saved === "medium" || saved === "large") {
      setGridSize(saved);
    }
  }, []);

  const changeGridSize = useCallback((size: GridSize) => {
    setGridSize(size);
    localStorage.setItem("footagestore:gridSize", size);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const clientRes = await fetch(`/api/clients`);
        if (!clientRes.ok) return;
        const clientData = await clientRes.json();
        const list = Array.isArray(clientData) ? clientData : clientData.clients || [];
        const foundClient = list.find((c: Client) => c.slug === slug);
        if (!foundClient) return;
        setClient(foundClient);

        // Fetch ALL clips for this client — in-memory filters (shot type,
        // tags, SKUs) need the full set, and the API paginates at 100/page.
        const PAGE_SIZE = 100;
        const firstRes = await fetch(`/api/clips?clientId=${foundClient.id}&limit=${PAGE_SIZE}&page=1`);
        if (!firstRes.ok) return;
        const firstData = await firstRes.json();
        let allClips: Clip[] = firstData.clips || [];
        const totalPages = firstData.pagination?.totalPages ?? 1;
        if (totalPages > 1) {
          const pageNums = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const rest = await Promise.all(
            pageNums.map((p) =>
              fetch(`/api/clips?clientId=${foundClient.id}&limit=${PAGE_SIZE}&page=${p}`)
                .then((r) => (r.ok ? r.json() : { clips: [] }))
                .then((d) => d.clips || [])
            )
          );
          allClips = allClips.concat(...rest);
        }
        setClips(allClips);

        // Fetch collections for this client
        const colRes = await fetch(`/api/collections?clientId=${foundClient.id}`);
        if (colRes.ok) {
          const colData = await colRes.json();
          setCollections(colData.collections || []);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [slug]);

  // When a collection is selected, fetch its clip IDs
  const selectCollection = useCallback(async (collectionId: string | null) => {
    setActiveCollectionId(collectionId);
    if (!collectionId) {
      setCollectionClipIds(null);
      return;
    }
    const res = await fetch(`/api/collections/${collectionId}/clips`);
    if (res.ok) {
      const data = await res.json();
      setCollectionClipIds(new Set(data.clipIds));
    }
  }, []);

  const refreshCollections = useCallback(async () => {
    if (!client) return;
    const res = await fetch(`/api/collections?clientId=${client.id}`);
    if (res.ok) {
      const data = await res.json();
      setCollections(data.collections || []);
    }
  }, [client]);

  // Get unique shot types from clips for filter chips
  const shotTypes = useMemo(() => {
    const types = new Map<string, number>();
    for (const clip of clips) {
      if (clip.shotType) {
        types.set(clip.shotType, (types.get(clip.shotType) || 0) + 1);
      }
    }
    return Array.from(types.entries()).sort((a, b) => b[1] - a[1]);
  }, [clips]);

  // Get unique tags with counts
  const allTags = useMemo(() => {
    const tagMap = new Map<string, number>();
    for (const clip of clips) {
      if (clip.tags) {
        for (const tag of clip.tags) {
          tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
        }
      }
    }
    return Array.from(tagMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [clips]);

  // Get unique product SKUs with counts
  const allSkus = useMemo(() => {
    const skuMap = new Map<string, number>();
    for (const clip of clips) {
      if (clip.productSkus) {
        for (const sku of clip.productSkus) {
          skuMap.set(sku, (skuMap.get(sku) || 0) + 1);
        }
      }
    }
    return Array.from(skuMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [clips]);

  const filteredClips = useMemo(() => {
    const searchTerms = search
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return clips.filter((clip) => {
      // Collection filter
      if (collectionClipIds && !collectionClipIds.has(clip.id)) return false;

      let matchesSearch = true;
      if (searchTerms.length > 0) {
        const haystack = [
          clip.name || "",
          clip.originalFilename || "",
          clip.description || "",
          clip.shotType || "",
          ...(clip.tags || []),
          ...(clip.productSkus || []),
        ]
          .join(" ")
          .toLowerCase();
        matchesSearch = searchTerms.every((term) => haystack.includes(term));
      }
      const matchesShotType = selectedShotTypes.size === 0 || (clip.shotType && selectedShotTypes.has(clip.shotType));
      const matchesTags =
        selectedTags.size === 0 ||
        (clip.tags && Array.from(selectedTags).every((t) => clip.tags!.includes(t)));
      const matchesSkus =
        selectedSkus.size === 0 ||
        (clip.productSkus && Array.from(selectedSkus).every((s) => clip.productSkus!.includes(s)));
      const matchesOrientation =
        orientationFilter === "all" ||
        (orientationFilter === "horizontal" && clip.width >= clip.height) ||
        (orientationFilter === "vertical" && clip.height > clip.width);
      return matchesSearch && matchesShotType && matchesTags && matchesSkus && matchesOrientation;
    });
  }, [clips, search, selectedShotTypes, selectedTags, selectedSkus, collectionClipIds, orientationFilter]);

  const toggleShotType = useCallback((type: string) => {
    setSelectedShotTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const toggleSku = useCallback((sku: string) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) {
        next.delete(sku);
      } else {
        next.add(sku);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedShotTypes(new Set());
    setSelectedTags(new Set());
    setSelectedSkus(new Set());
    setSearch("");
    setOrientationFilter("all");
    setActiveCollectionId(null);
    setCollectionClipIds(null);
  }, []);

  const handleSelect = useCallback((clip: Clip) => {
    setSelectedClip(clip);
  }, []);

  const toggleClipSelection = useCallback((clipId: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedClipIds(new Set(filteredClips.map((c) => c.id)));
  }, [filteredClips]);

  const deselectAll = useCallback(() => {
    setSelectedClipIds(new Set());
  }, []);

  const handleBulkAddTags = useCallback(async (tags: string[]) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds, action: "addTags", value: tags }),
    });
    if (res.ok) {
      const { updatedClips } = await res.json();
      setClips((prev) =>
        prev.map((c) => {
          const u = updatedClips.find((x: Clip) => x.id === c.id);
          return u ? { ...c, tags: u.tags } : c;
        })
      );
    }
  }, [selectedClipIds]);

  const handleBulkAddSkus = useCallback(async (skus: string[]) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds, action: "addSkus", value: skus }),
    });
    if (res.ok) {
      const { updatedClips } = await res.json();
      setClips((prev) =>
        prev.map((c) => {
          const u = updatedClips.find((x: Clip) => x.id === c.id);
          return u ? { ...c, productSkus: u.productSkus } : c;
        })
      );
    }
  }, [selectedClipIds]);

  const handleBulkRemoveTags = useCallback(async (tags: string[]) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds, action: "removeTags", value: tags }),
    });
    if (res.ok) {
      const { updatedClips } = await res.json();
      setClips((prev) =>
        prev.map((c) => {
          const u = updatedClips.find((x: Clip) => x.id === c.id);
          return u ? { ...c, tags: u.tags } : c;
        })
      );
    }
  }, [selectedClipIds]);

  const handleBulkRemoveSkus = useCallback(async (skus: string[]) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds, action: "removeSkus", value: skus }),
    });
    if (res.ok) {
      const { updatedClips } = await res.json();
      setClips((prev) =>
        prev.map((c) => {
          const u = updatedClips.find((x: Clip) => x.id === c.id);
          return u ? { ...c, productSkus: u.productSkus } : c;
        })
      );
    }
  }, [selectedClipIds]);

  const handleBulkSetShotType = useCallback(async (shotType: string) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds, action: "setShotType", value: shotType }),
    });
    if (res.ok) {
      setClips((prev) =>
        prev.map((c) => selectedClipIds.has(c.id) ? { ...c, shotType } : c)
      );
    }
  }, [selectedClipIds]);

  const handleBulkDelete = useCallback(async () => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/clips/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds }),
    });
    if (res.ok) {
      setClips((prev) => prev.filter((c) => !selectedClipIds.has(c.id)));
      setSelectedClipIds(new Set());
    }
  }, [selectedClipIds]);

  const handleBulkAddToCollection = useCallback(async (collectionId: string) => {
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch(`/api/collections/${collectionId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds }),
    });
    if (res.ok) {
      await refreshCollections();
      // If viewing this collection, refresh the clip IDs
      if (activeCollectionId === collectionId) {
        const r = await fetch(`/api/collections/${collectionId}/clips`);
        if (r.ok) {
          const d = await r.json();
          setCollectionClipIds(new Set(d.clipIds));
        }
      }
    }
    return res.ok;
  }, [selectedClipIds, refreshCollections, activeCollectionId]);

  const handleCreateCollection = useCallback(async (name: string): Promise<string | null> => {
    if (!client) return null;
    const clipIds = Array.from(selectedClipIds);
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, clientId: client.id, clipIds }),
    });
    if (res.ok) {
      const data = await res.json();
      await refreshCollections();
      return data.collection.id;
    }
    return null;
  }, [client, selectedClipIds, refreshCollections]);

  const handleBulkDownload = useCallback(() => {
    const ids = Array.from(selectedClipIds);
    ids.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/clips/${id}/download`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 300);
    });
  }, [selectedClipIds]);

  // Single-clip collection handlers (used by ClipCard + ClipDetailModal)
  const handleAddClipToCollection = useCallback(async (clipId: string, collectionId: string) => {
    await fetch(`/api/collections/${collectionId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds: [clipId] }),
    });
    await refreshCollections();
  }, [refreshCollections]);

  const handleCreateCollectionForClip = useCallback(async (clipId: string, name: string) => {
    if (!client) return;
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, clientId: client.id, clipIds: [clipId] }),
    });
    if (res.ok) {
      await refreshCollections();
    }
  }, [client, refreshCollections]);

  const handleRemoveClipFromCollection = useCallback(async (clipId: string, collectionId: string) => {
    await fetch(`/api/collections/${collectionId}/clips`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds: [clipId] }),
    });
    await refreshCollections();
    // Refresh the active collection view if needed
    if (activeCollectionId === collectionId) {
      const r = await fetch(`/api/collections/${collectionId}/clips`);
      if (r.ok) {
        const d = await r.json();
        setCollectionClipIds(new Set(d.clipIds));
      }
    }
  }, [refreshCollections, activeCollectionId]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-surface rounded" />
          <div className="h-4 w-32 bg-surface rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-8">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="aspect-video bg-surface rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 text-center py-20">
        <p className="text-muted">Client not found</p>
        <Link href="/clients" className="text-accent hover:text-accent-hover text-sm mt-2 inline-block">
          Back to clients
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/clients"
          className="text-muted hover:text-white text-sm flex items-center gap-1 mb-3 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Clients
          <span className="text-border mx-1">/</span>
          <span className="text-white">{client.name}</span>
        </Link>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">{client.name}</h1>
            <p className="text-muted text-sm mt-1">
              {clips.length} clip{clips.length !== 1 ? "s" : ""}
              {client.totalStorageBytes > 0 && (
                <span className="ml-2">
                  &middot; {formatBytes(client.totalStorageBytes)}
                </span>
              )}
            </p>
          </div>

          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search clips..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-surface border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent w-64"
            />
          </div>
        </div>

        {/* Filters + size picker */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          {/* Shot type dropdown */}
            {shotTypes.length > 0 && (
              <FilterDropdown
                label="Shot Type"
                options={shotTypes}
                selected={selectedShotTypes}
                onToggle={toggleShotType}
                accentColor="neutral"
              />
            )}

            {/* Tags dropdown */}
            {allTags.length > 0 && (
              <FilterDropdown
                label="Tags"
                options={allTags}
                selected={selectedTags}
                onToggle={toggleTag}
              />
            )}

            {/* SKUs dropdown */}
            {allSkus.length > 0 && (
              <FilterDropdown
                label="SKU"
                options={allSkus}
                selected={selectedSkus}
                onToggle={toggleSku}
                accentColor="emerald"
              />
            )}

            {/* Orientation filter */}
            <div className="flex items-center bg-surface border border-border rounded-lg p-0.5">
              <button
                onClick={() => setOrientationFilter("all")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  orientationFilter === "all" ? "bg-accent text-white" : "text-neutral-400 hover:text-white"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setOrientationFilter("horizontal")}
                title="Horizontal / Landscape"
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 text-xs font-medium ${
                  orientationFilter === "horizontal" ? "bg-accent text-white" : "text-neutral-400 hover:text-white"
                }`}
              >
                <svg className="w-4 h-3" fill="none" viewBox="0 0 20 14" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="1" y="1" width="18" height="12" rx="2" />
                </svg>
              </button>
              <button
                onClick={() => setOrientationFilter("vertical")}
                title="Vertical / Portrait"
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 text-xs font-medium ${
                  orientationFilter === "vertical" ? "bg-accent text-white" : "text-neutral-400 hover:text-white"
                }`}
              >
                <svg className="w-3 h-4" fill="none" viewBox="0 0 14 20" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="1" y="1" width="12" height="18" rx="2" />
                </svg>
              </button>
            </div>

            {/* Active filters & clear */}
            {(selectedShotTypes.size > 0 || selectedTags.size > 0 || selectedSkus.size > 0 || orientationFilter !== "all") && (
              <>
                <span className="text-xs text-muted ml-1">
                  {[
                    selectedShotTypes.size > 0 && `${selectedShotTypes.size} shot${selectedShotTypes.size > 1 ? "s" : ""}`,
                    selectedTags.size > 0 && `${selectedTags.size} tag${selectedTags.size > 1 ? "s" : ""}`,
                    selectedSkus.size > 0 && `${selectedSkus.size} SKU${selectedSkus.size > 1 ? "s" : ""}`,
                    orientationFilter !== "all" && orientationFilter,
                  ].filter(Boolean).join(" + ")}
                </span>
                <button
                  onClick={clearFilters}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  Clear
                </button>
              </>
            )}

            {/* Size picker — pushed to the right */}
            <div className="ml-auto flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5">
              {(["small", "medium", "large"] as const).map((size) => {
                const isActive = gridSize === size;
                return (
                  <button
                    key={size}
                    onClick={() => changeGridSize(size)}
                    title={`${size[0].toUpperCase()}${size.slice(1)} grid`}
                    className={`p-1.5 rounded transition-colors ${
                      isActive ? "bg-accent text-white" : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    {size === "small" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="5" height="5" rx="1" />
                        <rect x="10" y="3" width="5" height="5" rx="1" />
                        <rect x="17" y="3" width="4" height="5" rx="1" />
                        <rect x="3" y="10" width="5" height="5" rx="1" />
                        <rect x="10" y="10" width="5" height="5" rx="1" />
                        <rect x="17" y="10" width="4" height="5" rx="1" />
                        <rect x="3" y="17" width="5" height="4" rx="1" />
                        <rect x="10" y="17" width="5" height="4" rx="1" />
                        <rect x="17" y="17" width="4" height="4" rx="1" />
                      </svg>
                    )}
                    {size === "medium" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="8" height="8" rx="1" />
                        <rect x="13" y="3" width="8" height="8" rx="1" />
                        <rect x="3" y="13" width="8" height="8" rx="1" />
                        <rect x="13" y="13" width="8" height="8" rx="1" />
                      </svg>
                    )}
                    {size === "large" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="18" height="8" rx="1" />
                        <rect x="3" y="13" width="18" height="8" rx="1" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
      </div>

      {/* Collections bar */}
      {collections.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[11px] text-muted uppercase tracking-wider mr-1">Collections</span>
          <button
            onClick={() => selectCollection(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
              activeCollectionId === null
                ? "bg-white/10 border-white/20 text-white"
                : "bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
            }`}
          >
            All clips
          </button>
          {collections.map((col) => (
            <button
              key={col.id}
              onClick={() => selectCollection(col.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border flex items-center gap-1.5 ${
                activeCollectionId === col.id
                  ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : "bg-purple-500/5 border-purple-500/20 text-purple-300/60 hover:text-purple-300 hover:bg-purple-500/15"
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              {col.name}
              <span className="text-[10px] opacity-60">({col.clipCount})</span>
            </button>
          ))}
        </div>
      )}

      {filteredClips.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted">
            {search || selectedShotTypes.size > 0 || selectedTags.size > 0 || selectedSkus.size > 0 || orientationFilter !== "all" || activeCollectionId
              ? "No clips match your filters"
              : "No clips uploaded yet"}
          </p>
        </div>
      ) : (
        <div className={bulkMode ? "pb-20" : ""}>
          <ClipGrid
            clips={filteredClips}
            onSelect={handleSelect}
            selectedIds={selectedClipIds}
            onToggleSelect={toggleClipSelection}
            bulkMode={bulkMode}
            size={gridSize}
            collections={collections}
            onAddToCollection={handleAddClipToCollection}
            onCreateCollection={handleCreateCollectionForClip}
          />
        </div>
      )}

      {bulkMode && (
        <BulkActionBar
          selectedCount={selectedClipIds.size}
          totalVisible={filteredClips.length}
          onSelectAll={selectAllVisible}
          onDeselectAll={deselectAll}
          onBulkAddTags={handleBulkAddTags}
          onBulkAddSkus={handleBulkAddSkus}
          onBulkRemoveTags={handleBulkRemoveTags}
          onBulkRemoveSkus={handleBulkRemoveSkus}
          onBulkSetShotType={handleBulkSetShotType}
          onBulkDelete={handleBulkDelete}
          onBulkAddToCollection={handleBulkAddToCollection}
          onCreateCollection={handleCreateCollection}
          onBulkDownload={handleBulkDownload}
          existingTags={allTags.map(([tag]) => tag)}
          existingSkus={allSkus.map(([sku]) => sku)}
          collections={collections}
          selectedClips={clips.filter((c) => selectedClipIds.has(c.id)).map((c) => ({
            id: c.id,
            tags: c.tags || [],
            productSkus: c.productSkus || [],
            shotType: c.shotType || null,
          }))}
        />
      )}

      {selectedClip && (
        <ClipDetailModal
          clip={selectedClip}
          onClose={() => setSelectedClip(null)}
          onDelete={(clipId) => {
            setClips((prev) => prev.filter((c) => c.id !== clipId));
            setSelectedClip(null);
          }}
          onUpdate={(clipId, updates) => {
            setClips((prev) =>
              prev.map((c) => (c.id === clipId ? { ...c, ...updates } : c))
            );
            setSelectedClip((prev) => prev ? { ...prev, ...updates } : prev);
          }}
          collections={collections}
          onAddToCollection={handleAddClipToCollection}
          onRemoveFromCollection={handleRemoveClipFromCollection}
          onCreateCollection={handleCreateCollectionForClip}
        />
      )}
    </div>
  );
}
