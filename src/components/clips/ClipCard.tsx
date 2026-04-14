"use client";

import { useRef, useState, useCallback } from "react";

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
  // Legacy fields for backward compat
  status?: string;
  thumbnailPath?: string | null;
  spriteSheetPath?: string | null;
  fileSize?: number;
}

interface ClipCardProps {
  clip: Clip;
  onSelect: (clip: Clip) => void;
  isSelected?: boolean;
  onToggleSelect?: (clipId: string) => void;
  bulkMode?: boolean;
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

export default function ClipCard({ clip, onSelect, isSelected, onToggleSelect, bulkMode }: ClipCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [skimPercent, setSkimPercent] = useState<number | null>(null);

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
        {hasThumbnail ? (
          <img
            src={`/api/assets/${clip.id}/thumbnail.jpg`}
            alt={clip.name || clip.originalFilename}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center">
            <svg className="w-8 h-8 text-neutral-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        )}

        {/* Sprite sheet overlay on hover */}
        {spriteStyle && (
          <div className="absolute inset-0" style={spriteStyle} />
        )}

        {/* Skim progress bar */}
        {skimPercent !== null && (
          <div
            className="absolute bottom-0 left-0 h-[3px] bg-accent z-10"
            style={{ width: `${skimPercent * 100}%` }}
          />
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

        {/* Download button on hover */}
        <div className="absolute bottom-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={`/api/clips/${clip.id}/download`}
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 rounded-full bg-black/70 hover:bg-accent flex items-center justify-center text-white shadow-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      </div>

      {/* Clip name */}
      <div className="px-3 py-2.5">
        <p className="text-sm text-neutral-300 truncate group-hover:text-white transition-colors">
          {clip.name || clip.originalFilename}
        </p>
      </div>
    </div>
  );
}

export { formatDuration, formatFileSize };
export type { Clip };
