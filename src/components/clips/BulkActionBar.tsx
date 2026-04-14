"use client";

import { useState, useCallback } from "react";

const SHOT_TYPES = [
  "Close-Up", "Extreme Close-Up", "Medium", "Wide", "Full Body",
  "Over the Shoulder", "POV", "Top Down", "Low Angle", "High Angle", "Tracking",
];

interface BulkActionBarProps {
  selectedCount: number;
  totalVisible: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAddTags: (tags: string[]) => Promise<void>;
  onBulkAddSkus: (skus: string[]) => Promise<void>;
  onBulkSetShotType: (shotType: string) => Promise<void>;
  onBulkDownload: () => void;
}

type ActivePanel = null | "tags" | "skus" | "shotType";

export default function BulkActionBar({
  selectedCount,
  totalVisible,
  onSelectAll,
  onDeselectAll,
  onBulkAddTags,
  onBulkAddSkus,
  onBulkSetShotType,
  onBulkDownload,
}: BulkActionBarProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [tagInput, setTagInput] = useState("");
  const [skuInput, setSkuInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAddTags = useCallback(async () => {
    const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) return;
    setLoading(true);
    try {
      await onBulkAddTags(tags);
      setTagInput("");
      setActivePanel(null);
    } finally {
      setLoading(false);
    }
  }, [tagInput, onBulkAddTags]);

  const handleAddSkus = useCallback(async () => {
    const skus = skuInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (skus.length === 0) return;
    setLoading(true);
    try {
      await onBulkAddSkus(skus);
      setSkuInput("");
      setActivePanel(null);
    } finally {
      setLoading(false);
    }
  }, [skuInput, onBulkAddSkus]);

  const handleSetShotType = useCallback(async (shotType: string) => {
    setLoading(true);
    try {
      await onBulkSetShotType(shotType);
      setActivePanel(null);
    } finally {
      setLoading(false);
    }
  }, [onBulkSetShotType]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-4 duration-200">
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
              <div className="absolute bottom-full mb-2 left-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-64">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Add tags to {selectedCount} clips</p>
                <form onSubmit={(e) => { e.preventDefault(); handleAddTags(); }} className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="Tag1, Tag2..."
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
              <div className="absolute bottom-full mb-2 left-0 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-64">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Add SKUs to {selectedCount} clips</p>
                <form onSubmit={(e) => { e.preventDefault(); handleAddSkus(); }} className="flex gap-2">
                  <input
                    type="text"
                    value={skuInput}
                    onChange={(e) => setSkuInput(e.target.value)}
                    placeholder="SKU1, SKU2..."
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
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#252525] border border-white/10 rounded-xl p-3 shadow-xl w-56">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-2">Set shot type for {selectedCount} clips</p>
                <div className="flex flex-wrap gap-1.5">
                  {SHOT_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => handleSetShotType(type)}
                      disabled={loading}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 text-neutral-400 hover:text-white hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      {type}
                    </button>
                  ))}
                </div>
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
