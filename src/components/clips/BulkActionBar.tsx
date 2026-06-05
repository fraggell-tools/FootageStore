"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const SHOT_TYPES = [
  "Close-Up", "Extreme Close-Up", "Medium", "Wide", "Full Body",
  "Over the Shoulder", "POV", "Top Down", "Low Angle", "High Angle", "Tracking",
];

interface SelectedClipSummary {
  id: string;
  tags: string[];
  productSkus: string[];
  shotType: string | null;
}

interface BulkActionBarProps {
  selectedCount: number;
  totalVisible: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAddTags: (tags: string[]) => Promise<void>;
  onBulkAddSkus: (skus: string[]) => Promise<void>;
  onBulkRemoveTags: (tags: string[]) => Promise<void>;
  onBulkRemoveSkus: (skus: string[]) => Promise<void>;
  onBulkSetShotType: (shotType: string) => Promise<void>;
  onBulkDelete: () => Promise<void>;
  onBulkAddToCollection: (collectionId: string) => Promise<boolean>;
  onCreateCollection: (name: string) => Promise<string | null>;
  onBulkDownload: () => void;
  onBulkMove: (targetClientId: string) => Promise<void>;
  existingTags: string[];
  existingSkus: string[];
  selectedClips: SelectedClipSummary[];
  collections: { id: string; name: string; clipCount: number }[];
  clients: { id: string; name: string }[];
}

type ActivePanel = null | "tags" | "skus" | "shotType" | "delete" | "collection" | "move";

// Given a list of clips and a set of known values, compute which values are
// applied to ALL selected clips ("all"), SOME but not all ("some"), or none.
function computeAppliedState(
  existing: string[],
  valuesPerClip: string[][]
): Map<string, "all" | "some"> {
  const state = new Map<string, "all" | "some">();
  if (valuesPerClip.length === 0) return state;
  for (const value of existing) {
    let count = 0;
    for (const clipValues of valuesPerClip) {
      if (clipValues.includes(value)) count++;
    }
    if (count === valuesPerClip.length) state.set(value, "all");
    else if (count > 0) state.set(value, "some");
  }
  return state;
}

