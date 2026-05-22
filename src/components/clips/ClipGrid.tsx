"use client";

import ClipCard from "./ClipCard";

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
}

export type GridSize = "small" | "medium" | "large";

interface CollectionSummary {
  id: string;
  name: string;
  clipCount: number;
}

interface ClipGridProps {
  clips: Clip[];
  onSelect: (clip: Clip) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (clipId: string) => void;
  bulkMode?: boolean;
  size?: GridSize;
  collections?: CollectionSummary[];
  onAddToCollection?: (clipId: string, collectionId: string) => Promise<void>;
  onCreateCollection?: (clipId: string, name: string) => Promise<void>;
}

// Tailwind needs full class names in source for the JIT compiler,
// so we map sizes to literal class strings rather than building them dynamically.
const SIZE_CLASSES: Record<GridSize, string> = {
  small: "columns-2 sm:columns-3 lg:columns-5 xl:columns-6 2xl:columns-7 gap-3",
  medium: "columns-1 sm:columns-2 lg:columns-3 xl:columns-4 2xl:columns-5 gap-4",
  large: "columns-1 sm:columns-1 lg:columns-2 xl:columns-3 2xl:columns-3 gap-5",
};

const SIZE_MARGIN: Record<GridSize, string> = {
  small: "mb-3",
  medium: "mb-4",
  large: "mb-5",
};

export default function ClipGrid({ clips, onSelect, selectedIds, onToggleSelect, bulkMode, size = "medium", collections, onAddToCollection, onCreateCollection }: ClipGridProps) {
  return (
    <div className={SIZE_CLASSES[size]}>
      {clips.map((clip) => (
        <div key={clip.id} className={`${SIZE_MARGIN[size]} break-inside-avoid`}>
          <ClipCard
            clip={clip}
            onSelect={onSelect}
            isSelected={selectedIds?.has(clip.id)}
            onToggleSelect={onToggleSelect}
            bulkMode={bulkMode}
            collections={collections}
            onAddToCollection={onAddToCollection}
            onCreateCollection={onCreateCollection}
          />
        </div>
      ))}
    </div>
  );
}
