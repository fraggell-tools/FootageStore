"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ClipGrid from "@/components/clips/ClipGrid";
import ClipDetailModal from "@/components/clips/ClipDetailModal";

interface Client {
  id: string;
  name: string;
  slug: string;
  clipCount: number;
  totalStorageBytes: number;
}

interface Clip {
  id: string;
  name: string;
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
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

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

  const filteredClips = clips.filter((clip) =>
    clip.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = useCallback((clip: Clip) => {
    setSelectedClip(clip);
  }, []);

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
      </div>

      {filteredClips.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted">
            {search ? "No clips match your search" : "No clips uploaded yet"}
          </p>
        </div>
      ) : (
        <ClipGrid clips={filteredClips} onSelect={handleSelect} />
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
