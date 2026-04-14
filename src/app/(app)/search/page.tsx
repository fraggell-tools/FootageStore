"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ClipGrid from "@/components/clips/ClipGrid";
import ClipDetailModal from "@/components/clips/ClipDetailModal";

interface Clip {
  id: string;
  name: string;
  description?: string | null;
  clientId: string;
  clientName: string;
  clientSlug?: string;
  duration: number;
  width: number;
  height: number;
  fileSize?: number;
  fileSizeBytes: number;
  codec: string;
  fps: number;
  originalFilename: string;
  createdAt?: string;
  uploadedAt: string;
  hasThumbnail: boolean;
  hasSpriteSheet: boolean;
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams.get("q") || "";

  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState(query);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

  useEffect(() => {
    setSearchInput(query);
    if (!query) {
      setClips([]);
      return;
    }

    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((data) => {
        setClips(data.clips || []);
      })
      .finally(() => setLoading(false));
  }, [query]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) {
      router.push(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  const handleSelect = useCallback((clip: Clip) => {
    setSelectedClip(clip);
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-4">Search Footage</h1>
        <form onSubmit={handleSearch} className="max-w-2xl">
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Describe what you're looking for... e.g. 'product sliding into frame'"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl pl-12 pr-4 py-3 text-white placeholder-muted focus:outline-none focus:border-accent text-sm"
              autoFocus
            />
          </div>
        </form>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 bg-surface rounded" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="aspect-video bg-surface rounded-lg" />
            ))}
          </div>
        </div>
      ) : query ? (
        <>
          <p className="text-muted text-sm mb-6">
            {clips.length} result{clips.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          </p>

          {clips.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-muted">No clips match your search</p>
              <p className="text-muted text-sm mt-2">
                Try different keywords or a broader description
              </p>
            </div>
          ) : (
            <>
              <ClipGrid clips={clips} onSelect={handleSelect} />

              {/* Show descriptions in results */}
              <div className="mt-8 space-y-3">
                {clips
                  .filter((c) => c.description)
                  .map((clip) => (
                    <div
                      key={clip.id}
                      className="bg-surface border border-border rounded-lg p-4 cursor-pointer hover:border-accent/30 transition-colors"
                      onClick={() => setSelectedClip(clip)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{clip.name}</p>
                          <p className="text-xs text-accent mt-0.5">{clip.clientName}</p>
                          <p className="text-xs text-muted mt-1 line-clamp-2">
                            {clip.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="text-center py-20">
          <svg className="w-12 h-12 text-muted mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-muted">Search by scene description</p>
          <p className="text-muted text-sm mt-1">
            e.g. &ldquo;product moving into frame&rdquo;, &ldquo;close-up of hands&rdquo;, &ldquo;woman applying cream&rdquo;
          </p>
        </div>
      )}

      {selectedClip && (
        <ClipDetailModal
          clip={selectedClip}
          onClose={() => setSelectedClip(null)}
          onDelete={(clipId) => {
            setClips((prev) => prev.filter((c) => c.id !== clipId));
            setSelectedClip(null);
          }}
        />
      )}
    </div>
  );
}
