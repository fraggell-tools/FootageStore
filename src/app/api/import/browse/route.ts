import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDriveFolderLink } from "@/lib/driveLink";
import { parseDropboxLink } from "@/lib/dropboxLink";
import {
  isDropboxConfigured,
  getSharedLinkMeta,
  listSharedLinkFolder,
  DropboxApiError,
} from "@/lib/dropbox";
import { getDriveFolderMeta, listFolderChildren } from "@/lib/gdrive";

const NO_ACCESS_MESSAGE =
  "Couldn't open that folder. Make sure the link is a Google Drive folder and that it's either shared with the FootageStore Google account or set to \"anyone with the link can view\".";

const DROPBOX_UNCONFIGURED_MESSAGE = "Dropbox import isn't configured on the server.";

function dropboxErrorResponse(err: unknown) {
  if (err instanceof DropboxApiError) {
    if (err.summary.startsWith("shared_link_access_denied"))
      return NextResponse.json(
        {
          error: "No access",
          message:
            "That Dropbox link is password-protected or restricted — ask the sender to reshare it without a password.",
        },
        { status: 404 }
      );
    if (err.status === 409 || err.status === 404)
      return NextResponse.json(
        { error: "No access", message: "That Dropbox link doesn't exist or was revoked." },
        { status: 404 }
      );
  }
  console.error("[Import Browse] Dropbox error:", err);
  return NextResponse.json(
    { error: "Browse failed", message: (err as Error).message },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { link, folderId, path } = body as { link?: string; folderId?: string; path?: string };

  // Drive subfolder expansion (existing behavior)
  if (typeof folderId === "string" && folderId) {
    return browseDrive(folderId);
  }

  if (typeof link !== "string" || !link) {
    return NextResponse.json({ error: "link or folderId is required" }, { status: 400 });
  }

  const dropbox = parseDropboxLink(link);
  if (dropbox) {
    if (!isDropboxConfigured()) {
      return NextResponse.json(
        { error: "Not configured", message: DROPBOX_UNCONFIGURED_MESSAGE },
        { status: 400 }
      );
    }
    try {
      // Subfolder expansion: page sends the link back with a relative path.
      if (typeof path === "string" && path) {
        const children = await listSharedLinkFolder(dropbox.url, path);
        const name = path.split("/").pop() || "";
        return NextResponse.json({
          folder: { id: path, name },
          ...children,
          source: "dropbox",
          link: dropbox.url,
        });
      }
      const meta = await getSharedLinkMeta(dropbox.url);
      if (!meta.isFolder) {
        // Single-file link: one-file listing so the normal selection UI works.
        return NextResponse.json({
          folder: { id: "", name: meta.name },
          folders: [],
          files: [
            { id: "", name: meta.name, mimeType: "application/octet-stream", size: meta.size },
          ],
          source: "dropbox",
          link: dropbox.url,
        });
      }
      const children = await listSharedLinkFolder(dropbox.url, "");
      return NextResponse.json({
        folder: { id: "", name: meta.name },
        ...children,
        source: "dropbox",
        link: dropbox.url,
      });
    } catch (err) {
      return dropboxErrorResponse(err);
    }
  }

  const driveId = parseDriveFolderLink(link);
  if (!driveId) {
    return NextResponse.json(
      {
        error: "Invalid link",
        message:
          "That doesn't look like a Google Drive or Dropbox link. Paste a link like https://drive.google.com/drive/folders/… or https://www.dropbox.com/scl/fo/…",
      },
      { status: 400 }
    );
  }
  return browseDrive(driveId);
}

async function browseDrive(targetId: string) {
  try {
    const [folder, children] = await Promise.all([
      getDriveFolderMeta(targetId),
      listFolderChildren(targetId),
    ]);
    return NextResponse.json({ folder, ...children, source: "drive" });
  } catch (err) {
    const status = (err as { code?: number }).code;
    if (status === 404 || status === 403) {
      return NextResponse.json({ error: "No access", message: NO_ACCESS_MESSAGE }, { status: 404 });
    }
    console.error("[Import Browse] Error:", err);
    return NextResponse.json(
      { error: "Browse failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}
