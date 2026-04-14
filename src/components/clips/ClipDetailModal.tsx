"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";

interface Clip {
  id: string;
  name: string | null;
  clientId: string;
  clientName: string;
  duration: number;
  width: number;
  height: number;
  fileSizeBytes?: number;
  fileSize?: number;
  codec: string;
  fps: number;
  originalFilename: string;
  uploadedAt?: string;
  createdAt?: string;
  hasThumbnail: boolean;
  hasSpriteSheet: boolean;
  shotType?: string | null;
  tags?: string[] | null;
  description?: string | null;
  productSkus?: string[] | null;
}

interface ClipDetailModalProps {
  clip: Clip;
  onClose: () => void;
  onDelete?: (clipId: string) => void;
  onUpdate?: (clipId: string, updates: Partial<Clip>) => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "-";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ClipDetailModal({ clip, onClose, onDelete, onUpdate }: ClipDetailModalProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [newShotType, setNewShotType] = useState("");
  const [localTags, setLocalTags] = useState<string[]>(clip.tags || []);
  const [localShotType, setLocalShotType] = useState<string>(clip.shotType || "");
  const [localSkus, setLocalSkus] = useState<string[]>(clip.productSkus || []);
  const [newSku, setNewSku] = useState("");
  const [descExpanded, setDescExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveTags = useCallback(async (tags: string[]) => {
    setLocalTags(tags);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (res.ok && onUpdate) {
        onUpdate(clip.id, { tags });
      }
    } catch {}
  }, [clip.id, onUpdate]);

  const saveShotType = useCallback(async (shotType: string) => {
    setLocalShotType(shotType);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotType }),
      });
      if (res.ok && onUpdate) {
        onUpdate(clip.id, { shotType });
      }
    } catch {}
  }, [clip.id, onUpdate]);

  const addTag = useCallback(() => {
    const tag = newTag.trim();
    if (tag && !localTags.includes(tag)) {
      saveTags([...localTags, tag]);
    }
    setNewTag("");
  }, [newTag, localTags, saveTags]);

  const removeTag = useCallback((tag: string) => {
    saveTags(localTags.filter((t) => t !== tag));
  }, [localTags, saveTags]);

  const saveSkus = useCallback(async (productSkus: string[]) => {
    setLocalSkus(productSkus);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productSkus }),
      });
      if (res.ok && onUpdate) {
        onUpdate(clip.id, { productSkus });
      }
    } catch {}
  }, [clip.id, onUpdate]);

  const addSku = useCallback(() => {
    const sku = newSku.trim().toUpperCase();
    if (sku && !localSkus.includes(sku)) {
      saveSkus([...localSkus, sku]);
    }
    setNewSku("");
  }, [newSku, localSkus, saveSkus]);

  const removeSku = useCallback((sku: string) => {
    saveSkus(localSkus.filter((s) => s !== sku));
  }, [localSkus, saveSkus]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const thumbnailUrl = clip.hasThumbnail
    ? `/api/assets/${clip.id}/thumbnail.jpg`
    : undefined;

  const sizeBytes = clip.fileSizeBytes || clip.fileSize || 0;
  const dateStr = clip.uploadedAt || clip.createdAt;
  const isPortrait = clip.height > clip.width;
  const isImage = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(clip.originalFilename);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className={`bg-[#1a1a1a] rounded-2xl overflow-hidden w-full ${isPortrait ? "max-w-4xl" : "max-w-5xl"} max-h-[90vh] flex flex-col`}>
        {/* Top bar with close */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="min-w-0">
            <h2 className="text-white font-semibold truncate">{clip.name || clip.originalFilename}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors p-1 ml-4 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Main content: video left, info right */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto">
          {/* Media side */}
          <div className={`flex-1 bg-black flex items-center justify-center min-h-[300px] p-4 ${isPortrait ? "md:max-w-[50%]" : "md:max-w-[65%]"}`}>
            {isImage ? (
              <img
                src={`/api/clips/${clip.id}/download`}
                alt={clip.name || clip.originalFilename}
                className="max-w-full max-h-[70vh] object-contain"
              />
            ) : (
              <div
                className="relative w-full h-full cursor-pointer flex items-center justify-center"
                onClick={togglePlay}
              >
                <video
                  ref={videoRef}
                  src={`/api/clips/${clip.id}/download`}
                  poster={thumbnailUrl}
                  className="max-w-full max-h-[70vh] object-contain"
                  preload="metadata"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  controls={isPlaying}
                />
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center border border-white/20">
                      <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Info side */}
          <div className={`${isPortrait ? "md:w-[50%]" : "md:w-[35%]"} p-5 flex flex-col gap-4 border-l border-white/5`}>
            {/* Client & date */}
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="text-accent">{clip.clientName}</span>
              <span className="text-white/20">&middot;</span>
              <span>{formatDate(dateStr)}</span>
            </div>

            {/* Shot type */}
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wider mb-1.5">Shot Type</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {localShotType && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-accent/15 text-accent rounded-full text-xs font-medium">
                    {localShotType}
                    <button
                      onClick={(e) => { e.stopPropagation(); saveShotType(""); }}
                      className="text-white/70 hover:text-red-400 transition-colors ml-0.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}
                {["Close-Up", "Extreme Close-Up", "Medium", "Wide", "Full Body", "Over the Shoulder", "POV", "Top Down", "Low Angle", "High Angle", "Tracking"].filter((t) => t !== localShotType).map((type) => (
                  <button
                    key={type}
                    onClick={() => saveShotType(type)}
                    className="px-2 py-0.5 rounded-full text-xs font-medium transition-colors bg-white/5 text-neutral-500 hover:text-neutral-300 hover:bg-white/10"
                  >
                    {type}
                  </button>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const val = newShotType.trim();
                    if (val) { saveShotType(val); setNewShotType(""); }
                  }}
                  className="inline-flex"
                >
                  <input
                    type="text"
                    value={newShotType}
                    onChange={(e) => setNewShotType(e.target.value)}
                    placeholder="+ Custom"
                    className="bg-transparent border border-dashed border-white/10 rounded-full px-2.5 py-0.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-accent w-20"
                  />
                </form>
              </div>
            </div>

            {/* Tags */}
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wider mb-1.5">Tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {localTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 text-neutral-400 rounded-full text-xs group/tag"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="text-neutral-600 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => { e.preventDefault(); addTag(); }}
                  className="inline-flex"
                >
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="+ Add tag"
                    className="bg-transparent border border-dashed border-white/10 rounded-full px-2.5 py-0.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-accent w-24"
                  />
                </form>
              </div>
            </div>

            {/* Product SKUs */}
            <div>
              <p className="text-[11px] text-muted uppercase tracking-wider mb-1.5">Product SKUs</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {localSkus.map((sku) => (
                  <span
                    key={sku}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/15 text-emerald-400 rounded-full text-xs font-medium"
                  >
                    {sku}
                    <button
                      onClick={() => removeSku(sku)}
                      className="text-emerald-400/60 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                <form
                  onSubmit={(e) => { e.preventDefault(); addSku(); }}
                  className="inline-flex"
                >
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    placeholder="+ Add SKU"
                    className="bg-transparent border border-dashed border-white/10 rounded-full px-2.5 py-0.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 w-24 uppercase"
                  />
                </form>
              </div>
            </div>

            {/* Metadata box */}
            <div className="border border-white/10 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-muted uppercase tracking-wider">Duration</p>
                  <p className="text-sm text-white mt-0.5">{formatDuration(clip.duration)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted uppercase tracking-wider">Resolution</p>
                  <p className="text-sm text-white mt-0.5">{clip.width} x {clip.height}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted uppercase tracking-wider">File Size</p>
                  <p className="text-sm text-white mt-0.5">{formatBytes(sizeBytes)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted uppercase tracking-wider">Codec</p>
                  <p className="text-sm text-white mt-0.5">{clip.codec || "-"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted uppercase tracking-wider">FPS</p>
                  <p className="text-sm text-white mt-0.5">{clip.fps ? `${clip.fps}` : "-"}</p>
                </div>
              </div>

              <div className="border-t border-white/5 pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted uppercase tracking-wider">Original Filename</p>
                  {clip.originalFilename && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(clip.originalFilename);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="text-[11px] text-muted hover:text-white transition-colors flex items-center gap-1"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-green-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  )}
                </div>
                <p className="text-sm text-white mt-0.5 break-all">{clip.originalFilename || "-"}</p>
              </div>
            </div>

            {/* AI Description */}
            {clip.description && (
              <div>
                <p className="text-[11px] text-muted uppercase tracking-wider mb-1.5">AI Description</p>
                <p className={`text-sm text-neutral-400 leading-relaxed ${!descExpanded ? "line-clamp-3" : ""}`}>
                  {clip.description}
                </p>
                {clip.description.length > 120 && (
                  <button
                    onClick={() => setDescExpanded(!descExpanded)}
                    className="text-xs text-accent hover:text-accent-hover mt-1 transition-colors"
                  >
                    {descExpanded ? "Show less" : "See more"}
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-auto">
              <a
                href={`/api/clips/${clip.id}/download`}
                className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors w-full"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Original
              </a>

              {isAdmin && onDelete && (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setDeleting(true);
                        try {
                          const res = await fetch(`/api/clips/${clip.id}`, { method: "DELETE" });
                          if (res.ok) {
                            onDelete(clip.id);
                            onClose();
                          }
                        } finally {
                          setDeleting(false);
                        }
                      }}
                      disabled={deleting}
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                    >
                      {deleting ? "Deleting..." : "Yes, delete"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-sm text-muted hover:text-white px-3 py-2.5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex items-center justify-center gap-2 text-red-400 hover:text-red-300 text-sm py-2 rounded-lg hover:bg-red-500/10 transition-colors w-full"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Clip
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
