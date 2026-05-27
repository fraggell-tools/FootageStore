"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface Clip {
  id: string;
  code?: string | null;
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
  driveFileId?: string | null;
  // Legacy fields for backward compat
  status?: string;
  thumbnailPath?: string | null;
  spriteSheetPath?: string | null;
  fileSize?: number;
}

interface CollectionSummary {
  id: string;
  name: string;
  clipCount: number;
}

interface ClipCardProps {
  clip: Clip;
  onSelect: (clip: Clip) => void;
  isSelected?: boolean;
  onToggleSelect?: (clipId: string) => void;
  bulkMode?: boolean;
  collections?: CollectionSummary[];
  onAddToCollection?: (clipId: string, collectionId: string) => Promise<void>;
  onCreateCollection?: (clipId: string, name: string) => Promise<void>;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function ClipCard({ clip, onSelect, isSelected, onToggleSelect, bulkMode, collections, onAddToCollection, onCreateCollection }: ClipCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [skimPercent, setSkimPercent] = useState<number | null>(null);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const collectionPickerRef = useRef<HTMLDivElement>(null);
  const collectionListRef = useRef<HTMLDivElement>(null);
  const [collectionListScrollable, setCollectionListScrollable] = useState(false);
  const [collectionListAtBottom, setCollectionListAtBottom] = useState(false);

  useEffect(() => {
    if (!showCollectionPicker) return;
    const el = collectionListRef.current;
    if (!el) return;
    const update = () => {
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      setCollectionListScrollable(scrollable);
      setCollectionListAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
    };
    update();
    el.addEventListener("scroll", update);
    return () => el.removeEventListener("scroll", update);
  }, [showCollectionPicker, collections?.length]);

  const hasThumbnail = clip.hasThumbnail || !!clip.thumbnailPath;
  const hasSpriteSheet = clip.hasSpriteSheet || !!clip.spriteSheetPath;
  const isProcessing = clip.status === "processing" || clip.status === "uploading";
  const isPortrait = clip.height > clip.width;

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setSkimPercent(Math.max(0, Math.min(1, x / rect.width)));
  }, []);

  const handleMouseLeave = useCallback(() => {
    setSkimPercent(null);
  }, []);

  // Sprite sheet: 8x8 grid = 64 frames
  const spriteStyle =
    skimPercent !== null && hasSpriteSheet
      ? (() => {
          const frameIndex = Math.floor(skimPercent * 63);
          const col = frameIndex % 8;
          const row = Math.floor(frameIndex / 8);
          return {
            backgroundImage: `url(/api/assets/${clip.id}/sprite.jpg?v=2)`,
            backgroundSize: "800% 800%",
            backgroundPosition: `${(col / 7) * 100}% ${(row / 7) * 100}%`,
          };
        })()
      : undefined;

  return (
    <div
      className={`clip-card bg-surface border rounded-xl overflow-hidden cursor-pointer transition-all group hover:shadow-lg hover:shadow-black/20 ${
        isSelected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-neutral-600"
      }`}
      onClick={() => bulkMode && onToggleSelect ? onToggleSelect(clip.id) : onSelect(clip)}
    >
      {/* Thumbnail area — natural aspect ratio */}
      <div
        ref={containerRef}
        className="relative overflow-hidden"
        style={{ aspectRatio: clip.width && clip.height ? `${clip.width}/${clip.height}` : "16/9" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Selection checkbox */}
        {onToggleSelect && (
          <div
            className={`absolute top-2 left-2 z-20 w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${
              isSelected ? "bg-accent border-accent" : "bg-black/40 border-white/40 hover:border-white/70"
            } ${bulkMode ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(clip.id); }}
          >
            {isSelected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* Base thumbnail or gradient placeholder */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
          <svg className="w-8 h-8 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        {hasThumbnail && (
          <img
            src={`/api/assets/${clip.id}/thumbnail.jpg`}
            alt={clip.name || clip.originalFilename}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${thumbLoaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={() => setThumbLoaded(true)}
          />
        )}

        {/* Sprite sheet overlay on hover */}
        {spriteStyle && (
          <div className="absolute inset-0" style={spriteStyle} />
        )}

        {/* Skim progress bar */}
        {skimPercent !== null && (
          <>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40 z-10" />
            <div
              className="absolute bottom-0 left-0 h-1 bg-accent shadow-[0_0_6px_rgba(59,130,246,0.7)] z-10"
              style={{ width: `${skimPercent * 100}%` }}
            />
          </>
        )}

        {/* Duration badge — hide for images */}
        {clip.duration > 0 && !/\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(clip.originalFilename) && (
          <div className="absolute top-2 right-2 z-10">
            <span className="px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded text-xs text-white/80">
              {formatDuration(clip.duration)}
            </span>
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
            <div className="flex items-center gap-2 text-white text-sm">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </div>
          </div>
        )}

        {/* Action buttons on hover */}
        <div className="absolute bottom-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
          {/* Add to collection */}
          {collections && collections.length > 0 && onAddToCollection && (
            <div className="relative" ref={collectionPickerRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCollectionPicker(!showCollectionPicker); }}
                title="Add to collection"
                className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg transition-colors ${
                  showCollectionPicker ? "bg-purple-500" : "bg-black/70 hover:bg-purple-500"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </button>
              {showCollectionPicker && (
                <div
                  className="absolute bottom-full mb-2 right-0 bg-[#252525] border border-white/10 rounded-xl p-2 shadow-xl w-52 z-30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-[10px] text-muted uppercase tracking-wider px-1.5 mb-1.5">Add to collection</p>
                  <div className="relative mb-1.5">
                    <div
                      ref={collectionListRef}
                      className="flex flex-col gap-0.5 max-h-36 overflow-y-auto"
                    >
                      {collections.map((col) => (
                        <button
                          key={col.id}
                          onClick={async (e) => {
                            e.stopPropagation();
                            await onAddToCollection(clip.id, col.id);
                            setShowCollectionPicker(false);
                          }}
                          className="w-full text-left px-2 py-1 rounded text-xs text-neutral-300 hover:text-white hover:bg-purple-500/15 transition-colors truncate flex items-center gap-1.5"
                        >
                          <svg className="w-3 h-3 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                          </svg>
                          <span className="truncate">{col.name}</span>
                        </button>
                      ))}
                    </div>
                    {collectionListScrollable && !collectionListAtBottom && (
                      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#252525] to-transparent rounded-b" />
                    )}
                  </div>
                  {onCreateCollection && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const name = newColName.trim();
                        if (!name) return;
                        await onCreateCollection(clip.id, name);
                        setNewColName("");
                        setShowCollectionPicker(false);
                      }}
                      className="flex gap-1"
                    >
                      <input
                        type="text"
                        value={newColName}
                        onChange={(e) => setNewColName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="+ New..."
                        className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder-neutral-500 focus:outline-none focus:border-purple-500 min-w-0"
                      />
                      <button
                        type="submit"
                        disabled={!newColName.trim()}
                        className="px-2 py-1 bg-purple-500 hover:bg-purple-600 disabled:opacity-40 text-white rounded text-[11px] font-medium transition-colors flex-shrink-0"
                      >
                        Add
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
          {clip.driveFileId && (
            <a
              href={`https://drive.google.com/file/d/${clip.driveFileId}/view`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open in Google Drive"
              className="w-8 h-8 rounded-full bg-black/70 hover:bg-[#1a73e8] flex items-center justify-center text-white shadow-lg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.71 3.5L1.15 15l3.43 5.95L11.14 9.45zM14.29 3.5H7.71l6.56 11.38h6.58zM16.57 15.88H9.99L6.56 21.83h13.02z" />
              </svg>
            </a>
          )}
          <a
            href={`/api/clips/${clip.id}/download`}
            onClick={(e) => e.stopPropagation()}
            title="Download original"
            aria-label="Download original"
            className="w-8 h-8 rounded-full bg-black/70 hover:bg-accent flex items-center justify-center text-white shadow-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      </div>

      {/* Clip name + metadata pills */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-baseline gap-2">
          <p className="text-sm text-neutral-300 truncate group-hover:text-white transition-colors flex-1 min-w-0">
            {clip.name || clip.originalFilename}
          </p>
          {clip.code && (
            <span className="font-mono text-[10px] tracking-wider text-neutral-500 flex-shrink-0">
              {clip.code}
            </span>
          )}
        </div>

        {(clip.shotType || (clip.tags && clip.tags.length > 0) || (clip.productSkus && clip.productSkus.length > 0)) && (
          <div className="flex flex-wrap gap-1">
            {clip.shotType && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-700/60 text-neutral-200 border border-neutral-600/50">
                {clip.shotType}
              </span>
            )}
            {clip.tags?.map((tag) => (
              <span
                key={`t-${tag}`}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent/15 text-accent border border-accent/25"
              >
                {tag}
              </span>
            ))}
            {clip.productSkus?.map((sku) => (
              <span
                key={`s-${sku}`}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
              >
                {sku}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export { formatDuration, formatFileSize };
export type { Clip };
