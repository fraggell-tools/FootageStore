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
    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
      {clips.map((clip) => (
        <div key={clip.id} className="mb-4 break-inside-avoid">
          <ClipCard clip={clip} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
