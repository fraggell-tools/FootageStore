import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDriveFolderLink } from "@/lib/driveLink";
import { getDriveFolderMeta, listFolderChildren } from "@/lib/gdrive";

const NO_ACCESS_MESSAGE =
  "Couldn't open that folder. Make sure the link is a Google Drive folder and that it's either shared with the FootageStore Google account or set to \"anyone with the link can view\".";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { link, folderId } = body as { link?: string; folderId?: string };

  let targetId: string | null = null;
  if (typeof folderId === "string" && folderId) {
    targetId = folderId;
  } else if (typeof link === "string" && link) {
    targetId = parseDriveFolderLink(link);
    if (!targetId) {
      return NextResponse.json(
        {
          error: "Invalid link",
          message:
            "That doesn't look like a Google Drive folder link. Paste a link like https://drive.google.com/drive/folders/…",
        },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "link or folderId is required" }, { status: 400 });
  }

  try {
    const [folder, children] = await Promise.all([
      getDriveFolderMeta(targetId),
      listFolderChildren(targetId),
    ]);
    return NextResponse.json({ folder, ...children });
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