export default function BulkActionBar({
  selectedCount,
  totalVisible,
  onSelectAll,
  onDeselectAll,
  onBulkAddTags,
  onBulkAddSkus,
  onBulkRemoveTags,
  onBulkRemoveSkus,
  onBulkSetShotType,
  onBulkDelete,
  onBulkAddToCollection,
  onCreateCollection,
  onBulkDownload,
  onBulkMove,
  existingTags,
  existingSkus,
  selectedClips,
  collections,
  clients,
}: BulkActionBarProps) {
  const tagState = computeAppliedState(existingTags, selectedClips.map((c) => c.tags));
  const skuState = computeAppliedState(existingSkus, selectedClips.map((c) => c.productSkus));
  const shotTypeState = new Map<string, "all" | "some">();
  {
    const shotCounts = new Map<string, number>();
    for (const c of selectedClips) {
      if (c.shotType) shotCounts.set(c.shotType, (shotCounts.get(c.shotType) || 0) + 1);
    }
    for (const [st, count] of shotCounts) {
      shotTypeState.set(st, count === selectedClips.length ? "all" : "some");
    }
  }
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [tagInput, setTagInput] = useState("");
  const [skuInput, setSkuInput] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [moveSearch, setMoveSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleAddTags = useCallback(async () => {
    const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setLoading(true);
    try {
      await onBulkAddTags(tags);
      setTagInput("");
      showToast(`Added ${tags.length} tag${tags.length > 1 ? "s" : ""} to ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
    } finally {
      setLoading(false);
    }
  }, [tagInput, onBulkAddTags, selectedCount, showToast]);

  const handleAddSkus = useCallback(async () => {
    const skus = skuInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (skus.length === 0) return;
    setLoading(true);
    try {
      await onBulkAddSkus(skus);
      setSkuInput("");
      showToast(`Added ${skus.length} SKU${skus.length > 1 ? "s" : ""} to ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
    } finally {
      setLoading(false);
    }
  }, [skuInput, onBulkAddSkus, selectedCount, showToast]);

  const handleSetShotType = useCallback(async (shotType: string) => {
    setLoading(true);
    try {
      await onBulkSetShotType(shotType);
      showToast(`Set shot type to ${shotType} on ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
    } finally {
      setLoading(false);
    }
  }, [onBulkSetShotType, selectedCount, showToast]);

  // Quick-pick handlers for existing tag/SKU pills.
  // If the value is already on ALL selected clips, clicking removes it.
  // Otherwise, clicking adds it (partial → all, none → all).
  const handleQuickToggleTag = useCallback(
    async (tag: string, applied: "all" | "some" | undefined) => {
      setLoading(true);
      try {
        if (applied === "all") {
          await onBulkRemoveTags([tag]);
          showToast(`Removed "${tag}" from ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
        } else {
          await onBulkAddTags([tag]);
          showToast(`Added "${tag}" to ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
        }
      } finally {
        setLoading(false);
      }
    },
    [onBulkAddTags, onBulkRemoveTags, selectedCount, showToast]
  );

  const handleQuickToggleSku = useCallback(
    async (sku: string, applied: "all" | "some" | undefined) => {
      setLoading(true);
      try {
        if (applied === "all") {
          await onBulkRemoveSkus([sku]);
          showToast(`Removed "${sku}" from ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
        } else {
          await onBulkAddSkus([sku]);
          showToast(`Added "${sku}" to ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
        }
      } finally {
        setLoading(false);
      }
    },
    [onBulkAddSkus, onBulkRemoveSkus, selectedCount, showToast]
  );

  const handleConfirmDelete = useCallback(async () => {
    setLoading(true);
    try {
      await onBulkDelete();
      setActivePanel(null);
    } finally {
      setLoading(false);
    }
  }, [onBulkDelete]);

  const handleAddToCollection = useCallback(
    async (collectionId: string, collectionName: string) => {
      setLoading(true);
      try {
        const ok = await onBulkAddToCollection(collectionId);
        if (ok) {
          showToast(`Added to "${collectionName}"`);
        }
      } finally {
        setLoading(false);
      }
    },
    [onBulkAddToCollection, showToast]
  );

  const handleCreateAndAdd = useCallback(
    async () => {
      const name = newCollectionName.trim();
      if (!name) return;
      setLoading(true);
      try {
        const id = await onCreateCollection(name);
        if (id) {
          setNewCollectionName("");
          showToast(`Created "${name}" with ${selectedCount} clip${selectedCount > 1 ? "s" : ""}`);
        }
      } finally {
        setLoading(false);
      }
    },
    [newCollectionName, onCreateCollection, selectedCount, showToast]
  );

  const handleMove = useCallback(
    async (clientId: string, clientName: string) => {
      setLoading(true);
      try {
        await onBulkMove(clientId);
        setActivePanel(null);
        showToast(`Moved ${selectedCount} clip${selectedCount > 1 ? "s" : ""} to ${clientName}`);
      } finally {
        setLoading(false);
      }
    },
    [onBulkMove, selectedCount, showToast]
  );

  // Clear the confirmation message when the user switches panels
  useEffect(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    setMoveSearch("");
  }, [activePanel]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-4 duration-200 flex flex-col items-center gap-2">
      {toast && (
        <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium px-3 py-1.5 rounded-full shadow-lg shadow-black/30 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="truncate max-w-[60ch]">{toast}</span>
        </div>
      )}
      <div className="bg-[#1e1e1e] border border-white/10 rounded-2xl shadow-2xl shadow-black/50 backdrop-blur-xl px-5 py-3 flex items-center gap-4">
        {/* Selection count */}
        <div className="flex items-center gap-3 border-r border-white/10 pr-4">
          <span className="text-sm text-white font-medium">{selectedCount} selected</span>
          {selectedCount < totalVisible ? (
            <button onClick={onSelectAll} className="text-xs text-accent hover:text-accent-hover transition-colors">
              Select all ({totalVisible})
            </button>
          ) : (
            <button onClick={onDeselectAll} className="text-xs text-accent hover:text-accent-hover transition-colors">
              Deselect all
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 relative">
          {/* Add Tags */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "tags" ? null : "tags")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "tags" ? "bg-accent text-white" : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Tags
            </button>
            {activePanel === "tags" && (
              <div className="absolute bottom-full mb-2 left-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-72">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Add tags to {selectedCount} clips</p>
                {existingTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-32 overflow-y-auto">
                    {existingTags.map((tag) => {
                      const applied = tagState.get(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => handleQuickToggleTag(tag, applied)}
                          disabled={loading}
                          title={
                            applied === "all"
                              ? `On all ${selectedCount} — click to remove`
                              : applied === "some"
                                ? `On some — click to add to all ${selectedCount}`
                                : `Click to add to ${selectedCount} clips`
                          }
                          className={`group/pill relative px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
                            applied === "all"
                              ? "bg-accent text-white hover:bg-red-500"
                              : applied === "some"
                                ? "bg-accent/20 text-accent border border-accent/40 hover:bg-accent hover:text-white hover:border-accent"
                                : "bg-white/5 text-neutral-400 hover:text-white hover:bg-accent"
                          }`}
                        >
                          {applied === "all" && (
                            <>
                              <svg className="w-3 h-3 group-hover/pill:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <svg className="w-3 h-3 hidden group-hover/pill:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </>
                          )}
                          {applied === "some" && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-accent group-hover/pill:hidden" />
                              <svg className="w-3 h-3 hidden group-hover/pill:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                            </>
                          )}
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); handleAddTags(); }} className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="+ Custom tag..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={loading || !tagInput.trim()}
                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {loading ? "..." : "Add"}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Add SKUs */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "skus" ? null : "skus")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "skus" ? "bg-emerald-500 text-white" : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              SKU
            </button>
            {activePanel === "skus" && (
              <div className="absolute bottom-full mb-2 left-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-72">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Add SKUs to {selectedCount} clips</p>
                {existingSkus.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-32 overflow-y-auto">
                    {existingSkus.map((sku) => {
                      const applied = skuState.get(sku);
                      return (
                        <button
                          key={sku}
                          onClick={() => handleQuickToggleSku(sku, applied)}
                          disabled={loading}
                          title={
                            applied === "all"
                              ? `On all ${selectedCount} — click to remove`
                              : applied === "some"
                                ? `On some — click to add to all ${selectedCount}`
                                : `Click to add to ${selectedCount} clips`
                          }
                          className={`group/pill relative px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
                            applied === "all"
                              ? "bg-emerald-500 text-white hover:bg-red-500"
                              : applied === "some"
                                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white hover:border-emerald-500"
                                : "bg-emerald-500/10 text-emerald-400 hover:text-white hover:bg-emerald-500"
                          }`}
                        >
                          {applied === "all" && (
                            <>
                              <svg className="w-3 h-3 group-hover/pill:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <svg className="w-3 h-3 hidden group-hover/pill:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </>
                          )}
                          {applied === "some" && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover/pill:hidden" />
                              <svg className="w-3 h-3 hidden group-hover/pill:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                            </>
                          )}
                          {sku}
                        </button>
                      );
                    })}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); handleAddSkus(); }} className="flex gap-2">
                  <input
                    type="text"
                    value={skuInput}
                    onChange={(e) => setSkuInput(e.target.value)}
                    placeholder="+ Custom SKU..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 uppercase"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={loading || !skuInput.trim()}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {loading ? "..." : "Add"}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Set Shot Type */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "shotType" ? null : "shotType")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "shotType" ? "bg-accent text-white" : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Shot Type
            </button>
            {activePanel === "shotType" && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-80">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Set shot type for {selectedCount} clips</p>
                <div className="flex flex-wrap gap-1.5">
                  {SHOT_TYPES.map((type) => {
                    const applied = shotTypeState.get(type);
                    return (
                      <button
                        key={type}
                        onClick={() => handleSetShotType(type)}
                        disabled={loading}
                        title={
                          applied === "all"
                            ? `Already set on all ${selectedCount} clips`
                            : applied === "some"
                              ? `Set on some selected clips`
                              : undefined
                        }
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
                          applied === "all"
                            ? "bg-neutral-500 text-white"
                            : applied === "some"
                              ? "bg-neutral-500/25 text-neutral-200 border border-neutral-500/50"
                              : "bg-white/5 text-neutral-400 hover:text-white hover:bg-accent"
                        }`}
                      >
                        {applied === "all" && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {applied === "some" && <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />}
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Add to Collection */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "collection" ? null : "collection")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "collection" ? "bg-purple-500 text-white" : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              Collection
            </button>
            {activePanel === "collection" && (
              <div className="absolute bottom-full mb-2 left-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-72">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Add {selectedCount} clips to collection</p>
                {collections.length > 0 && (
                  <div className="flex flex-col gap-1 mb-2.5 max-h-40 overflow-y-auto">
                    {collections.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => handleAddToCollection(col.id, col.name)}
                        disabled={loading}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 flex items-center justify-between gap-2 text-neutral-300 hover:text-white hover:bg-purple-500/15"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="truncate">{col.name}</span>
                        </span>
                        <span className="text-[10px] text-neutral-500 flex-shrink-0">{col.clipCount} clips</span>
                      </button>
                    ))}
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); handleCreateAndAdd(); }} className="flex gap-2">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="+ New collection..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={loading || !newCollectionName.trim()}
                    className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {loading ? "..." : "Create"}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Download */}
          <button
            onClick={onBulkDownload}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 text-neutral-400 hover:text-white hover:bg-white/5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>

          {/* Move to client */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "move" ? null : "move")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "move" ? "bg-blue-500 text-white" : "text-neutral-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              Move
            </button>
            {activePanel === "move" && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-72">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">
                  Move {selectedCount} clip{selectedCount > 1 ? "s" : ""} to client
                </p>
                <input
                  type="text"
                  value={moveSearch}
                  onChange={(e) => setMoveSearch(e.target.value)}
                  placeholder="Search clients..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 mb-2"
                  autoFocus
                />
                <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
                  {clients
                    .filter((c) => c.name.toLowerCase().includes(moveSearch.toLowerCase().trim()))
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleMove(c.id, c.name)}
                        disabled={loading}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 flex items-center gap-2 text-neutral-300 hover:text-white hover:bg-blue-500/15"
                      >
                        <svg className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        <span className="truncate">{c.name}</span>
                      </button>
                    ))}
                  {clients.filter((c) => c.name.toLowerCase().includes(moveSearch.toLowerCase().trim())).length === 0 && (
                    <p className="text-xs text-neutral-500 px-2.5 py-1.5">No clients found</p>
                  )}
                </div>
                <p className="text-[10px] text-neutral-500 mt-2 flex items-center gap-1">
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Also moves the files in Google Drive.
                </p>
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="relative">
            <button
              onClick={() => setActivePanel(activePanel === "delete" ? null : "delete")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                activePanel === "delete" ? "bg-red-500 text-white" : "text-neutral-400 hover:text-red-400 hover:bg-white/5"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
            {activePanel === "delete" && (
              <div className="absolute bottom-full mb-2 right-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-72">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm text-white font-medium">Delete {selectedCount} clip{selectedCount > 1 ? "s" : ""}?</p>
                    <p className="text-[11px] text-neutral-400">This will permanently remove the files and cannot be undone.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActivePanel(null)}
                    className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-300 rounded-lg text-xs font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={loading}
                    className="flex-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    {loading ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Close */}
        <div className="border-l border-white/10 pl-3">
          <button
            onClick={onDeselectAll}
            className="text-neutral-500 hover:text-white transition-colors p-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
