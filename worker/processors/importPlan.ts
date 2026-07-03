import type { DriveFolderChildren } from "../../src/lib/gdrive";
import type { ImportSelection } from "../../src/lib/db/schema";

export interface CopyPlanEntry {
  sourceFileId: string;
  fileName: string;
  /** Folder names from the destination client folder down. [] = client folder root. */
  relativePath: string[];
}

/**
 * Expand a user selection (top-level checked folders + individually checked
 * files) into a flat list of file copies with destination paths. Selected
 * folders keep their own name as the top of their subtree in the destination.
 */
export async function buildCopyPlan(
  selection: ImportSelection,
  listChildren: (folderId: string) => Promise<DriveFolderChildren>
): Promise<CopyPlanEntry[]> {
  const plan: CopyPlanEntry[] = [];

  for (const file of selection.files) {
    plan.push({ sourceFileId: file.id, fileName: file.name, relativePath: [] });
  }

  const stack = selection.folders.map((f) => ({ id: f.id, path: [f.name] }));
  while (stack.length > 0) {
    const { id, path } = stack.pop()!;
    const children = await listChildren(id);
    for (const file of children.files) {
      plan.push({ sourceFileId: file.id, fileName: file.name, relativePath: path });
    }
    for (const folder of children.folders) {
      stack.push({ id: folder.id, path: [...path, folder.name] });
    }
  }

  return plan;
}
