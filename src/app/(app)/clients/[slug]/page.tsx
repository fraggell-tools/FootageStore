"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ClipGrid from "@/components/clips/ClipGrid";
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
  const [selectedShotType, setSelectedShotType] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const bulkMode = selectedClipIds.size > 0;

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

        const clipsRes = await fetch(`/api/clips?clientId=${foundClient.id}`);
        if (!clipsRes.ok) return;
        const clipsData = await clipsRes.json();
        setClips(clipsData.clips || []);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [slug]);

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
    return clips.filter((clip) => {
      const matchesSearch = (clip.name || clip.originalFilename || "")
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesShotType = !selectedShotType || clip.shotType === selectedShotType;
      const matchesTags =
        selectedTags.size === 0 ||
        (clip.tags && Array.from(selectedTags).every((t) => clip.tags!.includes(t)));
      const matchesSkus =
        selectedSkus.size === 0 ||
        (clip.productSkus && Array.from(selectedSkus).every((s) => clip.productSkus!.includes(s)));
      return matchesSearch && matchesShotType && matchesTags && matchesSkus;
    });
  }, [clips, search, selectedShotType, selectedTags, selectedSkus]);

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
    setSelectedShotType(null);
    setSelectedTags(new Set());
    setSelectedSkus(new Set());
    setSearch("");
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
          return u ? { ...c, productSkus: u.product_skus } : c;
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

        {/* Filters */}
        {(shotTypes.length > 0 || allTags.length > 0 || allSkus.length > 0) && (
          <div className="mt-4 space-y-3">
            {/* Shot type row */}
            {shotTypes.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Shot</span>
                <button
                  onClick={() => setSelectedShotType(null)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedShotType === null
                      ? "bg-accent text-white"
                      : "bg-surface border border-border text-neutral-400 hover:text-white hover:border-neutral-600"
                  }`}
                >
                  All
                </button>
                {shotTypes.map(([type, count]) => (
                  <button
                    key={type}
                    onClick={() =>
                      setSelectedShotType(selectedShotType === type ? null : type)
                    }
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedShotType === type
                        ? "bg-accent text-white"
                        : "bg-surface border border-border text-neutral-400 hover:text-white hover:border-neutral-600"
                    }`}
                  >
                    {type}
                    <span className="ml-1 opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Tags row */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wider w-16 flex-shrink-0">Tags</span>
                {allTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedTags.has(tag)
                        ? "bg-accent text-white"
                        : "bg-surface border border-border text-neutral-400 hover:text-white hover:border-neutral-600"
                    }`}
                  >
                    {tag}
                    <span className="ml-1 opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* SKUs row */}
            {allSkus.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted uppercase tracking-wider w-16 flex-shrink-0">SKU</span>
                {allSkus.map(([sku, count]) => (
                  <button
                    key={sku}
                    onClick={() => toggleSku(sku)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedSkus.has(sku)
                        ? "bg-emerald-500 text-white"
                        : "bg-surface border border-border text-neutral-400 hover:text-white hover:border-neutral-600"
                    }`}
                  >
                    {sku}
                    <span className="ml-1 opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Active filter count & clear */}
            {(selectedShotType || selectedTags.size > 0 || selectedSkus.size > 0) && (
              <button
                onClick={clearFilters}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {filteredClips.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted">
            {search || selectedShotType || selectedTags.size > 0 || selectedSkus.size > 0
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
          onBulkSetShotType={handleBulkSetShotType}
          onBulkDownload={handleBulkDownload}
          existingTags={allTags.map(([tag]) => tag)}
          existingSkus={allSkus.map(([sku]) => sku)}
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
        />
      )}
    </div>
  );
}
