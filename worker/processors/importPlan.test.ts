import { describe, it, expect } from "vitest";
import { buildCopyPlan } from "./importPlan";
import type { DriveFolderChildren } from "../../src/lib/gdrive";

function fakeLister(tree: Record<string, DriveFolderChildren>) {
  return async (folderId: string): Promise<DriveFolderChildren> =>
    tree[folderId] ?? { folders: [], files: [] };
}

describe("buildCopyPlan", () => {
  it("puts individually selected files at the destination root", async () => {
    const plan = await buildCopyPlan(
      { folders: [], files: [{ id: "f1", name: "clip.mp4" }] },
      fakeLister({})
    );
    expect(plan).toEqual([
      { sourceFileId: "f1", fileName: "clip.mp4", relativePath: [] },
    ]);
  });

  it("recurses selected folders, preserving the path from the folder's own name down", async () => {
    const plan = await buildCopyPlan(
      { folders: [{ id: "raw", name: "Raw" }], files: [] },
      fakeLister({
        raw: {
          folders: [{ id: "day1", name: "Day 1" }],
          files: [{ id: "a", name: "a.mp4", mimeType: "video/mp4", size: 1 }],
        },
        day1: {
          folders: [],
          files: [{ id: "b", name: "b.mp4", mimeType: "video/mp4", size: 2 }],
        },
      })
    );
    expect(plan).toContainEqual({ sourceFileId: "a", fileName: "a.mp4", relativePath: ["Raw"] });
    expect(plan).toContainEqual({ sourceFileId: "b", fileName: "b.mp4", relativePath: ["Raw", "Day 1"] });
    expect(plan).toHaveLength(2);
  });

  it("handles a mixed selection and empty folders", async () => {
    const plan = await buildCopyPlan(
      {
        folders: [{ id: "empty", name: "Empty" }],
        files: [{ id: "x", name: "x.mov" }],
      },
      fakeLister({ empty: { folders: [], files: [] } })
    );
    expect(plan).toEqual([
      { sourceFileId: "x", fileName: "x.mov", relativePath: [] },
    ]);
  });

  it("returns [] for an empty selection", async () => {
    const plan = await buildCopyPlan({ folders: [], files: [] }, fakeLister({}));
    expect(plan).toEqual([]);
  });
});
