"use client";

import ClipCard from "./ClipCard";

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
}

interface ClipGridProps {
  clips: Clip[];
  onSelect: (clip: Clip) => void;
}

export default function ClipGrid({ clips, onSelect }: ClipGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} onSelect={onSelect} />
      ))}
    </div>
  );
}
