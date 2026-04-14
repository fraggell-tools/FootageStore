"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";

interface Clip {
  id: string;
  name: string;
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
}

interface ClipDetailModalProps {
  clip: Clip;
  onClose: () => void;
  onDelete?: (clipId: string) => void;
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
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function ClipDetailModal({ clip, onClose, onDelete }: ClipDetailModalProps) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const metadataItems = [
    { label: "Duration", value: formatDuration(clip.duration) },
    { label: "Resolution", value: `${clip.width} x ${clip.height}` },
    { label: "File Size", value: formatBytes(sizeBytes) },
    { label: "Codec", value: clip.codec || "-" },
    { label: "FPS", value: clip.fps ? `${clip.fps}` : "-" },
    { label: "Original Filename", value: clip.originalFilename || "-" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Close button */}
        <div className="flex justify-end p-4 pb-0">
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video player */}
        <div className="px-6">
          <div
            className="relative rounded-lg overflow-hidden bg-black cursor-pointer"
            style={{ aspectRatio: clip.width && clip.height ? `${clip.width}/${clip.height}` : "16/9", maxHeight: "60vh" }}
            onClick={togglePlay}
          >
            <video
              ref={videoRef}
              src={`/api/clips/${clip.id}/download`}
              poster={thumbnailUrl}
              className="w-full h-full object-contain"
              preload="metadata"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              controls={isPlaying}
            />
            {/* Play icon overlay - only when not playing */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center border border-white/20 hover:bg-black/70 transition-colors">
                  <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Info section */}
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-white">{clip.name}</h2>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-muted">
              <span>{clip.clientName}</span>
              <span className="text-border">&middot;</span>
              <span>{formatDate(dateStr)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <a
              href={`/api/clips/${clip.id}/download`}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
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
                    className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
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
                  className="inline-flex items-center gap-2 text-red-400 hover:text-red-300 text-sm px-3 py-2.5 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
            {metadataItems.map((item) => (
              <div key={item.label}>
                <p className="text-xs text-muted uppercase tracking-wider mb-1">
                  {item.label}
                </p>
                <p className="text-sm text-white break-all">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
